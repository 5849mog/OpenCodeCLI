/**
 * data-tools.ts — 轻量数据解析 + 数学计算工具
 *
 * 四个独立工具，纯 JS 库，VFS 纯 string 即可承载（无二进制需求）：
 *   - parse_yaml(path)      — YAML → JSON（yaml 包）
 *   - parse_csv(path, fmt?) — CSV → JSON / 表格（PapaParse，正确处理引号/转义）
 *   - query_json(path, exp) — JSONata 表达式查询/转换 JSON（jsonata 包）
 *   - math(expression)      — mathjs 求值（矩阵/单位/函数/统计）
 *
 * 全部只读：不进 MUTATING_TOOLS，Plan 模式可用。
 */

import { parse as parseYaml } from "yaml";
import Papa from "papaparse";
import jsonata from "jsonata";
import { evaluate as mathEvaluate, format as mathFormat } from "mathjs";
import { vfs } from "../vfs";
import type { ToolResult } from "./types";

/** 防滥用上限：math 表达式最长字符数。 */
const MATH_EXPR_MAX = 1000;
/** 输出上限：防超大结果撑爆上下文。 */
const OUTPUT_MAX_CHARS = 20_000;

function trimOutput(text: string): string {
  if (text.length <= OUTPUT_MAX_CHARS) return text;
  return `${text.slice(0, OUTPUT_MAX_CHARS)}\n… [truncated: ${text.length - OUTPUT_MAX_CHARS} more chars]`;
}

/** 读取一个工作区文件，不存在返回错误 ToolResult。 */
function readFileOrError(path: string, tool: string, args: Record<string, unknown>): { content: string } | ToolResult {
  if (!path) {
    return { ok: false, output: `${tool}: missing 'path' — 需要指定工作区文件路径`, tool, args };
  }
  const content = vfs.readFileSync(path);
  if (content === null) {
    return { ok: false, output: `${tool}: ${path}: not found`, tool, args };
  }
  return { content };
}

// ---------------------------------------------------------------------------
// parse_yaml
// ---------------------------------------------------------------------------

export async function toolParseYaml(args: Record<string, unknown>): Promise<ToolResult> {
  const path = String(args.path ?? "");
  const read = readFileOrError(path, "parse_yaml", args);
  if ("content" in read) {
    try {
      const parsed = parseYaml(read.content);
      // YAML 顶层可能是标量；undefined（空文件）→ null
      const json = JSON.stringify(parsed ?? null, null, 2);
      return { ok: true, output: trimOutput(json), tool: "parse_yaml", args };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, output: `parse_yaml: YAML 解析失败: ${msg}`, tool: "parse_yaml", args };
    }
  }
  return read;
}

// ---------------------------------------------------------------------------
// parse_csv
// ---------------------------------------------------------------------------

export async function toolParseCsv(args: Record<string, unknown>): Promise<ToolResult> {
  const path = String(args.path ?? "");
  const fmt = String(args.format ?? "json");
  const read = readFileOrError(path, "parse_csv", args);
  if (!("content" in read)) return read;

  const result = Papa.parse<string[]>(read.content, { skipEmptyLines: "greedy" });
  if (result.errors.length > 0) {
    const first = result.errors[0];
    return {
      ok: false,
      output: `parse_csv: 解析失败 — row ${(first.row ?? 0) + 1}: ${first.message}`,
      tool: "parse_csv",
      args,
    };
  }
  if (result.data.length === 0) {
    return { ok: true, output: "(empty CSV)", tool: "parse_csv", args };
  }

  // 表头 = 第一行
  const header = result.data[0];
  const rows = result.data.slice(1);

  if (fmt === "table") {
    // 对齐的文本表格
    const widths = header.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)),
    );
    const pad = (cell: string, w: number) => cell.padEnd(w);
    const line = (row: string[]) => row.map((c, i) => pad(String(c ?? ""), widths[i])).join(" | ");
    const sep = widths.map((w) => "-".repeat(w)).join("-+-");
    return {
      ok: true,
      output: [line(header), sep, ...rows.map(line)].join("\n"),
      tool: "parse_csv",
      args,
    };
  }

  // 默认 json：对象数组（用 header 作为 key），或者纯二维数组
  if (fmt === "array") {
    return { ok: true, output: JSON.stringify(result.data, null, 2), tool: "parse_csv", args };
  }
  const objects = rows.map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = r[i] ?? ""; });
    return o;
  });
  return { ok: true, output: trimOutput(JSON.stringify(objects, null, 2)), tool: "parse_csv", args };
}

// ---------------------------------------------------------------------------
// query_json
// ---------------------------------------------------------------------------

export async function toolQueryJson(args: Record<string, unknown>): Promise<ToolResult> {
  const path = String(args.path ?? "");
  const expression = String(args.expression ?? "$");
  const read = readFileOrError(path, "query_json", args);
  if (!("content" in read)) return read;

  let data: unknown;
  try {
    data = JSON.parse(read.content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, output: `query_json: ${path} 不是合法 JSON: ${msg}`, tool: "query_json", args };
  }

  try {
    const expr = jsonata(expression);
    const result = await expr.evaluate(data);
    const json = JSON.stringify(result ?? null, null, 2);
    return { ok: true, output: trimOutput(json), tool: "query_json", args };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      output: `query_json: 表达式执行失败: ${msg}\n  提示: 表达式如 "$.users[age>30].name"；用 "$" 读全文。`,
      tool: "query_json",
      args,
    };
  }
}

// ---------------------------------------------------------------------------
// math
// ---------------------------------------------------------------------------

export async function toolMath(args: Record<string, unknown>): Promise<ToolResult> {
  const expression = String(args.expression ?? "").trim();
  if (!expression) {
    return { ok: false, output: "math: missing 'expression' — 如 \"mean([1,2,3])\"、\"5 km + 3 mile\"、\"[1,2;3,4]*[2;3]\"", tool: "math", args };
  }
  if (expression.length > MATH_EXPR_MAX) {
    return { ok: false, output: `math: 表达式超过 ${MATH_EXPR_MAX} 字符上限`, tool: "math", args };
  }
  try {
    const result = mathEvaluate(expression);
    const text = mathFormat(result, { precision: 10 });
    return { ok: true, output: text, tool: "math", args };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, output: `math: 求值失败: ${msg}`, tool: "math", args };
  }
}
