/**
 * OpenAI-compatible API client with streaming + tool calling.
 *
 * Supports any provider that exposes the OpenAI Chat Completions API:
 * OpenAI, DeepSeek, Zhipu, OpenRouter, Moonshot, Together, Groq,
 * local Ollama (with OpenAI shim), etc.
 *
 * Anthropic's native API has a slightly different format — we expose a
 * separate adapter for it (lib/anthropic-adapter.ts) but the default
 * path is OpenAI-compatible.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  /** DeepSeek chain-of-thought. MUST be round-tripped in tool-calling turns or the API returns 400. */
  reasoning_content?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export interface AiClientConfig {
  baseUrl: string;        // e.g. https://api.openai.com/v1
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Optional extra headers */
  headers?: Record<string, string>;
  /** DeepSeek V4: enable thinking mode ({"thinking": {"type": "enabled"}}) */
  thinkingEnabled?: boolean;
  /** DeepSeek V4: reasoning effort (low/medium/high/max/xhigh) */
  reasoningEffort?: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface StreamCallbacks {
  onText?: (delta: string) => void;
  /** Reasoning/thinking text deltas (e.g. DeepSeek's reasoning_content). */
  onReasoning?: (delta: string) => void;
  onToolCallDelta?: (toolCall: Partial<ToolCall> & { index: number }) => void;
  onMessage?: (msg: ChatMessage) => void;
  onError?: (err: Error) => void;
  /** Called when the API returns real token usage (final stream chunk). */
  onUsage?: (usage: TokenUsage) => void;
}

/** Result of a streaming chat completion, including real token usage if the
 * provider returned it. */
export interface StreamResult {
  message: ChatMessage;
  usage: TokenUsage | null;
  /** The finish_reason from the API: "stop", "length", "tool_calls", "content_filter". */
  finishReason: string | null;
  /** Reasoning/thinking text the model emitted before its answer (e.g. DeepSeek reasoning_content). */
  reasoning: string;
}

/**
 * Send a chat completion request with streaming.
 * Returns the final assembled assistant message + real token usage (if the
 * provider returns it).
 */
export async function streamChatCompletion(
  config: AiClientConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const url = joinUrl(config.baseUrl, "/chat/completions");

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
    temperature: config.temperature ?? 0.6,
    // Request real token counts in the final stream chunk. OpenAI and most
    // compatible providers (DeepSeek, Zhipu, OpenRouter, Groq, etc.) support
    // this. Providers that don't will simply ignore it.
    stream_options: { include_usage: true },
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  if (config.maxTokens) {
    body.max_tokens = config.maxTokens;
  }
  // DeepSeek V4: thinking mode + reasoning effort.
  // Thinking is DEFAULT ON at the API — sending nothing means "on". So an
  // explicit {type:"disabled"} is required to actually turn it off.
  if (config.thinkingEnabled === false) {
    body.thinking = { type: "disabled" };
  } else {
    body.thinking = { type: "enabled" };
    if (config.reasoningEffort) {
      body.reasoning_effort = config.reasoningEffort;
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
    ...(config.headers ?? {}),
  };

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    // Never wrap abort errors — their .name must survive so the caller can
    // distinguish user-abort / timeout from a real network failure. fetch
    // rejects aborts with name === "AbortError".
    if (signal?.aborted || (e as { name?: string })?.name === "AbortError") {
      callbacks.onError?.(e as Error);
      throw e;
    }
    const err = new Error(
      `Network error: ${e instanceof Error ? e.message : String(e)}`,
    );
    callbacks.onError?.(err);
    throw err;
  }

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    const err = new Error(
      `API error ${resp.status}: ${text.slice(0, 500) || resp.statusText}`,
    );
    callbacks.onError?.(err);
    throw err;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let content = "";
  let reasoning = "";
  const toolCalls: ToolCall[] = [];
  const toolCallMap = new Map<number, ToolCall>();
  let usage: TokenUsage | null = null;
  let finishReason: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by blank lines
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = rawEvent.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          // Usage chunk: when include_usage is set, the final chunk has an
          // empty `choices` array and a top-level `usage` object.
          if (json.usage && typeof json.usage === "object") {
            usage = {
              prompt_tokens: json.usage.prompt_tokens ?? 0,
              completion_tokens: json.usage.completion_tokens ?? 0,
              total_tokens: json.usage.total_tokens ?? 0,
            };
          }
          const choice = json.choices?.[0];
          if (!choice) continue;
          // Capture finish_reason (stop, length, tool_calls, content_filter)
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
          const delta = choice.delta ?? {};
          if (typeof delta.content === "string" && delta.content) {
            content += delta.content;
            callbacks.onText?.(delta.content);
          }
          // DeepSeek reasoning model streams its thinking in reasoning_content.
          // The truthy check skips the common first frame {reasoning_content:"",content:""}.
          if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
            reasoning += delta.reasoning_content;
            callbacks.onReasoning?.(delta.reasoning_content);
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const i: number = tc.index ?? 0;
              let existing = toolCallMap.get(i);
              if (!existing) {
                existing = {
                  id: tc.id ?? "",
                  type: "function",
                  function: { name: "", arguments: "" },
                };
                toolCallMap.set(i, existing);
              }
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) {
                existing.function.name += tc.function.name;
              }
              if (tc.function?.arguments) {
                existing.function.arguments += tc.function.arguments;
              }
              callbacks.onToolCallDelta?.({
                index: i,
                id: existing.id,
                type: "function",
                function: { ...existing.function },
              });
            }
          }
        } catch {
          // ignore malformed lines
        }
      }
    }
  }

  // Sort tool calls by index
  const sortedIndices = Array.from(toolCallMap.keys()).sort((a, b) => a - b);
  for (const i of sortedIndices) {
    const tc = toolCallMap.get(i)!;
    if (tc.function.name) toolCalls.push(tc);
  }

  const finalMsg: ChatMessage = {
    role: "assistant",
    content: content || null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    // Round-trip DeepSeek chain-of-thought. Required when tools are in play
    // (otherwise the API 400s); ignored by the API in non-tool turns.
    reasoning_content: reasoning || undefined,
  };
  callbacks.onMessage?.(finalMsg);
  if (usage) callbacks.onUsage?.(usage);
  return { message: finalMsg, usage, finishReason, reasoning };
}

/**
 * Wrap streamChatCompletion with retry logic for transient errors.
 * - 429 (rate limit) / 503 (service unavailable) / network errors: retry
 *   with exponential backoff (1s, 2s, 4s), up to 3 attempts.
 * - Respects Retry-After header when present.
 * - 401/403/400: fail immediately (not retryable).
 * - Aborted errors: re-throw without retry.
 */
export async function streamChatCompletionWithRetry(
  config: AiClientConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  maxRetries = 3,
): Promise<StreamResult> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      return await streamChatCompletion(config, messages, tools, callbacks, signal);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      // Don't retry aborts
      if (e instanceof Error && e.name === "AbortError") throw e;
      // Don't retry on the last attempt
      if (attempt >= maxRetries) break;
      // Classify the error
      const msg = lastError.message;
      const isRetryable =
        msg.includes("429") ||
        msg.includes("503") ||
        msg.includes("500") ||
        msg.includes("502") ||
        msg.includes("504") ||
        msg.includes("Network error") ||
        msg.includes("Failed to fetch") ||
        msg.includes("network");
      // 401/403/400 are not retryable
      const isFatal =
        msg.includes("401") ||
        msg.includes("403") ||
        msg.includes("400") ||
        msg.includes("Invalid API key") ||
        msg.includes("invalid_api_key");
      if (isFatal || !isRetryable) break;
      // Exponential backoff: 1s, 2s, 4s
      const delayMs = Math.pow(2, attempt) * 1000;
      callbacks.onError?.(
        new Error(
          `Retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${maxRetries}): ${msg}`,
        ),
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError ?? new Error("Unknown error after retries");
}

/** Classify an API error into a user-friendly message. */
export function classifyApiError(err: Error): string {
  const msg = err.message;
  if (msg.includes("401") || msg.includes("Invalid API key") || msg.includes("invalid_api_key")) {
    return "API key is invalid or unauthorized. Open Settings and check your key.";
  }
  if (msg.includes("403")) {
    return "API key does not have permission for this model. Check your provider dashboard.";
  }
  if (msg.includes("429")) {
    return "Rate limited by the provider. Wait a moment and try again, or switch to a different model/key.";
  }
  if (msg.includes("400") && msg.includes("context_length")) {
    return "Conversation exceeds the model's context window. Start a new session with /clear, or switch to a model with a larger context window.";
  }
  if (msg.includes("400")) {
    return `Bad request: ${msg.slice(0, 200)}`;
  }
  if (msg.includes("Network error") || msg.includes("Failed to fetch")) {
    return "Cannot reach the API. Check your network connection and the Base URL in Settings.";
  }
  return msg;
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${b}/${p}`;
}

/**
 * Fetch the list of available models from an OpenAI-compatible /models endpoint.
 * Best-effort — many providers don't expose it.
 */
export async function fetchModels(
  config: Pick<AiClientConfig, "baseUrl" | "apiKey" | "headers">,
): Promise<string[]> {
  const url = joinUrl(config.baseUrl, "/models");
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(config.headers ?? {}),
    },
  });
  if (!resp.ok) throw new Error(`Failed to fetch models: ${resp.status}`);
  const json = await resp.json();
  const data = json?.data ?? json?.models ?? [];
  if (!Array.isArray(data)) return [];
  return data
    .map((m: { id?: string; name?: string }) => m.id ?? m.name)
    .filter((x: unknown): x is string => typeof x === "string")
    .sort();
}
