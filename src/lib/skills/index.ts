/**
 * skills/index.ts — Skill 能力核心（文件夹级技能包）。
 *
 * 一个 Skill = 一个完整的文件夹（对齐 Agent Skills 规范）：
 *   <name>/
 *   ├── SKILL.md          必需：YAML frontmatter（name/description/dependencies…）+ Markdown 正文
 *   ├── scripts/          可选：示例脚本 / 可执行步骤
 *   ├── references/       可选：按需查阅的参考文档（cookbook / rubric / API 说明）
 *   └── assets/           可选：模板与其他资源
 *
 * SKILL.md frontmatter 支持的字段：
 *   name          包名（必须与文件夹同名，写入时强制对齐）
 *   description   一句话说明（list_skills 展示，AI 据此判断何时加载）
 *   dependencies  依赖的其他 skill 名（数组）；load_skill 会连带加载依赖的 SKILL.md
 *   version       版本号（展示用）
 *   license       许可证（透传保留）
 *
 * AI 工具面：
 *   list_skills()                 轻量列表（名称/描述/文件数/依赖状态）
 *   load_skill(name)              正文 + 支撑文件树 + 自动连带加载依赖
 *   read_skill_file(name, path)   按需读取支撑文件（渐进式披露，不灌上下文）
 *   create_skill(name, content, files?, dependencies?)  创建完整文件夹
 *   delete_skill(name, force?)    删除（被其他 skill 依赖时要求 force）
 *
 * 存储：
 *  - 内置 skills：代码资源（本文件写死），天然不可删改。
 *  - 用户自定义：独立的 IndexedDB store（`opencode-skills`），与文件袋
 *    VFS 彻底解耦——清空文件袋 / vfs.clear() 不会影响自定义 skill。
 *  - 历史迁移：v1 记录（{name, content} 单文件）在 hydrate 时自动升级为
 *    文件夹记录（content → files["SKILL.md"]）；更早的 VFS skills/ 目录
 *    也在此处一次性迁移。
 */

import { openDB, type IDBPDatabase } from "idb";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { vfs } from "@/lib/vfs"; // 仅用于更早版本 VFS skills/ 记录的一次性迁移

/** 资源上限：防止单个 skill 撑爆存储或上下文。 */
export const SKILL_LIMITS = {
  /** 单个 skill 支撑文件数上限（不含 SKILL.md）。 */
  MAX_FILES: 64,
  /** 单个文本文件字符数上限。 */
  MAX_FILE_CHARS: 256 * 1024,
  /** 单个 skill 全部文件总字符数上限。 */
  MAX_TOTAL_CHARS: 2 * 1024 * 1024,
  /** 单个 base64（二进制）文件解码后字节数上限。 */
  MAX_BINARY_BYTES: 512 * 1024,
  /** read_skill_file 返回正文的截断长度（省 token）。 */
  READ_OUTPUT_CAP: 20_000,
  /** load_skill 连带依赖后的总输出截断长度。 */
  LOAD_TOTAL_CAP: 48_000,
} as const;

/** 独立的自定义 skill 存储库（与文件袋 VFS 不同的 database，互不影响）。 */
const SKILL_DB = "opencode-skills";
const SKILL_STORE = "skills";

export interface SkillFile {
  /** text → UTF-8 文本；base64 → 二进制资源（内容为 base64 串）。 */
  encoding: "text" | "base64";
  content: string;
}

interface StoredSkill {
  name: string;
  /** 文件夹语义：relPath（相对 skill 根，"SKILL.md" 必存在）→ 文件。 */
  files: Record<string, SkillFile>;
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

/** v1 记录（单 content 字符串）→ v2 文件夹记录。 */
function toFolderRecord(rec: object): StoredSkill | null {
  const r = rec as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name : null;
  if (!name) return null;
  if (r.files && typeof r.files === "object") {
    return r as unknown as StoredSkill;
  }
  const content = typeof r.content === "string" ? r.content : "";
  if (!content) return null;
  return {
    name,
    files: { "SKILL.md": { encoding: "text", content } },
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

/** 从独立 store 载入全部自定义 skill 到内存缓存（含 v1 → 文件夹记录的就地升级）。 */
async function hydrateSkills(): Promise<void> {
  if (skillHydrated) return;
  try {
    const db = await getSkillDB();
    const migrated = await migrateLegacyVfsSkills(db);
    if (db) {
      const all = migrated ?? ((await db.getAll(SKILL_STORE)) as Record<string, unknown>[]);
      let upgraded = false;
      for (const raw of all) {
        const rec = toFolderRecord(raw);
        if (!rec) continue;
        skillCache.set(rec.name, rec);
        if (!("files" in raw)) upgraded = true; // v1 记录已转换，回写
      }
      if (upgraded && !migrated) {
        try {
          await db.clear(SKILL_STORE);
          await Promise.all([...skillCache.values()].map((rec) => db.put(SKILL_STORE, rec)));
        } catch {
          /* 回写失败仅影响下次重复转换，不影响使用 */
        }
      }
    }
    skillHydrated = true;
  } catch {
    skillHydrated = true; // 失败也标记，避免反复尝试
  }
}

/**
 * 兼容迁移（最早期版本）：自定义 skill 存在文件袋 VFS `skills/` 目录。
 * 独立 store 为空但 VFS 有旧记录时，读入并存独立 store，然后清理 VFS 旧目录。
 * 返回迁移后的记录（若有）；否则返回 null。
 */
async function migrateLegacyVfsSkills(db: IDBPDatabase | null): Promise<StoredSkill[] | null> {
  try {
    if (db) {
      const existing = (await db.getAll(SKILL_STORE)) as Record<string, unknown>[];
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
      migrated.push(toFolderRecord({ name, content, createdAt: now, updatedAt: now })!);
    }
    if (migrated.length > 0) {
      void vfs.delete("skills");
    }
    return migrated;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SKILL.md 解析 / 序列化（YAML frontmatter）
// ---------------------------------------------------------------------------

export interface ParsedSkillMarkdown {
  /** 解析出的 frontmatter（无 frontmatter 或解析失败 → null）。 */
  frontmatter: Record<string, unknown> | null;
  /** frontmatter 之后的正文（无 frontmatter 时 = 原文）。 */
  body: string;
  /** description：frontmatter 优先，回退到正文首个非标题段落（旧格式兼容）。 */
  description: string;
  /** dependencies：frontmatter 的数组/单字符串 → string[]。 */
  dependencies: string[];
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** 无 frontmatter 时的描述启发式：跳过空行与 1-3 级标题，取首个非空段落首行。 */
function heuristicDescription(md: string): string {
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^#{1,3}\s/.test(t)) continue;
    return t.replace(/^[-*+]\s*/, "").slice(0, 120);
  }
  return "";
}

/**
 * 解析 SKILL.md：剥离 `---` 包裹的 YAML frontmatter，提取 description /
 * dependencies / name / version。frontmatter 损坏时按纯正文处理，绝不抛异常。
 */
export function parseSkillMarkdown(md: string): ParsedSkillMarkdown {
  const text = md.replace(/^\uFEFF/, "");
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (m) {
    try {
      const fm = parseYaml(m[1]);
      if (fm && typeof fm === "object" && !Array.isArray(fm)) {
        const record = fm as Record<string, unknown>;
        const rawDeps = record.dependencies;
        const dependencies = Array.isArray(rawDeps)
          ? rawDeps.map((d) => String(d).trim()).filter(Boolean)
          : typeof rawDeps === "string" && rawDeps.trim()
            ? rawDeps.split(",").map((d) => d.trim()).filter(Boolean)
            : [];
        const descRaw = typeof record.description === "string"
          ? record.description
          : typeof record.description === "number"
            ? String(record.description)
            : null;
        return {
          frontmatter: record,
          body: text.slice(m[0].length),
          description: descRaw !== null ? collapseWhitespace(descRaw) : heuristicDescription(text.slice(m[0].length)),
          dependencies,
        };
      }
    } catch {
      /* frontmatter 损坏 → 当作纯正文 */
    }
  }
  return { frontmatter: null, body: text, description: heuristicDescription(text), dependencies: [] };
}

/**
 * 把 frontmatter（含 dependencies）合并回 Markdown 全文。
 * - 原 frontmatter 的未知字段（license 等）原样保留；
 * - name 强制对齐包名（文件夹绑定）；
 * - deps 非空时写入/覆盖 dependencies；
 * - 原本无 frontmatter 且 deps 为空 → 原样返回（旧格式零打扰）。
 */
export function serializeSkillMarkdown(
  name: string,
  parsed: ParsedSkillMarkdown,
  deps?: string[],
): string {
  const fm = parsed.frontmatter ? { ...parsed.frontmatter } : null;
  if (!fm && (!deps || deps.length === 0)) return parsed.body;
  const ordered: Record<string, unknown> = { name };
  if (fm) {
    if ("description" in fm) ordered.description = fm.description;
    if ("version" in fm) ordered.version = fm.version;
    if ("license" in fm) ordered.license = fm.license;
  }
  if (fm) {
    for (const [k, v] of Object.entries(fm)) {
      if (k in ordered) continue;
      ordered[k] = v;
    }
  }
  if (deps && deps.length > 0) {
    ordered.dependencies = [...new Set(deps)];
  }
  return `---\n${stringifyYaml(ordered).trimEnd()}\n---\n\n${parsed.body.replace(/^\s+/, "")}`;
}

// ---------------------------------------------------------------------------
// 类型（对外视图）
// ---------------------------------------------------------------------------

/** load_skill 返回的完整视图：正文 + frontmatter + 文件夹内容。 */
export interface Skill {
  name: string;
  description: string;
  source: "builtin" | "custom";
  /** SKILL.md 正文（frontmatter 已剥离）。 */
  body: string;
  /** 解析出的 frontmatter（旧格式无 frontmatter → null）。 */
  frontmatter: Record<string, unknown> | null;
  dependencies: string[];
  version?: string;
  /** 全部文件（含 SKILL.md 原文），relPath → 文件。UI 文件树 / 导出用。 */
  files: Record<string, SkillFile>;
  fileCount: number;
}

/** list_skills 返回的轻量信息（不含正文与文件内容，省 token）。 */
export interface SkillMeta {
  name: string;
  description: string;
  source: "builtin" | "custom";
  /** 文件总数（含 SKILL.md）。 */
  fileCount: number;
  /** frontmatter 声明的依赖。 */
  dependencies: string[];
  /** 其中当前不可用（未安装/被隐藏）的依赖。 */
  missingDependencies: string[];
  /** 反向依赖：哪些已安装 skill 声明依赖本 skill。 */
  dependents: string[];
  version?: string;
}

// ---------------------------------------------------------------------------
// 内置 skills（文件夹形制：SKILL.md frontmatter + references/）
// ---------------------------------------------------------------------------

interface BuiltinSkillDef {
  name: string;
  description: string;
  files: Record<string, SkillFile>;
}

function md(content: string): SkillFile {
  return { encoding: "text", content: content.trimStart() };
}

const BUILTIN_SKILL_DEFS: BuiltinSkillDef[] = [
  {
    name: "code-review",
    description:
      "审查代码找 bug / 质量问题：静态审查 + 对 JS/Lua 用 run_js/run_lua 真跑验证，输出证据化结论（文件:行号、问题、严重度、修复建议）。",
    files: {
      "SKILL.md": md(`---
name: code-review
description: 审查代码找 bug / 质量问题：静态审查 + 对 JS/Lua 真跑验证，输出证据化结论（文件:行号、严重度、修复建议）。
version: 1.1.0
---

# Code Review Skill

审查代码时遵循以下流程：

## 1. 静态审查（所有语言）
- 逐文件读代码，重点找：逻辑错误、边界条件（空数组/0/负数/null）、
  空值解引用、竞态、资源未释放、错误被吞。
- 用 \`view_outline\` 快速了解结构，再 \`read_file\` 读关键段。
- 记录每个问题的 \`文件:行号\`、类型、严重度。

> 严重度评级标准见 \`references/severity-rubric.md\`（read_skill_file 读取）。

## 2. 真实运行验证（仅 JS / Lua）
- 代码是 **JavaScript**：用 \`run_js\` 写测试脚本真跑——
  \`script\` 里断言期望输出，\`throw new Error(...)\` 即失败。
- 代码是 **Lua**：用 \`run_lua\` 同样写断言脚本跑。
- 边界用例优先：空输入、单元素、大输入、非法输入。

## 3. 输出格式（证据化结论）
按严重度从高到低列出问题，每条格式：

\`\`\`
- [严重度] \`文件:行号\` — 问题描述
  修复建议：…
\`\`\`

- 无 bug 也要明确说"未发现问题"，不臆断。
- 验证失败即停（Tool failure protocol），不假装通过。
`),
      "references/severity-rubric.md": md(`# 严重度评级标准

## critical — 必须修复，否则功能错误 / 数据损坏
- 崩溃、死循环、无限递归
- 数据丢失或写坏（覆盖错误文件、越界写）
- 安全漏洞（注入、路径逃逸、密钥泄露）
- 核心流程逻辑颠倒（条件写反、返回值用错）

## major — 功能受损或明显错误，但有绕过路径
- 边界条件出错：空数组、0、负数、null/undefined 解引用
- 错误被吞（catch 后不处理不上报），调用方拿到假成功
- 资源未释放（定时器、监听器、句柄泄漏）
- 竞态：异步结果乱序、状态更新丢失

## minor — 不影响正确性的质量问题
- 命名误导、重复代码可提取
- 缺少类型标注 / 注释与实现不符
- 性能小问题（循环里重复计算、可缓存未缓存）

## 证据要求
- 每条问题必须给出 \`文件:行号\` 和一句代码摘录，禁止"可能有问题"式臆断。
- 不确定就标注 [需确认]，并说明验证方式。
`),
    },
  },
  {
    name: "data-analysis",
    description:
      "数据分析工作流：parse_csv/parse_yaml 读数据 → query_json 过滤聚合 → math 计算 → chart 代码块可视化。",
    files: {
      "SKILL.md": md(`---
name: data-analysis
description: 数据分析工作流：parse_csv/parse_yaml 读数据 → query_json 过滤聚合 → math 计算 → chart 代码块可视化。
version: 1.1.0
---

# Data Analysis Skill

分析数据时按这个工作流，别用 bash 字符串硬凑：

## 1. 读数据（选对应工具）
- CSV → \`parse_csv(path)\`（json 对象数组 / table / array）
- YAML → \`parse_yaml(path)\`（转 JSON 输出）
- JSON → \`query_json(path, expression)\`

## 2. 处理与聚合
- 过滤 / 选字段 / 重组 → \`query_json\` 的 JSONata 表达式
- 数值计算 → \`math(expression)\`（mean/median/std、矩阵、单位换算）
- 多文件关联 / 复杂转换 → \`run_js\` 或 \`run_lua\` 写脚本处理

> 常用 JSONata 表达式（过滤、聚合、分组、排序）速查：
> \`references/jsonata-cookbook.md\`（read_skill_file 读取）。

## 3. 可视化（用 chart 代码块）
把结果渲染成图表，代码块语言用 \`chart\`，body 是 JSON 配置。
配置项与深色主题注意事项见 \`references/chart-config.md\`。

## 4. 汇报
- 给结论 + 关键数字 + 图表，别贴原始数据堆。
- 数据量大时先聚合再汇报。
`),
      "references/jsonata-cookbook.md": md(`# JSONata 速查（配合 query_json）

## 取字段 / 过滤
- \`$.users.name\` — 所有用户的名字
- \`$.users[age>30].name\` — 年龄 >30 的名字
- \`$.orders[status='paid']\` — 等值过滤
- \`$.items[0:5]\` — 前 5 条
- \`$.logs[$.level='error']\` — 嵌套字段条件

## 聚合
- \`$sum($.items.price)\` — 求和
- \`$average($.scores)\` — 均值
- \`$max($.x)\` / \`$min($.x)\` — 极值
- \`$count($.rows)\` — 计数

## 分组 / 重塑
- \`$.users.{"name": fullName, "age": age}\` — 重命名投影
- 复杂分组（group by 键聚合）优先用 run_js 写脚本，别硬凑嵌套 JSONata

## 排序 / 去重
- \`$sort($.rows, function($l, $r){$l.ts - $r.ts})\`
- \`$distinct($.tags)\`

## 原则
- 表达式写不出来就换 run_js 写脚本，别硬凑嵌套 JSONata。
`),
      "references/chart-config.md": md(`# chart 代码块配置

代码块语言用 \`chart\`，body 是 JSON：

\`\`\`chart
{"type":"bar","data":{"labels":["A","B"],"datasets":[{"label":"x","data":[1,2]}]}}
\`\`\`

## type
- bar（柱状）/ line（折线）/ pie（饼）/ scatter（散点）

## data
- labels: X 轴类目数组
- datasets: [{ label, data, backgroundColor? }]
- 多数据集直接并列多个 dataset（分组柱状 / 多折线）

## 常用选项
- 水平柱状：bar + \`{"indexAxis":"y"}\`
- 堆叠：\`{"options":{"scales":{"x":{"stacked":true},"y":{"stacked":true}}}}\`
- 平滑折线：dataset 加 \`"tension":0.35\`

## 主题
- 深色主题默认浅色文字，无需手动配色；给系列配色时用品牌橙 #E58F67 起步。
`),
    },
  },
  {
    name: "diagram",
    description:
      "画图指南：根据图形复杂度选 mermaid / graphviz(dot) / chart 三种代码块语言，输出即渲染为 SVG/图表。",
    files: {
      "SKILL.md": md(`---
name: diagram
description: 画图指南：根据图形复杂度选 mermaid / graphviz(dot) / chart 三种代码块语言，输出即渲染为 SVG/图表。
version: 1.1.0
---

# Diagram Skill

需要画图时，按复杂度和类型选对代码块语言（输出会自动渲染）：

## 1. Mermaid（通用流程图 / 时序 / 简单图）
适合：flowchart、sequence、class、state、gantt、mindmap 等常规图。

## 2. Graphviz / DOT（复杂图、依赖图、架构图、DAG）
适合：节点多、需要精确布局、依赖关系、大型架构图——
mermaid 在复杂图上会乱，DOT 的 dot/neato 布局引擎更专业。

## 3. Chart.js（数据图表）
适合：柱状/折线/饼/散点等数据可视化（与 data-analysis 配合）。

> 两种语言的可直接套用模板与易错点：
> \`references/mermaid-cookbook.md\`、\`references/dot-cookbook.md\`（read_skill_file 读取）。

## 选择原则
- 数据图表 → chart；复杂拓扑/依赖 → dot；其他 → mermaid。
- 代码块直接输出，无需额外步骤。
`),
      "references/mermaid-cookbook.md": md(`# Mermaid 模板速查

## 流程图
\`\`\`mermaid
flowchart LR
  A[开始] --> B{判断}
  B -->|是| C[结束]
  B -->|否| D[继续]
\`\`\`

## 时序图
\`\`\`mermaid
sequenceDiagram
  participant U as 用户
  participant S as 服务端
  U->>S: 请求
  S-->>U: 响应
\`\`\`

## 状态图
\`\`\`mermaid
stateDiagram-v2
  [*] --> idle
  idle --> running: start
  running --> idle: stop
\`\`\`

## 易错点
- 节点文字含特殊字符（括号/冒号）时用引号包起来：A["f(x): 说明"]
- 复杂拓扑（>15 节点、交叉边多）别硬画，换 dot。
`),
      "references/dot-cookbook.md": md(`# Graphviz DOT 模板速查

## 基础 DAG（依赖图）
\`\`\`dot
digraph G {
  rankdir=LR;
  "web" -> "api" -> "db";
  "api" -> "cache";
}
\`\`\`

## 分组（cluster）
\`\`\`dot
digraph G {
  rankdir=TB;
  subgraph cluster_front {
    label="前端";
    a; b;
  }
  subgraph cluster_back {
    label="后端";
    c;
  }
  a -> c; b -> c;
}
\`\`\`

## 边标注 / 节点形状
- 边标注：\`a -> b [label="30ms"]\`
- 形状：node [shape=box] / cylinder（存储）/ diamond（判断）
- 方向：rankdir=LR | TB

## 布局引擎
- dot（默认，层级）适合 DAG；neato/fdp 适合网状无向图。
`),
    },
  },
  {
    name: "report",
    description:
      "生成结构化报告（周报/分析报告/复盘）：依赖 data-analysis 出数字与图表、diagram 出架构/流程图，汇总为分节报告。",
    files: {
      "SKILL.md": md(`---
name: report
description: 生成结构化报告（周报/分析报告/复盘）：依赖 data-analysis 出数字与图表、diagram 出流程图，汇总为分节报告。
version: 1.0.0
dependencies:
  - data-analysis
  - diagram
---

# Report Skill

生成结构化报告（周报 / 数据报告 / 项目复盘）时遵循本流程。
本 skill 依赖 \`data-analysis\` 与 \`diagram\`（load_skill 已连带加载其指令，
直接按那两份指令做分析与画图即可）。

## 1. 定结构（先问后写）
- 常规报告直接用：结论摘要 → 关键指标 → 明细分析 → 图表 → 风险与建议。
- 用户指定过格式（如团队周报模板）优先用户的。

## 2. 数据与图
- 数字和图表按 \`data-analysis\` 的工作流产出，图表用 chart 代码块。
- 流程 / 架构说明按 \`diagram\` 选择 mermaid 或 dot。

## 3. 成稿原则
- 每节先给一句话结论，再给支撑数据。
- 图表编号并在正文引用（"见图 1"）。
- 报告较长时用 write_file 落成 Markdown 文件再让用户下载，别整篇塞在回复里。
`),
    },
  },
];

/** 内置 skill（folder 记录形制，source=builtin 由外层区分）。 */
const BUILTIN_SKILLS: BuiltinSkillDef[] = BUILTIN_SKILL_DEFS;

// ---------------------------------------------------------------------------
// 内置 skill 的隐藏名单（删除语义）
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

// ---------------------------------------------------------------------------
// 存储读写
// ---------------------------------------------------------------------------

/** 写入一个自定义 skill 文件夹记录（更新内存缓存 + 后台持久化）。 */
async function writeCustomSkill(rec: StoredSkill): Promise<void> {
  skillCache.set(rec.name, rec);
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

function bumpSkillVersion(): void {
  skillVersion++;
  for (const fn of skillListeners) fn();
}

// ---------------------------------------------------------------------------
// 发现 + 加载
// ---------------------------------------------------------------------------

function builtinToRecord(def: BuiltinSkillDef): StoredSkill {
  return { name: def.name, files: def.files, createdAt: 0, updatedAt: 0 };
}

function frontmatterVersion(fm: Record<string, unknown> | null): string | undefined {
  const v = fm?.version;
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined;
}

function recordToSkill(name: string, files: Record<string, SkillFile>, source: "builtin" | "custom", fallbackDesc?: string): Skill {
  const skmd = files["SKILL.md"]?.content ?? "";
  const parsed = parseSkillMarkdown(skmd);
  return {
    name,
    description: fallbackDesc ?? parsed.description,
    source,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    dependencies: parsed.dependencies,
    version: frontmatterVersion(parsed.frontmatter),
    files,
    fileCount: Object.keys(files).length,
  };
}

function allInstalledRecords(): { name: string; files: Record<string, SkillFile>; source: "builtin" | "custom"; fallbackDesc?: string }[] {
  const hidden = hiddenSet();
  const out: { name: string; files: Record<string, SkillFile>; source: "builtin" | "custom"; fallbackDesc?: string }[] = [];
  for (const rec of skillCache.values()) out.push({ name: rec.name, files: rec.files, source: "custom" });
  const customNames = new Set(skillCache.keys());
  for (const def of BUILTIN_SKILLS) {
    if (!hidden.has(def.name) && !customNames.has(def.name)) {
      out.push({ name: def.name, files: def.files, source: "builtin", fallbackDesc: def.description });
    }
  }
  return out;
}

/** 列出所有可用 skill（含文件数、依赖解析状态、反向依赖）。同名时自定义覆盖内置。 */
export async function listSkills(): Promise<SkillMeta[]> {
  await hydrateSkills();
  const installed = allInstalledRecords();
  const available = new Set(installed.map((s) => s.name));
  const dependentsBy = new Map<string, string[]>();
  for (const s of installed) {
    const parsed = parseSkillMarkdown(s.files["SKILL.md"]?.content ?? "");
    for (const dep of parsed.dependencies) {
      const list = dependentsBy.get(dep) ?? [];
      list.push(s.name);
      dependentsBy.set(dep, list);
    }
  }
  return installed.map((s) => {
    const skill = recordToSkill(s.name, s.files, s.source, s.fallbackDesc);
    const missing = skill.dependencies.filter((d) => !available.has(d));
    return {
      name: skill.name,
      description: skill.description,
      source: skill.source,
      fileCount: skill.fileCount,
      dependencies: skill.dependencies,
      missingDependencies: missing,
      dependents: dependentsBy.get(skill.name) ?? [],
      version: skill.version,
    };
  });
}

/** 加载指定 skill（完整视图）。同名时自定义优先；内置被隐藏返回 null。 */
export async function loadSkill(name: string): Promise<Skill | null> {
  await hydrateSkills();
  const custom = skillCache.get(name);
  if (custom) return recordToSkill(name, custom.files, "custom");
  const builtin = BUILTIN_SKILLS.find((s) => s.name === name);
  if (builtin && !hiddenSet().has(name)) {
    return recordToSkill(name, builtin.files, "builtin", builtin.description);
  }
  return null;
}

/** load_skill 的连带加载结果：主 skill + 依赖闭包（BFS，环安全）。 */
export interface SkillWithDeps {
  main: Skill | null;
  /** 依赖闭包（含传递依赖），按加载顺序，depth 1 = 直接依赖。 */
  deps: { skill: Skill; depth: number }[];
  /** 声明了但找不到的依赖名。 */
  missing: string[];
  /** 连带内容达到 LOAD_TOTAL_CAP 被截断。 */
  truncated: boolean;
}

/**
 * 加载一个 skill 及其依赖闭包（专业语义：装 A 自动带上 A 依赖的 B/C）。
 * 直接依赖 → depth 1；依赖的依赖 → depth 2…；循环依赖用 visited 剪掉。
 */
export async function loadSkillWithDependencies(name: string): Promise<SkillWithDeps> {
  const main = await loadSkill(name);
  if (!main) return { main: null, deps: [], missing: [], truncated: false };
  const deps: { skill: Skill; depth: number }[] = [];
  const missing: string[] = [];
  let truncated = false;
  let total = main.body.length;
  const visited = new Set<string>([name]);
  let frontier: { name: string; depth: number }[] = main.dependencies.map((d) => ({ name: d, depth: 1 }));
  while (frontier.length > 0) {
    const next: { name: string; depth: number }[] = [];
    for (const { name: depName, depth } of frontier) {
      if (visited.has(depName)) continue;
      visited.add(depName);
      const dep = await loadSkill(depName);
      if (!dep) {
        missing.push(depName);
        continue;
      }
      if (total + dep.body.length > SKILL_LIMITS.LOAD_TOTAL_CAP) {
        truncated = true;
        continue;
      }
      total += dep.body.length;
      deps.push({ skill: dep, depth });
      next.push(...dep.dependencies.map((d) => ({ name: d, depth: depth + 1 })));
    }
    frontier = next;
  }
  return { main, deps, missing, truncated };
}

/** 校验支撑文件路径：相对 skill 根，无 `..`、无反斜杠、不以 `/` 开头、非空。 */
export function validateSkillRelPath(path: string): string | null {
  const p = path.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
  if (!p) return "文件路径不能为空";
  if (p.includes("..")) return "文件路径不能包含 ..";
  if (p.length > 256) return "文件路径过长";
  if (/^SKILL\.md$/i.test(p)) return "SKILL.md 请通过 content 参数修改";
  return null;
}

function normalizeRelPath(path: string): string | null {
  const p = path.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
  if (!p || p.includes("..") || p.length > 256 || /^SKILL\.md$/i.test(p)) return null;
  return p;
}

function checkFilesFit(files: Record<string, SkillFile>, adding?: { path: string; content: string; encoding: "text" | "base64" }): string | null {
  const supportCount =
    Object.keys(files).filter((k) => !/^SKILL\.md$/i.test(k) && (!adding || k !== adding.path)).length +
    (adding ? 1 : 0);
  if (supportCount > SKILL_LIMITS.MAX_FILES) {
    return `支撑文件数超上限（≤${SKILL_LIMITS.MAX_FILES}，不含 SKILL.md）`;
  }
  let total = Object.entries(files).reduce((acc, [k, f]) => acc + (adding && k === adding.path ? 0 : f.content.length), 0);
  if (adding) {
    if (adding.encoding === "text" && adding.content.length > SKILL_LIMITS.MAX_FILE_CHARS) {
      return `单个文件超上限（≤${Math.floor(SKILL_LIMITS.MAX_FILE_CHARS / 1024)}KB 字符）`;
    }
    if (adding.encoding === "base64" && (adding.content.length * 3) / 4 > SKILL_LIMITS.MAX_BINARY_BYTES) {
      return `二进制文件超上限（≤${Math.floor(SKILL_LIMITS.MAX_BINARY_BYTES / 1024)}KB）`;
    }
    total += adding.content.length;
  }
  if (total > SKILL_LIMITS.MAX_TOTAL_CHARS) {
    return `skill 总大小超上限（≤${Math.floor(SKILL_LIMITS.MAX_TOTAL_CHARS / 1024 / 1024)}MB）`;
  }
  return null;
}

/** 按需读取 skill 内的支撑文件（渐进式披露：正文之外的内容走这里）。 */
export async function readSkillFile(
  name: string,
  path: string,
): Promise<{ ok: boolean; content?: string; binary?: boolean; error?: string }> {
  const skill = await loadSkill(name);
  if (!skill) return { ok: false, error: `skill '${name}' 不存在` };
  const normalized = normalizeRelPath(path);
  if (!normalized) return { ok: false, error: `非法文件路径: ${path}` };
  const file = skill.files[normalized];
  if (!file) {
    const tree = Object.keys(skill.files).sort().join(", ");
    return { ok: false, error: `skill '${name}' 中不存在 '${normalized}'。现有文件: ${tree}` };
  }
  if (file.encoding === "base64") {
    const bytes = Math.floor((file.content.length * 3) / 4);
    return { ok: true, binary: true, content: `[二进制文件: ${normalized}，${bytes} 字节，已存储为 base64 — 文本内容不可展示]` };
  }
  if (file.content.length > SKILL_LIMITS.READ_OUTPUT_CAP) {
    return { ok: true, content: file.content.slice(0, SKILL_LIMITS.READ_OUTPUT_CAP) + `\n\n…[已截断，完整 ${file.content.length} 字符]` };
  }
  return { ok: true, content: file.content };
}

// ---------------------------------------------------------------------------
// 创建 / 修改 / 删除（AI 工具 + UI 共用）
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

export interface CreateSkillOptions {
  /** 支撑文件（relPath → 文本内容），随 SKILL.md 一起写入文件夹。 */
  files?: Record<string, string>;
  /** 依赖的其他 skill 名（写入 frontmatter.dependencies）。 */
  dependencies?: string[];
}

/**
 * 创建/覆盖一个自定义 skill 文件夹。
 * - content 为 SKILL.md 全文（可带 YAML frontmatter；无 frontmatter 且首行无
 *   `# 标题` 时自动补一行，保证旧格式描述提取可用）。
 * - files 为支撑文件（scripts/references/assets…），路径校验 + 上限校验；
 *   **未传 files 且 skill 已存在时保留既有支撑文件**（编辑 SKILL.md 语义），
 *   传了则整体替换。
 * - dependencies 非空时合并进 frontmatter（未传时保留既有依赖）。
 */
export async function createSkill(
  name: string,
  content: string,
  opts?: CreateSkillOptions,
): Promise<{ ok: boolean; name: string; error?: string }> {
  const err = validateSkillName(name);
  if (err) return { ok: false, name, error: err };
  const normalized = name.trim();
  let trimmed = content.trim();
  if (!trimmed) return { ok: false, name, error: "SKILL.md 内容不能为空" };
  await hydrateSkills();
  const existing = skillCache.get(normalized);
  // 无 frontmatter 且首行不带标题 → 前置一行标题（旧格式兼容）
  const parsed = parseSkillMarkdown(trimmed);
  if (!parsed.frontmatter && !trimmed.split("\n")[0].trim().startsWith("#")) {
    trimmed = `# ${normalized}\n\n${trimmed}`;
  }
  // 组装支撑文件
  const files: Record<string, SkillFile> = {};
  if (opts?.files) {
    for (const [rawPath, rawContent] of Object.entries(opts.files)) {
      const p = normalizeRelPath(String(rawPath));
      if (!p) return { ok: false, name, error: `非法支撑文件路径: ${rawPath}` };
      if (p in files) return { ok: false, name, error: `支撑文件路径冲突: ${p}` };
      files[p] = { encoding: "text", content: String(rawContent) };
    }
  } else if (existing) {
    // 未显式传 files → 保留既有支撑文件（任何编码）
    for (const [p, f] of Object.entries(existing.files)) {
      if (!/^SKILL\.md$/i.test(p)) files[p] = f;
    }
  }
  files["SKILL.md"] = { encoding: "text", content: trimmed };
  const fitErr = checkFilesFit(files);
  if (fitErr) return { ok: false, name, error: fitErr };
  // 依赖 → frontmatter（未传时保留既有）
  const deps = (opts?.dependencies ?? (existing ? parseSkillMarkdown(existing.files["SKILL.md"]?.content ?? "").dependencies : []))
    .map((d) => String(d).trim())
    .filter(Boolean);
  const finalParsed = parseSkillMarkdown(trimmed);
  const skmd = serializeSkillMarkdown(normalized, finalParsed, deps.length > 0 ? deps : undefined);
  files["SKILL.md"] = { encoding: "text", content: skmd };
  const now = Date.now();
  await writeCustomSkill({
    name: normalized,
    files,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  return { ok: true, name: normalized };
}

/** 新增/替换一个支撑文件（文本）。路径不能是 SKILL.md（走 createSkill）。 */
export async function updateSkillFile(
  name: string,
  path: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  await hydrateSkills();
  const rec = skillCache.get(name);
  if (!rec) return { ok: false, error: `skill '${name}' 不存在（仅自定义 skill 支持文件编辑）` };
  const p = normalizeRelPath(path);
  if (!p) return { ok: false, error: `非法文件路径: ${path}` };
  const fitErr = checkFilesFit(rec.files, { path: p, content, encoding: "text" });
  if (fitErr) return { ok: false, error: fitErr };
  rec.files = { ...rec.files, [p]: { encoding: "text", content } };
  rec.updatedAt = Date.now();
  await writeCustomSkill(rec);
  return { ok: true };
}

/** 删除一个支撑文件。 */
export async function deleteSkillFile(name: string, path: string): Promise<{ ok: boolean; error?: string }> {
  await hydrateSkills();
  const rec = skillCache.get(name);
  if (!rec) return { ok: false, error: `skill '${name}' 不存在` };
  const p = normalizeRelPath(path);
  if (!p) return { ok: false, error: `非法文件路径: ${path}` };
  if (!(p in rec.files)) return { ok: false, error: `文件不存在: ${p}` };
  const rest = { ...rec.files };
  delete rest[p];
  rec.files = rest;
  rec.updatedAt = Date.now();
  await writeCustomSkill(rec);
  return { ok: true };
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

// ---------------------------------------------------------------------------
// 导出 / 导入（JSON 备份；.zip 文件夹包见 ./transfer）
// ---------------------------------------------------------------------------

/** 导出全部**自定义** skill（v2 文件夹 schema：{name, files}）。内置不导出。 */
export async function exportSkills(): Promise<{ name: string; files: Record<string, SkillFile> }[]> {
  await hydrateSkills();
  return [...skillCache.values()].map(({ name, files }) => ({ name, files }));
}

/** 单个 skill 导入结果。 */
export interface ImportedSkill {
  name: string;
  status: "added" | "skipped" | "invalid";
  error?: string;
  fileCount?: number;
  dependencies?: string[];
}

/**
 * 批量导入自定义 skill（JSON 备份）。兼容 v1（{name, content}）与 v2（{name, files}）。
 * - 名称非法 / 内容为空 → invalid（跳过）
 * - 合法 → createSkill 写入（同名覆盖），记为 added
 */
export async function importSkills(
  list: { name: string; content?: string; files?: Record<string, SkillFile> }[],
): Promise<ImportedSkill[]> {
  const results: ImportedSkill[] = [];
  for (const item of list ?? []) {
    const name = String(item?.name ?? "").trim();
    if (!name) { results.push({ name, status: "invalid", error: "缺 name" }); continue; }
    const err = validateSkillName(name);
    if (err) { results.push({ name, status: "invalid", error: err }); continue; }
    let skmd = "";
    const supportFiles: Record<string, string> = {};
    if (item.files && typeof item.files === "object") {
      for (const [p, f] of Object.entries(item.files)) {
        if (/^SKILL\.md$/i.test(p)) {
          skmd = f.encoding === "text" ? f.content : "";
          continue;
        }
        if (f.encoding === "text") supportFiles[p] = f.content;
      }
    } else if (typeof item.content === "string") {
      skmd = item.content;
    }
    if (!skmd.trim()) { results.push({ name, status: "invalid", error: "SKILL.md 内容为空" }); continue; }
    const parsed = parseSkillMarkdown(skmd);
    const res = await createSkill(name, skmd, { files: supportFiles, dependencies: parsed.dependencies });
    if (res.ok) {
      results.push({ name, status: "added", fileCount: Object.keys(supportFiles).length + 1, dependencies: parsed.dependencies });
    } else {
      results.push({ name, status: "invalid", error: res.error });
    }
  }
  return results;
}
