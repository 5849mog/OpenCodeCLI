/**
 * skills/index.ts — Skill 能力核心。
 *
 * Skill = 可加载的技能包（SKILL.md），AI 通过 list_skills / load_skill
 * 按需加载。内容绝不经 system prompt 注入（保持 STATIC_SYSTEM_PROMPT
 * 前缀稳定，API 缓存命中不被破坏）——skill 全文作为工具结果返回。
 *
 * 存储：
 *  - 内置 skills：代码资源（本文件写死），天然不可删改。
 *  - 用户自定义：VFS `skills/<name>/SKILL.md`，通过 zip 导入 / 文件袋上传。
 *    该目录由 session.ts 的写工具拦截保护（AI 不可随意删改）。
 */

import { vfs } from "@/lib/vfs";

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

/** 扫描 VFS skills/ 目录，发现用户自定义 skill（无 content，省 token）。 */
function discoverCustomSkills(): SkillMeta[] {
  const metas: SkillMeta[] = [];
  try {
    const entries = vfs.listSync("skills");
    for (const entry of entries) {
      if (entry.type !== "dir") continue;
      const name = entry.path.split("/").pop() ?? entry.path;
      const md = vfs.readFileSync(`skills/${name}/SKILL.md`);
      if (md === null) continue;
      metas.push({
        name,
        description: extractCustomDescription(md),
        source: "custom",
      });
    }
  } catch {
    /* skills/ 不存在或不可读 — 忽略 */
  }
  return metas;
}

/** 列出所有可用 skill。同名时自定义覆盖内置（替换语义），source 标 custom。 */
export function listSkills(): SkillMeta[] {
  const hidden = hiddenSet();
  const custom = discoverCustomSkills();
  const customNames = new Set(custom.map((s) => s.name));
  const builtin = BUILTIN_SKILLS
    .filter((s) => !hidden.has(s.name) && !customNames.has(s.name)) // 同名被自定义替换
    .map(({ name, description, source }) => ({ name, description, source }));
  return [...custom, ...builtin];
}

/** 加载指定 skill。同名时自定义优先（替换内置）；内置被隐藏返回 null。 */
export function loadSkill(name: string): Skill | null {
  // 自定义优先（同名可覆盖内置）
  try {
    const md = vfs.readFileSync(`skills/${name}/SKILL.md`);
    if (md !== null) {
      return { name, description: extractCustomDescription(md), source: "custom", content: md };
    }
  } catch {
    /* fall through to builtin */
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

/** 创建/覆盖一个自定义 skill（VFS skills/<name>/SKILL.md）。若首行不是
 *  `# 标题`，自动补一行（保证 list_skills 能正确提取描述）。 */
export function createSkill(name: string, content: string): { ok: boolean; name: string; error?: string } {
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
  vfs.writeFileSync(`skills/${normalized}/SKILL.md`, final);
  return { ok: true, name: normalized };
}

/** 删除一个 skill。custom → 物理删 VFS 目录；内置 → 记入隐藏名单。 */
export function removeSkill(name: string): { ok: boolean; source: "builtin" | "custom"; name: string } {
  const isBuiltin = BUILTIN_SKILLS.some((s) => s.name === name);
  if (isBuiltin) {
    hideSkill(name);
    return { ok: true, source: "builtin", name };
  }
  void vfs.delete(`skills/${name}`);
  return { ok: true, source: "custom", name };
}
