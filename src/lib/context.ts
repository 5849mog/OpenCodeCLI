/**
 * Token estimation + context window management.
 *
 * 估算：默认用字符启发式（CJK ~1.5 字符/token、其他 ~4 字符/token，±15%），
 * 兜底与即时渲染用。真分词器（src/lib/wasm/tokenizer.ts，DeepSeek-V3 官方词表
 * 128k BPE，与 Python transformers 同引擎）就绪后，truncateConversation 的
 * 默认计数器自动切换为精确计数（contextCounter），首次发送零延迟、预热完成后
 * 升级精度。
 *
 * The truncation strategy preserves:
 *   1. The system message (always)
 *   2. The most recent N message pairs
 *   3. A compressed summary of older tool results (just the tool name +
 *      success/fail + first line, instead of full output)
 */

import type { ChatMessage, ContentPart } from "./ai-client";
import { contextCounter } from "./wasm/tokenizer";

/** Rough token estimate for a string. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Count CJK characters (each ≈ 1 token, sometimes 2)
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const other = text.length - cjk;
  // CJK: ~1.5 chars/token, other: ~4 chars/token
  return Math.ceil(cjk / 1.5 + other / 4);
}

/**
 * Token estimate for a message `content` array (vision messages). Images are
 * charged a fixed amount (DeepSeek vision doc: ~384 tokens/image after
 * auto-resize); `file` references (Files API ids) are near-free; text parts
 * count normally. Export for tokenizer.ts to reuse.
 */
export function estimateContentPartsTokens(parts: ContentPart[]): number {
  let total = 0;
  for (const p of parts) {
    if (p.type === "text") {
      total += estimateTokens(p.text);
    } else if (p.type === "image_url") {
      total += 384; // DeepSeek vision: per-image cap after auto-resize (~800x800)
    } else if (p.type === "file") {
      total += 15; // file_id reference — a few dozen bytes
    }
  }
  return total;
}

/** Estimate tokens for a single chat message (content + tool_calls + name). */
export function estimateMessageTokens(msg: ChatMessage): number {
  let total = 4; // per-message overhead (role, etc.)
  if (typeof msg.content === "string") total += estimateTokens(msg.content);
  else if (Array.isArray(msg.content)) total += estimateContentPartsTokens(msg.content);
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
 * Compress a tool result message: keep the tool name + success/fail status +
 * the first line, with a "[truncated]" marker if it was longer. This drastically
 * reduces tokens for old tool results that the AI doesn't need verbatim anymore,
 * while retaining enough signal (which tool, did it work, first line of output)
 * to be useful as summary input and for the AI to recall the flow.
 */
export function compressToolResult(msg: ChatMessage): ChatMessage {
  if (msg.role !== "tool" || typeof msg.content !== "string") return msg;
  const content = msg.content;
  if (content.length <= 200) return msg;
  const firstLine = content.split("\n")[0];
  const lineCount = content.split("\n").length;
  const name = msg.name ? ` (${msg.name})` : "";
  return {
    ...msg,
    content: `[tool result${name} truncated]\n${firstLine}\n[... ${lineCount} lines truncated, ${content.length} chars total]`,
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
 * @param counter Token counter; default contextCounter = 真分词器就绪时精确计数，
 *                否则字符估算（首次发送零延迟）。
 * @returns The truncated conversation + a summary of what was dropped.
 */
export async function truncateConversation(
  messages: ChatMessage[],
  maxTokens = 60_000,
  keepRecent = 10,
  counter: (msgs: ChatMessage[]) => number | Promise<number> = contextCounter,
): Promise<{ messages: ChatMessage[]; dropped: number; compressed: number; tokensBefore: number; tokensAfter: number }> {
  const tokensBefore = await counter(messages);
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

  let tokensAfter = await counter(working);
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
    tokensAfter = await counter(working);
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
