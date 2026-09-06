/**
 * bash/context.ts — bash 沙箱各命令族共享的状态与工具函数。
 * cwd 是会话级状态（非真实 chdir）：resolvePath 把相对路径拼上 cwd。
 */
import { vfs, grepSync } from "../../vfs";

export { vfs, grepSync };

/** 会话级工作目录（VFS 根相对，空 = 根目录）。`cd` 会更新它。 */
let cwd = "";

export function getCwd(): string {
  return cwd;
}

export function setCwd(next: string): void {
  cwd = next;
}

/** 解析路径：相对路径（不以 / 开头、非空）且 cwd 非空 → 前缀 cwd；否则原样。
 *  结果统一过 normalizePath（处理 . / .. / 重复斜杠）。 */
export function resolvePath(p: string): string {
  if (!p) return p;
  if (p === "/") return "";
  if (p.startsWith("/")) return normalizePath(p);
  if (!cwd) return normalizePath(p);
  return normalizePath(`${cwd}/${p}`);
}

/** 规范化路径：去掉多余的 ./ 和重复 //，解析 .. （仅向上、不越出根）。 */
export function normalizePath(p: string): string {
  const parts = p.split("/").filter((s) => s && s !== ".");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (out.length > 0) out.pop();
      // 越出根则忽略（保持根）
    } else {
      out.push(part);
    }
  }
  return out.join("/");
}

/** [Plan mode] block message for a bash command that would modify the filesystem. */
export function planReadOnlyMsg(cmd: string): string {
  return `[Plan mode] bash is read-only in Plan mode: '${cmd}' would modify the filesystem and was blocked. In Plan mode you can only READ and ANALYZE — propose your plan in text, and the user will switch to Bypass mode to let you execute it.`;
}

/** Split lines and strip trailing empty string from terminal \n. */
export function splitLines(s: string): string[] {
  const l = s.split("\n");
  if (l.length > 1 && l[l.length - 1] === "") l.pop();
  return l;
}

/** 转义正则元字符，使 pattern 作为**固定字符串**字面匹配（grep -F）。 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface BashCaseCtx {
  program: string;
  rest: string[];
  stdin?: string;
  readOnly: boolean;
  resolveInput: (fileArg?: string) => { content: string | null; source: string };
  /** find -exec / xargs 等递归执行子命令的回调（由 index.ts 注入）。 */
  runOneShellCommandFromTokens: (tokens: string[], stdin?: string, readOnly?: boolean) => Promise<{ ok: boolean; output: string; mutated?: boolean }>;
}

export type CaseResult = { ok: boolean; output: string; mutated?: boolean } | null;
export type FamilyRunner = (ctx: BashCaseCtx) => Promise<CaseResult> | CaseResult;
