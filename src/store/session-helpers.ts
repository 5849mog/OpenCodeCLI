
"use client";

import {
} from "@/lib/ai-client";
import {
} from "@/lib/tools/index";
import {
} from "@/lib/session-storage";

// ---------------------------------------------------------------------------
// Idle auto-lock — wipes API keys from memory after N minutes of inactivity.
// ---------------------------------------------------------------------------
import type {
  SessionState,
  UsageRecord
} from "./session";

/** Short preview of tool args for snapshot labels, e.g. 'edit_file(a.ts)'. */
export function formatToolArgsPreview(args: Record<string, unknown>): string {
  const path = args.path ?? args.from ?? args.edits;
  if (typeof path === "string") return path;
  if (Array.isArray(path)) return `${path.length} edits`;
  return "";
}

/** toggleMode 注入的 AI 可见模式提示前缀。该消息不产生对应 event、不是真实
 *  用户输入——在 user 事件↔消息序号映射（rewriteFromMessage/regenerate）里
 *  必须跳过，否则会把真实用户消息顶掉（错位改写/内容丢失）。 */
export const MODE_SWITCH_PREFIX = "[Mode Switch]";

export function isModeSwitchMessage(msg: { role: string; content: unknown }): boolean {
  return msg.role === "user" && typeof msg.content === "string" && msg.content.startsWith(MODE_SWITCH_PREFIX);
}

/**
 * Heuristic: does this bash command likely WRITE to the VFS? Undo snapshots are
 * only worthwhile before a mutation — we don't want every read-only `cat`/`ls`
 * to push a no-op snapshot (it would balloon the undo stack during exploration).
 * Covers the write redirections and mutating commands the sandbox supports.
 */
export function bashCommandMutates(command: string): boolean {
  if (!command) return false;
  // Mutating command words — `tee`, `mkdir`, `rm`, `rmdir`, `touch`, `cp`,
  // `mv`, and `sed -i` (in-place). `rm` always mutates (deletes).
  if (/\b(tee|mkdir|rm|rmdir|touch|cp|mv|dd)\b/.test(command)) return true;
  if (/\bsed\s+-i\b/.test(command)) return true;
  // Output redirection writes the file, EXCEPT fd-redirects `N>` / `N>>` like
  // `2>/dev/null` / `2>&1` (those are not file writes). A standalone `>` / `>>`
  // with a filename target writes.
  // 用 indexOf 循环替代 lookbehind 正则（旧 Safari 解析 (?<![0-9]) 即抛错）。
  for (let i = command.indexOf(">"); i >= 0; i = command.indexOf(">", i + 1)) {
    const prev = command[i - 1];
    if (prev >= "0" && prev <= "9") continue; // 数字 fd 重定向（2> / 1>>）
    if (command[i + 1] === "&") continue;      // >& 合并 fd（2>&1）
    return true;                               // > 或 >> 文件重定向写
  }
  return false;
}

/* ────────────────────────── auto-compact ────────────────────────── */

export type SessionGet = () => SessionState;

export type SessionSet = (partial: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) => void;

/** 累计真实 API 用量 + 追加逐次记录（审计面板用，上限 200 条）。 */
export function recordUsage(
  set: SessionSet,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
  source: UsageRecord["source"],
): void {
  set((s) => ({
    totalTokens: s.totalTokens + usage.total_tokens,
    lastUsage: usage,
    usageHistory: [
      ...(s.usageHistory ?? []),
      {
        ts: Date.now(),
        source,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
    ].slice(-200),
  }));
}
