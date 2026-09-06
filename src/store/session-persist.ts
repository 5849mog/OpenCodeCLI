
"use client";

import {
  saveSession,
  getActiveSessionId,
  type PersistedSession
} from "@/lib/session-storage";

// ---------------------------------------------------------------------------
// Idle auto-lock — wipes API keys from memory after N minutes of inactivity.
// ---------------------------------------------------------------------------
import type {
  SessionState
} from "./session";

let eventCounter = 0;
export function nextId(): string {
  eventCounter += 1;
  return `e${Date.now()}_${eventCounter}`;
}

/** IndexedDB 持久化失败只提示一次——静默丢持久化比崩溃更糟（用户会以为
 *  会话已保存），但每次都弹 toast 也会刷屏。 */
let persistFailureNotified = false;
function notifyPersistFailure(e: unknown): void {
  if (persistFailureNotified) return;
  persistFailureNotified = true;
  void import("sonner").then(({ toast }) => {
    toast.error("会话持久化失败（IndexedDB 不可用或已满），刷新后本会话可能丢失。", {
      description: e instanceof Error ? e.message : String(e),
      duration: 10000,
    });
  });
}

/** Debounced session persistence — avoids writing to IndexedDB on every token. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 脏标记：只有真正发生过改动的会话才允许落盘。
 * 此前的去重是"全局最后一次保存签名"——用户仅查看一个会话再切走时，
 * switchSession 的离开 flush 签名必然不符 → 全量重存 → updatedAt 被刷成
 * 当前时间 → 会话在列表里凭空浮到顶部。改为脏标记后，查看不再是修改。
 */
let persistDirty = false;

/** Immediately persist the current session, bypassing the debounce. */
export async function flushPersist(get: () => SessionState): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!persistDirty) return;
  const s = get();
  if (s.messages.length === 0) return;
  const session: PersistedSession = {
    id: s.sessionId || getActiveSessionId(),
    title: s.title || "新会话",
    messages: s.messages,
    events: s.events,
    totalTokens: s.totalTokens,
    lastUsage: s.lastUsage,
    compactedReleases: s.compactedReleases ?? 0,
    compactCount: s.compactCount ?? 0,
    usageHistory: s.usageHistory ?? [],
    vfsChangeLog: s.vfsChangeLog ?? [],
    agentPreset: s.agentPreset ?? "full",
    createdAt: s.events[0]?.ts ?? Date.now(),
    updatedAt: Date.now(),
  };
  await saveSession(session).catch((e: unknown) => notifyPersistFailure(e));
  persistDirty = false;
  // 保存成功后同步侧栏列表（时间/消息数）——列表不再只在切换会话时跳变。
  void get().refreshSessionList();
}

export function schedulePersist(get: () => SessionState) {
  persistDirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushPersist(get).catch((e: unknown) => notifyPersistFailure(e));
  }, 500);
}
