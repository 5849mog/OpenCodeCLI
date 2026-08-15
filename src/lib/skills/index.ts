/**
 * skills/index.ts — Skill 能力核心。
 *
 * Skill = 可加载的技能包（SKILL.md），AI 通过 list_skills / load_skill
 * 按需加载。内容绝不经 system prompt 注入（保持 STATIC_SYSTEM_PROMPT
 * 前缀稳定，API 缓存命中不被破坏）——skill 全文作为工具结果返回。
 *
 * 存储：
 *  - 内置 skills：代码资源（本文件写死），天然不可删改。
 *  - 用户自定义：独立的 IndexedDB store（`opencode-skills`），与文件袋
 *    VFS 彻底解耦——清空文件袋 / vfs.clear() 不会影响自定义 skill。
 *    早期版本存在 VFS `skills/` 的自定义 skill，首次访问时会迁移到独立 store。
 */

import { openDB, type IDBPDatabase } from "idb";
import { vfs } from "@/lib/vfs"; // 仅用于旧版本 VFS skills/ 记录的一次性迁移

/** 独立的自定义 skill 存储库（与文件袋 VFS 不同的 database，互不影响）。 */
const SKILL_DB = "opencode-skills";
const SKILL_STORE = "skills";

interface StoredSkill {
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

let skillDbPromise: Promise<IDBPDatabase> | null = null;
/** 内存缓存的独立 store（读走 cache，写同步更新 + 后台持久化）。 */
let skillCache = new Map<string, StoredSkill>();
let skillHydrated = false;

// --- 变化通知：自定义 skill 增删时 bump，供 UI（SkillsDialog）订阅实时刷新 ---
let skillVersion = 0;
const skillListeners = new Set<() => void>();

/** 订阅自定义 skill 变化，返回取消函数。 */
export function onSkillsChange(fn: () => void): () => void {
  skillListeners.add(fn);
  return () => skillListeners.delete(fn);
}

function bumpSkillVersion(): void {
  skillVersion++;
  for (const fn of skillListeners) fn();
}

/** 当前 skill 版本（UI 订阅用）。 */
export function getSkillVersion(): number {
  return skillVersion;
}

function getSkillDB() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("skills DB only available in browser"));
  }
  if (!skillDbPromise) {
    skillDbPromise = openDB(SKILL_DB, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(SKILL_STORE)) {
          db.createObjectStore(SKILL_STORE, { keyPath: "name" });
        }
      },
    }).catch(() => null as unknown as IDBPDatabase);
  }
  return skillDbPromise;
}

/** 从独立 store 载入全部自定义 skill 到内存缓存。 */
async function hydrateSkills(): Promise<void> {
  if (skillHydrated) return;
  try {
    const db = await getSkillDB();
    const migrated = await migrateLegacySkills(db);
    if (db) {
      const all = migrated ?? (await db.getAll(SKILL_STORE)) as StoredSkill[];
      for (const rec of all) skillCache.set(rec.name, rec);
    }
    skillHydrated = true;
  } catch {
    skillHydrated = true; // 失败也标记，避免反复尝试
  }
}

/**
 * 兼容迁移：早期版本的自定义 skill 存在文件袋 VFS `skills/` 目录。
 * 独立 store 为空但 VFS 有旧记录时，读入并存独立 store，然后清理 VFS 旧目录。
 * 返回迁移后的记录（若有）；独立 store 非空则返回 null（已是最新，无需迁移）。
 */
async function migrateLegacySkills(db: IDBPDatabase | null): Promise<StoredSkill[] | null> {
  try {
    if (db) {
      const existing = (await db.getAll(SKILL_STORE)) as StoredSkill[];
      if (existing.length > 0) return null; // 独立 store 已有数据，跳过迁移
    }
    const dirs = vfs.listSync("skills");
    if (dirs.length === 0) return null; // VFS 无旧 skill
    const migrated: StoredSkill[] = [];
    for (const dir of dirs) {
      const name = dir.path.split("/").pop() ?? dir.path;
      const content = vfs.readFileSync(`skills/${name}/SKILL.md`);
      if (content === null) continue;
      const now = Date.now();
      migrated.push({ name, content, createdAt: now, updatedAt: now });
      await writeCustomSkill(name, content, now); // 写入独立 store（cache + IDB）
    }
    if (migrated.length > 0) {
      // 清理 VFS 旧 skills/ 目录（避免下次重复迁移）
      void vfs.delete("skills");
    }
    return migrated;
  } catch {
    return null;
  }
}

export interface Skill {
  /** 唯一名称（list_skills / load_skill 用）。 */
  name: string;
  /** 一句话描述（给 AI 判断何时用）。 */
  description: string;
  /** 来源：内置 or 用户自定义。 */
  source: "builtin" | "custom";
  /** SKILL.md 全文。 */
  content: string;
}

/** list_skills 返回的轻量信息（不含 content，省 token）。 */
export interface SkillMeta {
  name: string;
  description: string;
  source: "builtin" | "custom";
}

// ---------------------------------------------------------------------------
// 内置 skills
// ---------------------------------------------------------------------------

const BUILTIN_SKILLS: Skill[] = [
  {
    name: "code-review",
    description:
      "审查代码找 bug / 质量问题：静态审查 + 对 JS/Lua 用 run_js/run_lua 真跑验证，输出证据化结论（文件:行号、问题、严重度、修复建议）。",
    source: "builtin",
    content: `# Code Review Skill

审查代码时遵循以下流程：

## 1. 静态审查（所有语言）
- 逐文件读代码，重点找：逻辑错误、边界条件（空数组/0/负数/null）、
  空值解引用、竞态、资源未释放、错误被吞。
- 用 \`view_outline\` 快速了解结构，再 \`read_file\` 读关键段。
- 记录每个问题的 \`文件:行号\`、类型、严重度（critical/major/minor）。

## 2. 真实运行验证（仅 JS / Lua）
- 代码是 **JavaScript**：用 \`run_js\` 写测试脚本真跑——
  \`script\` 里断言期望输出，\`throw new Error(...)\` 即失败。
- 代码是 **Lua**：用 \`run_lua\` 同样写断言脚本跑。
- 边界用例优先：空输入、单元素、大输入、非法输入。

## 3. 输出格式（证据化结论）
按优先级列出问题，每条：
\`\`\`
- [严重度] \`文件:行号\` — 问题描述
  修复建议：…
\`\`\`
- 无 bug 也要明确说"未发现问题"，不臆断。
- 验证失败即停（Tool failure protocol），不假装通过。`,
  },
  {
    name: "data-analysis",
    description:
      "数据分析工作流：parse_csv/parse_yaml 读数据 → query_json 过滤聚合 → math 计算 → chart 代码块可视化。",
    source: "builtin",
    content: `# Data Analysis Skill

分析数据时按这个工作流，别用 bash 字符串硬凑：

## 1. 读数据（选对应工具）
- CSV → \`parse_csv(path)\`（json 对象数组 / table / array）
- YAML → \`parse_yaml(path)\`（转 JSON 输出）
- JSON → \`query_json(path, expression)\`

## 2. 处理与聚合
- 过滤 / 选字段 / 重组 → \`query_json\` 的 JSONata 表达式
  （\`$.users[age>30].name\`、\`$sum($.items.price)\`、\`$count(...)\`）
- 数值计算 → \`math(expression)\`（mean/median/std、矩阵、单位换算）
- 多文件关联 / 复杂转换 → \`run_js\` 或 \`run_lua\` 写脚本处理

## 3. 可视化（用 chart 代码块）
把结果渲染成图表，代码块语言用 \`chart\`，body 是 JSON 配置：
\`\`\`chart
{"type":"bar","data":{"labels":["A","B"],"datasets":[{"label":"x","data":[1,2]}]}}
\`\`\`
类型支持：bar/line/pie/scatter；深色主题默认浅色文字，无需手动配。

## 4. 汇报
- 给结论 + 关键数字 + 图表，别贴原始数据堆。
- 数据量大时先聚合再汇报。`,
  },
  {
    name: "diagram",
    description:
      "画图指南：根据图形复杂度选 mermaid / graphviz(dot) / chart 三种代码块语言，输出即渲染为 SVG/图表。",
    source: "builtin",
    content: `# Diagram Skill

需要画图时，按复杂度和类型选对代码块语言（输出会自动渲染）：

## 1. Mermaid（通用流程图 / 时序 / 简单图）
\`\`\`mermaid
flowchart LR
  A[开始] --> B{判断}
  B -->|是| C[结束]
  B -->|否| D[继续]
\`\`\`
适合：flowchart、sequence、class、state、gantt、mindmap 等常规图。

## 2. Graphviz / DOT（复杂图、依赖图、架构图、DAG）
\`\`\`dot
digraph G {
  rankdir=LR;
  "web" -> "api" -> "db";
}
\`\`\`
适合：节点多、需要精确布局、依赖关系、大型架构图——
mermaid 在复杂图上会乱，DOT 的 dot/neato 布局引擎更专业。

## 3. Chart.js（数据图表）
\`\`\`chart
{"type":"line","data":{"labels":["Q1","Q2"],"datasets":[{"label":"收入","data":[30,52]}]}}
\`\`\`
适合：柱状/折线/饼/散点等数据可视化（与 data-analysis 配合）。

## 选择原则
- 数据图表 → chart；复杂拓扑/依赖 → dot；其他 → mermaid。
- 代码块直接输出，无需额外步骤。`,
  },
];

// ---------------------------------------------------------------------------
// 发现 + 加载
// ---------------------------------------------------------------------------

/** 内置 skill 的隐藏名单（用户删除内置 skill 后持久化。内置代码不可物理删，
 *  删除 = 记入此名单，list/load 均过滤）。存 localStorage，按 name 记录。 */
const HIDDEN_KEY = "opencode-web.hidden-skills";

function hiddenSet(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function persistHidden(set: Set<string>): void {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

/** 隐藏一个内置 skill（删除语义）。 */
export function hideSkill(name: string): void {
  const set = hiddenSet();
  set.add(name);
  persistHidden(set);
}

/** 取消隐藏一个内置 skill。 */
export function unhideSkill(name: string): void {
  const set = hiddenSet();
  set.delete(name);
  persistHidden(set);
}

/** 该内置 skill 是否被隐藏。 */
export function isSkillHidden(name: string): boolean {
  return hiddenSet().has(name);
}

/** 从 SKILL.md 提取自定义 skill 的描述：跳过首行标题（# 名称），取其后
 *  第一个非空段落作为一句话说明（与内置 skill 的 description 语义一致）。 */
function extractCustomDescription(md: string): string {
  const lines = md.split("\n");
  // 跳过头部的空行和标题行（# / ##）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // 空行跳过
    if (/^#{1,3}\s/.test(line)) continue; // 标题行跳过
    // 第一个非空非标题行即描述
    return line.replace(/^[-*+]\s*/, "").slice(0, 120);
  }
  return "";
}

/** 从独立 store 读取自定义 skill 记录（先 hydrate 内存缓存）。 */
async function readCustomSkills(): Promise<StoredSkill[]> {
  await hydrateSkills();
  return Array.from(skillCache.values());
}

/** 写入一个自定义 skill 到独立 store（更新内存缓存 + 后台持久化）。 */
async function writeCustomSkill(name: string, content: string, now: number): Promise<void> {
  const rec: StoredSkill = {
    name,
    content,
    createdAt: skillCache.get(name)?.createdAt ?? now,
    updatedAt: now,
  };
  skillCache.set(name, rec);
  try {
    const db = await getSkillDB();
    if (db) await db.put(SKILL_STORE, rec);
  } catch {
    /* 持久化失败 — 仅保留内存 */
  }
  bumpSkillVersion();
}

/** 从独立 store 删除一个自定义 skill。 */
async function deleteCustomSkill(name: string): Promise<void> {
  skillCache.delete(name);
  try {
    const db = await getSkillDB();
    if (db) await db.delete(SKILL_STORE, name);
  } catch {
    /* ignore */
  }
  bumpSkillVersion();
}

/** 列出所有可用 skill。同名时自定义覆盖内置（替换语义），source 标 custom。 */
export async function listSkills(): Promise<SkillMeta[]> {
  const hidden = hiddenSet();
  const custom = await readCustomSkills();
  const customNames = new Set(custom.map((s) => s.name));
  const builtin = BUILTIN_SKILLS
    .filter((s) => !hidden.has(s.name) && !customNames.has(s.name)) // 同名被自定义替换
    .map(({ name, description, source }) => ({ name, description, source }));
  const customMetas = custom.map(({ name, content }) => ({
    name,
    description: extractCustomDescription(content),
    source: "custom" as const,
  }));
  return [...customMetas, ...builtin];
}

/** 加载指定 skill。同名时自定义优先（替换内置）；内置被隐藏返回 null。 */
export async function loadSkill(name: string): Promise<Skill | null> {
  // 自定义优先（独立 store，同名可覆盖内置）
  await hydrateSkills();
  const custom = skillCache.get(name);
  if (custom) {
    return { name, description: extractCustomDescription(custom.content), source: "custom", content: custom.content };
  }
  const builtin = BUILTIN_SKILLS.find((s) => s.name === name);
  if (builtin) {
    if (hiddenSet().has(name)) return null;
    return builtin;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 创建 / 删除（由 AI 通过 create_skill / delete_skill 工具调用）
// ---------------------------------------------------------------------------

/** 校验 skill 名称合法：非空、无斜杠/路径分隔、无特殊字符。 */
export function validateSkillName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "skill 名称不能为空";
  if (trimmed.length > 64) return "skill 名称过长（≤64 字符）";
  if (/[\/\\\s]/.test(trimmed)) return "skill 名称不能含斜杠 / 反斜杠 / 空格";
  if (/[^\w.-]/.test(trimmed)) return "skill 名称只能含字母数字、点、横线、下划线";
  return null;
}

/** 创建/覆盖一个自定义 skill（独立 IndexedDB store，与文件袋解耦）。若首行不是
 *  `# 标题`，自动补一行（保证 list_skills 能正确提取描述）。 */
export async function createSkill(name: string, content: string): Promise<{ ok: boolean; name: string; error?: string }> {
  const err = validateSkillName(name);
  if (err) return { ok: false, name, error: err };
  const normalized = name.trim();
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, name, error: "SKILL 内容不能为空" };
  // 若首行不带标题，前置一行标题
  const firstLine = trimmed.split("\n")[0].trim();
  const final = firstLine.startsWith("#")
    ? trimmed
    : `# ${normalized}\n\n${trimmed}`;
  await writeCustomSkill(normalized, final, Date.now());
  return { ok: true, name: normalized };
}

/** 删除一个 skill。custom → 从独立 store 删除；内置 → 记入隐藏名单。 */
export async function removeSkill(name: string): Promise<{ ok: boolean; source: "builtin" | "custom"; name: string }> {
  const isBuiltin = BUILTIN_SKILLS.some((s) => s.name === name);
  if (isBuiltin) {
    hideSkill(name);
    return { ok: true, source: "builtin", name };
  }
  await deleteCustomSkill(name);
  return { ok: true, source: "custom", name };
}
