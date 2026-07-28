/**
 * Token estimation + context window management.
 *
 * Browsers can't run a real BPE tokenizer without bundling one (~1MB). We
 * approximate with a simple heuristic: ~4 chars per token for English, ~1.5
 * chars per token for CJK. This is accurate within ±15% — good enough for
 * deciding when to truncate.
 *
 * The truncation strategy preserves:
 *   1. The system message (always)
 *   2. The most recent N message pairs
 *   3. A compressed summary of older tool results (just the tool name +
 *      success/fail + first line, instead of full output)
 */

import type { ChatMessage } from "./ai-client";

/** Rough token estimate for a string. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Count CJK characters (each ≈ 1 token, sometimes 2)
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const other = text.length - cjk;
  // CJK: ~1.5 chars/token, other: ~4 chars/token
  return Math.ceil(cjk / 1.5 + other / 4);
}

/** Estimate tokens for a single chat message (content + tool_calls + name). */
export function estimateMessageTokens(msg: ChatMessage): number {
  let total = 4; // per-message overhead (role, etc.)
  if (typeof msg.content === "string") total += estimateTokens(msg.content);
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      total += estimateTokens(tc.function.name);
      total += estimateTokens(tc.function.arguments);
      total += 8; // structural overhead per tool call
    }
  }
  if (msg.name) total += estimateTokens(msg.name);
  return total;
}

/** Estimate total tokens for a message array. */
export function estimateConversationTokens(msgs: ChatMessage[]): number {
  return msgs.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

/**
 * Compress a tool result message: keep only the first line + a "[truncated]"
 * marker if it was longer. This drastically reduces tokens for old tool
 * results that the AI doesn't need verbatim anymore.
 */
export function compressToolResult(msg: ChatMessage): ChatMessage {
  if (msg.role !== "tool" || typeof msg.content !== "string") return msg;
  const content = msg.content;
  if (content.length <= 200) return msg;
  const firstLine = content.split("\n")[0];
  const lineCount = content.split("\n").length;
  return {
    ...msg,
    content: `${firstLine}\n[... ${lineCount} lines truncated, ${content.length} chars total]`,
  };
}

/**
 * Truncate a conversation to fit within a token budget.
 *
 * Strategy:
 *   - Always keep messages[0] if it's the system message.
 *   - Always keep messages[1] if it's the workspace context message (injected
 *     by the agent loop for cache optimization — it's essential context).
 *   - Always keep the last `keepRecent` messages verbatim.
 *   - For messages in between: compress tool results, then if still over
 *     budget, drop the oldest non-system messages.
 *
 * @param messages Full conversation including the system message at index 0
 *                 and optionally a workspace context message at index 1.
 * @param maxTokens The token budget (default 60000 — leaves room for response).
 * @param keepRecent How many of the most recent messages to never compress/drop.
 * @returns The truncated conversation + a summary of what was dropped.
 */
export function truncateConversation(
  messages: ChatMessage[],
  maxTokens = 60_000,
  keepRecent = 10,
): { messages: ChatMessage[]; dropped: number; compressed: number; tokensBefore: number; tokensAfter: number } {
  const tokensBefore = estimateConversationTokens(messages);
  if (tokensBefore <= maxTokens) {
    return { messages, dropped: 0, compressed: 0, tokensBefore, tokensAfter: tokensBefore };
  }

  // Phase 1: compress tool results in the "middle" section (not system/context, not recent)
  // Protect both the system message (index 0) and the context message (index 1) from
  // compression and dropping. The context message is injected every turn to provide
  // the AI with current workspace state without breaking the cacheable system prompt.
  const systemMsg = messages[0]?.role === "system" ? messages[0] : null;
  const contextMsg = messages[1]?.role === "user" ? messages[1] : null;
  const protectedMsgs: ChatMessage[] = [];
  if (systemMsg) protectedMsgs.push(systemMsg);
  if (contextMsg) protectedMsgs.push(contextMsg);
  const rest = messages.slice(protectedMsgs.length);
  const recentStart = Math.max(0, rest.length - keepRecent);
  const middle = rest.slice(0, recentStart);
  const recent = rest.slice(recentStart);

  let compressed = 0;
  const compressedMiddle = middle.map((m) => {
    if (m.role === "tool") {
      compressed++;
      return compressToolResult(m);
    }
    return m;
  });

  let working = [...protectedMsgs, ...compressedMiddle, ...recent];

  let tokensAfter = estimateConversationTokens(working);
  if (tokensAfter <= maxTokens) {
    return { messages: working, dropped: 0, compressed, tokensBefore, tokensAfter };
  }

  // Phase 2: drop oldest messages from the middle section, one at a time,
  // until we fit. Never drop the protected messages (system + context) or
  // the recent section. We drop in pairs (assistant tool_call + tool result)
  // to avoid orphaned tool_call_ids which some APIs reject.
  const droppedMsgs: ChatMessage[] = [];
  let workingMiddle = [...compressedMiddle];

  while (tokensAfter > maxTokens && workingMiddle.length > 0) {
    // Find a pair to drop: an assistant message with tool_calls followed by
    // its tool result(s). If the first message isn't part of such a pair,
    // drop it alone.
    const dropIdx = 0;
    const first = workingMiddle[dropIdx];
    let dropCount = 1;
    if (first.role === "assistant" && first.tool_calls && first.tool_calls.length > 0) {
      // Drop the assistant message + all following tool messages that
      // correspond to its tool_calls.
      const toolCallIds = new Set(first.tool_calls.map((tc) => tc.id));
      while (
        dropCount < workingMiddle.length &&
        workingMiddle[dropCount].role === "tool" &&
        toolCallIds.has(workingMiddle[dropCount].tool_call_id || "")
      ) {
        dropCount++;
      }
    }
    droppedMsgs.push(...workingMiddle.splice(dropIdx, dropCount));
    working = [...protectedMsgs, ...workingMiddle, ...recent];
    tokensAfter = estimateConversationTokens(working);
  }

  return {
    messages: working,
    dropped: droppedMsgs.length,
    compressed,
    tokensBefore,
    tokensAfter,
  };
}

/** Default token budget — leaves headroom for the AI's response. */
export const DEFAULT_TOKEN_BUDGET = 60_000;
