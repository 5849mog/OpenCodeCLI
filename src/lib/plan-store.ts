/**
 * plan-store.ts — 计划（update_plan 产物）的独立存储。
 *
 * 早期版本把计划写进文件袋 VFS 根目录的 PLAN.md，会污染树摘要、被打进
 * zip_archive 导出。现在计划存于独立的 IndexedDB store（`opencode-plan`），
 * 与文件袋彻底解耦——清空文件袋 / vfs.clear() 不影响计划，zip 导出与树摘要
 * 也不再包含它。VFS 里历史遗留的孤儿 PLAN.md 不做迁移（用户可自行删除）。
 *
 * 读走内存缓存（同步——buildPlanSummary / PlanPanel / PlanHeaderBadge 需要），
 * 写同步更新内存 + 后台持久化，与 skills 的存储模式一致。
 */

import { openDB, type IDBPDatabase } from "idb";

const PLAN_DB = "opencode-plan";
const PLAN_STORE = "plan";
const PLAN_KEY = "current";

interface StoredPlan {
  key: string;
  content: string;
  updatedAt: number;
}

let planDbPromise: Promise<IDBPDatabase | null> | null = null;
let currentPlan: string | null = null;
let planHydrated = false;
let hydrateStarted = false;

// --- 变化通知：计划更新时 bump，供 UI（PlanPanel / PlanHeaderBadge）订阅实时刷新 ---
let planVersion = 0;
const planListeners = new Set<() => void>();

/** 订阅计划变化，返回取消函数。 */
export function onPlanChange(fn: () => void): () => void {
  planListeners.add(fn);
  return () => planListeners.delete(fn);
}

/** 当前计划版本（UI 订阅用）。 */
export function getPlanVersion(): number {
  return planVersion;
}

function bumpPlanVersion(): void {
  planVersion++;
  for (const fn of planListeners) fn();
}

function getPlanDB(): Promise<IDBPDatabase | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!planDbPromise) {
    planDbPromise = openDB(PLAN_DB, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PLAN_STORE)) {
          db.createObjectStore(PLAN_STORE, { keyPath: "key" });
        }
      },
    }).catch(() => null);
  }
  return planDbPromise;
}

/** 从独立 store 载入计划到内存缓存（幂等）。与 getPlan 的首次调用防竞态：
 *  hydrate 异步完成前 getPlan 返回内存值（可能为 null），应用启动处（vfs-view
 *  init）主动 hydrate 兜底，双保险。 */
export async function hydratePlan(): Promise<void> {
  if (planHydrated || hydrateStarted) return;
  hydrateStarted = true;
  try {
    const db = await getPlanDB();
    if (db) {
      const rec = (await db.get(PLAN_STORE, PLAN_KEY)) as StoredPlan | undefined;
      if (rec && typeof rec.content === "string") currentPlan = rec.content;
    }
  } catch {
    /* 失败仅保留内存（空） */
  } finally {
    planHydrated = true;
  }
}

/** 同步读取当前计划（内存缓存）。未 hydrate 时幂等触发一次后台 hydrate。 */
export function getPlan(): string | null {
  if (!planHydrated && !hydrateStarted && typeof window !== "undefined") {
    void hydratePlan();
  }
  return currentPlan;
}

/** 写入计划：更新内存缓存 + 后台持久化 + 通知 UI。 */
export async function setPlan(content: string): Promise<void> {
  currentPlan = content;
  bumpPlanVersion();
  try {
    const db = await getPlanDB();
    if (db) {
      await db.put(PLAN_STORE, { key: PLAN_KEY, content, updatedAt: Date.now() } satisfies StoredPlan);
    }
  } catch {
    /* 持久化失败 — 仅保留内存 */
  }
}
