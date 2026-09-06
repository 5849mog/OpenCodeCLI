
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
  // Match `>` or `>>` not preceded by a digit (excluding `2>`/`1>` fd-redirects)
  // and not immediately `&` (i.e. not `2>&1`).
  return /(?<![0-9])>>?(?!&)/.test(command);
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
