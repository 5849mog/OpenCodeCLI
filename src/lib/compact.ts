/**
 * Real conversation compaction — the actual implementation behind `/compact`.
 *
 * Previously `/compact` was a no-op that printed a misleading message and set
 * an unread flag. This module implements what the README always claimed:
 * compress the conversation history with a genuine LLM summary.
 *
 * Strategy:
 *   1. Protect the LAST user message (the current task anchor — the AI needs
 *      to know what the user just asked) and any system message.
 *   2. EVERYTHING older (earlier user messages, assistant analysis, tool
 *      results) is compressed with `compressToolResult` (mechanical: tool
 *      name + first line) and handed to the LLM to produce a compact summary.
 *   3. The summary replaces all of those messages as a single user message.
 *   4. If the LLM call fails or times out, fall back to a heuristic
 *      compaction (compress tool results + keep recent 12) so `/compact`
 *      still has a real effect.
 */

import {
  streamChatCompletionWithRetry,
  type AiClientConfig,
  type ChatMessage,
} from "./ai-client";
import { compressToolResult, estimateConversationTokens } from "./context";

/** How long the summary request may take before we fall back (ms). */
const SUMMARY_TIMEOUT_MS = 60_000;

/** Max output tokens for the summary itself. */
const SUMMARY_MAX_TOKENS = 1500;

/** Fallback heuristic: keep this many recent messages verbatim. */
const FALLBACK_KEEP_RECENT = 12;

/**
 * Summarize the given messages with the LLM. `messages` must already be
 * mechanically compressed (tool results → first line). Returns the summary
 * text. Throws on failure so the caller can fall back.
 */
async function summarizeWithLLM(
  aiConfig: AiClientConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  // Render the compressed history as text for the summarizer prompt.
  const transcript = messages
    .map((m) => {
      switch (m.role) {
        case "user":
          return `[User]\n${m.content ?? ""}`;
        case "assistant":
          return `[Assistant]\n${m.content ?? ""}`;
        case "tool":
          return `[Tool ${m.name ?? ""}]\n${m.content ?? ""}`;
        default:
          return "";
      }
    })
    .filter((s) => s.trim().length > 0)
    .join("\n\n");

  const sysPrompt = `You are a conversation summarizer for an AI coding agent. You will be given a transcript of an earlier part of a session. Produce a COMPACT but COMPLETE summary that lets the agent continue the work seamlessly.

MUST preserve:
- The user's original intent and requirements (in their own words where possible).
- Every decision made and why.
- Files created/modified/deleted and their paths (exact paths!).
- Key findings: function names, line numbers, signatures, config values.
- What is DONE and what is STILL PENDING / next steps.
- Any constraints or preferences the user expressed (style, language, tone).

Rules:
- Write in the same language as the transcript's user messages (Chinese stays Chinese, English stays English).
- Use bullet points, not prose paragraphs.
- Keep it under 600 words. Dense beats pretty.
- Do NOT include tool noise (every tool call), only the outcomes that matter.
- Output ONLY the summary. No preamble, no "Here is a summary:".`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
  const reqSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    const result = await streamChatCompletionWithRetry(
      {
        ...aiConfig,
        maxTokens: SUMMARY_MAX_TOKENS,
        // Summarizing is a pure text task — no tools, no thinking needed.
        thinkingEnabled: false,
      },
      [
        { role: "system", content: sysPrompt },
        { role: "user", content: transcript.slice(0, 120_000) }, // safety cap
      ],
      [],
      {},
      reqSignal,
    );
    const text = result.message.content?.trim() ?? "";
    if (!text) throw new Error("Empty summary returned");
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface CompactResult {
  messages: ChatMessage[];
  /** How many messages were replaced by the summary. */
  removedCount: number;
  tokensBefore: number;
  tokensAfter: number;
  /** "llm" = real summary, "heuristic" = fallback compression. */
  mode: "llm" | "heuristic";
}

/**
 * Compact the conversation. `messages` is the store's message history
 * (system prompt and workspace context are injected separately at send time,
 * so they are NOT expected here).
 *
 * @param messages Full history (all roles).
 * @param aiConfig Config for the summarizer LLM call.
 * @param signal Optional abort signal.
 */
export async function compactConversation(
  messages: ChatMessage[],
  aiConfig: AiClientConfig,
  signal?: AbortSignal,
): Promise<CompactResult> {
  const tokensBefore = estimateConversationTokens(messages);
  if (messages.length <= 2) {
    // Nothing worth compacting — keep as-is.
    return { messages, removedCount: 0, tokensBefore, tokensAfter: tokensBefore, mode: "llm" };
  }

  // Protect the system message (if any) and the LAST user message.
  const systemMsg = messages[0]?.role === "system" ? messages[0] : null;
  const rest = systemMsg ? messages.slice(1) : messages;
  const lastUserIdx = rest.length - 1 - [...rest].reverse().findIndex((m) => m.role === "user");
  const lastUserMsg = lastUserIdx >= 0 ? rest[lastUserIdx] : null;
  const older = lastUserMsg ? rest.slice(0, lastUserIdx) : rest.slice(0, rest.length - 1);

  if (older.length === 0) {
    // Only the anchor exists — nothing to compact.
    return { messages, removedCount: 0, tokensBefore, tokensAfter: tokensBefore, mode: "llm" };
  }

  // Mechanically compress old tool results before handing to the LLM.
  const compressed = older.map((m) => (m.role === "tool" ? compressToolResult(m) : m));

  try {
    const summary = await summarizeWithLLM(aiConfig, compressed, signal);
    const summaryMsg: ChatMessage = {
      role: "user",
      content: `[此前对话摘要 — earlier conversation summary]\n${summary}`,
    };
    const newMessages = [
      ...(systemMsg ? [systemMsg] : []),
      summaryMsg,
      ...(lastUserMsg ? [lastUserMsg] : []),
    ];
    return {
      messages: newMessages,
      removedCount: messages.length - newMessages.length,
      tokensBefore,
      tokensAfter: estimateConversationTokens(newMessages),
      mode: "llm",
    };
  } catch (e) {
    // LLM failed (network, timeout, no key) — fall back to heuristic
    // compaction so /compact still does something real.
    const keepRecent = FALLBACK_KEEP_RECENT;
    const protectedMsgs = systemMsg ? [systemMsg] : [];
    const recentStart = Math.max(0, rest.length - keepRecent);
    const middle = rest.slice(0, recentStart);
    const recent = rest.slice(recentStart);
    const working = [...protectedMsgs, ...middle.map((m) => (m.role === "tool" ? compressToolResult(m) : m)), ...recent];
    return {
      messages: working,
      removedCount: messages.length - working.length,
      tokensBefore,
      tokensAfter: estimateConversationTokens(working),
      mode: "heuristic",
    };
  }
}
