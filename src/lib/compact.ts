/**
 * Real conversation compaction — the actual implementation behind `/compact`.
 *
 * Previously `/compact` was a no-op that printed a misleading message and set
 * an unread flag. This module implements what the README always claimed:
 * compress the conversation history with a genuine LLM summary.
 *
 * Strategy (fully summary-driven — NO anchor messages are kept):
 *   1. EVERYTHING except the system message — the whole history, including the
 *      last user message AND its assistant reply — is handed to the LLM to
 *      produce a single dense summary.
 *   2. The summary REPLACES all of it. After compact the context is
 *      `[system?, summary]`. When the user next speaks, the context is
 *      `[system?, summary, user N]` and the model answers ONLY the new
 *      message — there is no "unanswered older user message" left behind to
 *      trigger a duplicate response.
 *   3. If the LLM call fails or times out, fall back to a heuristic
 *      compaction (compress tool results + keep recent 12) so `/compact`
 *      still has a real effect.
 */

import {
  streamChatCompletionWithRetry,
  type AiClientConfig,
  type ChatMessage,
} from "./ai-client";
import { estimateConversationTokens } from "./context";

/** How long the summary request may take before we fall back (ms). */
const SUMMARY_TIMEOUT_MS = 60_000;

/** Max output tokens for the summary itself — generous so nothing is dropped. */
const SUMMARY_MAX_TOKENS = 3000;

/** Fallback heuristic: keep this many recent messages verbatim. */
const FALLBACK_KEEP_RECENT = 12;

/** Safety cap on the transcript handed to the summarizer (chars). */
const MAX_TRANSCRIPT_CHARS = 120_000;

/** How many leading lines of a tool result to keep for the summarizer. */
const TOOL_KEEP_LINES = 5;

/**
 * Compress a long tool result for the summarizer: keep the tool name + first
 * N lines + a marker. Less aggressive than compressToolResult (1 line) —
 * the summary needs enough signal to recall what each tool did.
 */
function compressToolResultForSummary(msg: ChatMessage): ChatMessage {
  if (msg.role !== "tool" || typeof msg.content !== "string") return msg;
  const content = msg.content;
  const lines = content.split("\n");
  if (lines.length <= TOOL_KEEP_LINES + 1) return msg;
  const kept = lines.slice(0, TOOL_KEEP_LINES).join("\n");
  const name = msg.name ? ` (${msg.name})` : "";
  return {
    ...msg,
    content: `[tool result${name} truncated]\n${kept}\n[... ${lines.length - TOOL_KEEP_LINES} more lines, ${content.length} chars total]`,
  };
}

/** Render a message `content` (string or vision ContentPart[]) to plain text
 *  for the summarizer prompt. Images become a placeholder note — the LLM
 *  summarizer doesn't need base64, just the fact that an image was attached. */
function contentToText(content: ChatMessage["content"]): string {
  if (typeof content === "string" || content == null) return content ?? "";
  return content
    .map((p) => {
      if (p.type === "text") return p.text;
      if (p.type === "image_url") return "[图片附件]";
      return "[附件: file_id]";
    })
    .join("\n");
}

/**
 * Summarize the given messages with the LLM. `messages` must already have
 * tool results compressed. Returns the summary text. Throws on failure so
 * the caller can fall back.
 */
async function summarizeWithLLM(
  aiConfig: AiClientConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  // Render the history as text for the summarizer prompt.
  const transcript = messages
    .map((m) => {
      switch (m.role) {
        case "user":
          return `[User]\n${contentToText(m.content)}`;
        case "assistant":
          return `[Assistant]\n${contentToText(m.content)}`;
        case "tool":
          return `[Tool ${m.name ?? ""}]\n${contentToText(m.content)}`;
        default:
          return "";
      }
    })
    .filter((s) => s.trim().length > 0)
    .join("\n\n");

  const sysPrompt = `你是一个 AI 编程助手会话的摘要器。你会收到一段早期会话的记录。你的任务是产出一份**紧凑但完整**的摘要，让助手能够无缝地继续未完成的工作。

## 摘要必须严格按以下分节结构输出：

## 用户意图
完整保留用户最后一条消息提出的要求与措辞（这是最关键的——如果省略，后续会答非所问）。同时概述整体任务目标。

## 已做决策
列出每一个已经做出的决定，以及为什么做出这个决定。

## 文件操作
列出所有创建/修改/删除的文件，**必须写完整精确的路径**（例如 src/lib/tools/search.ts），以及每个文件做了什么改动。路径写错会导致后续操作全错。

## 关键发现
列出探索中得出的重要结论：函数名、行号、函数签名、配置值、关键代码片段、模块之间的关系。

## 已完成 vs 待办
明确区分：哪些已经完成，哪些还差什么。下一步具体要做什么。

## 用户约束与偏好
列出用户表达的约束/偏好：语言（如"用中文回复"）、代码风格、命名习惯、内容尺度要求等。**这类约束一旦丢失，后续整个会话都会偏离用户预期。**

## 规则
- 用与对话中用户消息相同的语言写摘要（用户说中文就写中文，说英文就写英文）。
- 宁可长，不可漏。丢失一个文件路径、一个决策、一条用户约束 = 后续返工。目标长度 800-1200 词，不设硬性上限。
- 用要点（bullet points）而非散文段落。
- 不要记录工具调用的噪音（每一次 read_file 之类），只记录有意义的产出与结论。
- 只输出摘要本身，不要任何开场白（如"以下是摘要"）。`;

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
        { role: "user", content: transcript.slice(0, MAX_TRANSCRIPT_CHARS) },
      ],
      [],
      {},
      reqSignal,
    );
    const c = result.message.content;
    const text = (typeof c === "string" ? c : "").trim();
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
 * Fully summary-driven: the entire history (except any system message) is
 * collapsed into a single summary message. No anchor message is kept.
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

  const systemMsg = messages[0]?.role === "system" ? messages[0] : null;
  const history = systemMsg ? messages.slice(1) : messages;

  // Mechanically compress old tool results before handing to the LLM
  // (keeps enough signal: tool name + first 5 lines).
  const compressed = history.map((m) =>
    m.role === "tool" ? compressToolResultForSummary(m) : m,
  );

  try {
    const summary = await summarizeWithLLM(aiConfig, compressed, signal);
    const summaryMsg: ChatMessage = {
      role: "user",
      content: `[此前对话摘要 — earlier conversation summary]\n${summary}`,
    };
    const newMessages = systemMsg ? [systemMsg, summaryMsg] : [summaryMsg];
    return {
      messages: newMessages,
      removedCount: messages.length - newMessages.length,
      tokensBefore,
      tokensAfter: estimateConversationTokens(newMessages),
      mode: "llm",
    };
  } catch {
    // LLM failed (network, timeout, no key) — fall back to heuristic
    // compaction so /compact still does something real.
    const keepRecent = FALLBACK_KEEP_RECENT;
    const protectedMsgs = systemMsg ? [systemMsg] : [];
    const recentStart = Math.max(0, history.length - keepRecent);
    const middle = history.slice(0, recentStart);
    const recent = history.slice(recentStart);
    const working = [
      ...protectedMsgs,
      ...middle.map((m) => (m.role === "tool" ? compressToolResultForSummary(m) : m)),
      ...recent,
    ];
    return {
      messages: working,
      removedCount: messages.length - working.length,
      tokensBefore,
      tokensAfter: estimateConversationTokens(working),
      mode: "heuristic",
    };
  }
}
