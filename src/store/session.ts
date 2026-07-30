/**
 * Session store — the orchestration layer for the Open Code Web agent.
 *
 * Responsibilities:
 *   - Hold the chat message history (for both UI rendering and AI context)
 *   - Hold the AI client config (loaded from localStorage)
 *   - Run the agent loop: stream AI response -> execute tool calls -> feed
 *     results back -> repeat until AI stops calling tools
 *   - Expose streaming state for the UI
 */

"use client";

import { create } from "zustand";
import {
  streamChatCompletionWithRetry,
  classifyApiError,
  type AiClientConfig,
  type ChatMessage,
  type ToolCall,
  type TokenUsage,
} from "@/lib/ai-client";
import {
  TOOL_DEFINITIONS,
  dispatchTool,
  buildSystemPrompt,
  type ToolResult,
} from "@/lib/tools/index";
import { buildWorkspaceContext } from "@/lib/tools/system-prompt";
import { vfs } from "@/lib/vfs";
import { useVfsView } from "@/store/vfs-view";
import {
  truncateConversation,
  DEFAULT_TOKEN_BUDGET,
} from "@/lib/context";
import {
  saveSession,
  loadSession,
  clearSession,
  type PersistedSession,
} from "@/lib/session-storage";
import { runSubagent } from "@/lib/subagent";
import { orchestrateTask } from "@/lib/orchestrator";
import { apiKeyVault } from "@/lib/api-key-vault";

// ---------------------------------------------------------------------------
// UI-facing event types — what gets rendered in the terminal
// ---------------------------------------------------------------------------

export type EventKind =
  | "user"
  | "assistant-text"
  | "assistant-message"
  | "tool-call"
  | "tool-result"
  | "error"
  | "system";

export interface SessionEvent {
  id: string;
  kind: EventKind;
  text?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolOutput?: string;
  diff?: { path: string; before: string; after: string };
  /** Plan content for update_plan tool — rendered as checkbox list. */
  plan?: string;
  ok?: boolean;
  ts: number;
}

// ---------------------------------------------------------------------------
// Config (persisted to localStorage)
// ---------------------------------------------------------------------------

export interface AiConfig {
  baseUrl: string;
  /** API key is NOT stored here — it's in the apiKeyVault.
   *  This flag just indicates whether a key has been set. */
  hasApiKey: boolean;
  model: string;
  temperature: number;
  maxTokens: number;
  customInstructions: string;
  /** DeepSeek V4: enable thinking mode */
  thinkingEnabled: boolean;
  /** DeepSeek V4: reasoning effort (low/medium/high/max/xhigh) */
  reasoningEffort: string;

  // ── Web & Search ──
  /** Search provider: "tavily" | "brave" | "" */
  searchProvider: string;
  /** Whether a search API key has been set (actual key is in apiKeyVault). */
  hasSearchKey: boolean;
  /** Use Jina AI Reader (r.jina.ai) as a CORS proxy for fetch_url. */
  useJinaReader: boolean;
  /** Optional custom CORS proxy URL for fetch_url. */
  corsProxyUrl: string;
}

// ---------------------------------------------------------------------------
// ask_user_input tool — structured question panel types
// ---------------------------------------------------------------------------

export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface QuestionItem {
  id: string;
  question: string;
  type: "single_select" | "multi_select" | "text_input";
  options: QuestionOption[];
  required: boolean;
  allow_other: boolean;
}

export interface QuestionPanelData {
  title?: string;
  description?: string;
  submit_label: string;
  request_id: string;
  questions: QuestionItem[];
}

const CONFIG_KEY = "opencode-web.config";
const DEFAULT_CONFIG: AiConfig = {
  baseUrl: "https://api.openai.com/v1",
  hasApiKey: false,
  model: "gpt-4o",
  temperature: 0.6,
  maxTokens: 8192,
  customInstructions: "",
  thinkingEnabled: true,
  reasoningEffort: "max",
  searchProvider: "tavily",
  hasSearchKey: false,
  useJinaReader: true,
  corsProxyUrl: "",
};

function loadConfig(): AiConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    // Never accept apiKey from localStorage — it shouldn't be there
    delete parsed.apiKey;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(c: AiConfig) {
  if (typeof window === "undefined") return;
  try {
    // Strip any apiKey/searchKey before saving — they go in the vault, not localStorage
    const { hasApiKey: _has, hasSearchKey: _hsk, ...rest } = c;
    void _has;
    void _hsk;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(rest));
  } catch {}
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface SessionState {
  events: SessionEvent[];
  messages: ChatMessage[];
  config: AiConfig;
  isStreaming: boolean;
  abortController: AbortController | null;
  /** Human-readable status for the UI to show what the agent is doing. */
  agentStatus: string;
  /** Streaming text — kept separate from events to avoid O(n) re-render
   *  of the entire events list on every token. Terminal subscribes to this
   *  for the live streaming bubble, and only touches events when streaming
   *  completes. */
  streamingText: { id: string; text: string } | null;
  /** Current agent loop iteration (1-based) for the progress bar. */
  agentIteration: number;
  /** Max iterations for the current loop (for progress bar denominator). */
  agentMaxIterations: number;
  /** Cumulative REAL tokens used in this session (sum of API-returned total_tokens). */
  totalTokens: number;
  /** Most recent API-returned usage breakdown (for display). */
  lastUsage: TokenUsage | null;
  /** True if the last send truncated history to fit the token budget. */
  truncated: boolean;
  /** Agent mode: "bypass" (auto-execute everything) or "plan" (read-only, AI proposes plan). */
  mode: "bypass" | "plan";

  // ---------------------------------------------------------------------------
  // Pending questions for ask_user_input tool
  // ---------------------------------------------------------------------------
  pendingQuestions: QuestionPanelData | null;

  init: () => void;
  setConfig: (patch: Partial<AiConfig>) => void;
  reset: () => void;
  abort: () => void;
  send: (text: string) => Promise<void>;
  toggleMode: () => void;
  setPendingQuestions: (data: QuestionPanelData | null) => void;
}

let eventCounter = 0;
function nextId(): string {
  eventCounter += 1;
  return `e${Date.now()}_${eventCounter}`;
}

/** Debounced session persistence — avoids writing to IndexedDB on every token. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(get: () => SessionState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = get();
    if (s.messages.length === 0) return;
    const session: PersistedSession = {
      id: "active",
      messages: s.messages,
      events: s.events,
      totalTokens: s.totalTokens,
      lastUsage: s.lastUsage,
      createdAt: s.events[0]?.ts ?? Date.now(),
      updatedAt: Date.now(),
    };
    void saveSession(session);
  }, 500);
}

/** Short preview of tool args for snapshot labels, e.g. 'edit_file(a.ts)'. */
function formatToolArgsPreview(args: Record<string, unknown>): string {
  const path = args.path ?? args.from ?? args.edits;
  if (typeof path === "string") return path;
  if (Array.isArray(path)) return `${path.length} edits`;
  return "";
}

export const useSession = create<SessionState>((set, get) => ({
  events: [],
  messages: [],
  config: DEFAULT_CONFIG,
  isStreaming: false,
  abortController: null,
  agentStatus: "",
  streamingText: null,
  agentIteration: 0,
  agentMaxIterations: 12,
  totalTokens: 0,
  lastUsage: null,
  truncated: false,
  mode: "bypass",
  pendingQuestions: null,

  init: () => {
    const cfg = loadConfig();
    // Try to restore API keys from encrypted sessionStorage
    void apiKeyVault.tryRestore().then((restored) => {
      set({ config: { ...cfg, hasApiKey: restored || apiKeyVault.hasKey() } });
    });
    void apiKeyVault.tryRestoreSearchKey().then((restored) => {
      set((s) => ({
        config: {
          ...s.config,
          hasSearchKey: restored || apiKeyVault.hasSearchKey(),
        },
      }));
    });
    // Restore persisted session (messages + events + token counts) so that
    // a page refresh doesn't lose the conversation.
    void loadSession().then((persisted) => {
      if (persisted && persisted.messages.length > 0) {
        set({
          messages: persisted.messages,
          events: persisted.events,
          totalTokens: persisted.totalTokens,
          lastUsage: persisted.lastUsage,
        });
      }
    });
  },

  setConfig: (patch) => {
    const next = { ...get().config, ...patch };
    set({ config: next });
    saveConfig(next);
  },

  reset: () => {
    get().abort();
    void clearSession();
    set({
      events: [
        {
          id: nextId(),
          kind: "system",
          text: "Session cleared. The workspace (文件袋) is unchanged.",
          ts: Date.now(),
        },
      ],
      messages: [],
      isStreaming: false,
      agentStatus: "",
  streamingText: null,
      agentIteration: 0,
      totalTokens: 0,
      lastUsage: null,
      truncated: false,
      pendingQuestions: null,
    });
  },

  abort: () => {
    const ac = get().abortController;
    if (ac) {
      ac.abort();
      set({
        abortController: null,
        isStreaming: false,
        agentStatus: "",
  streamingText: null,
        agentIteration: 0,
      });
    }
  },

  toggleMode: () => {
    const current = get().mode;
    const next = current === "bypass" ? "plan" : "bypass";
    set({ mode: next });
    // Push a system event for UI display
    const label = next === "plan"
      ? "Switched to Plan mode — AI can only read and analyze, not modify files. It will propose a plan for your approval."
      : "Switched to Bypass mode — AI can read, write, and execute freely without confirmation.";
    const ts = Date.now();
    useSession.setState((s) => ({
      events: [
        ...s.events,
        { id: `e${ts}_mode`, kind: "system" as const, text: label, ts },
      ],
      // ALSO inject into messages so the AI sees the mode change in its
      // conversation history. Without this, the AI relies on stale context
      // and may incorrectly report its current mode.
      messages: [
        ...s.messages,
        {
          role: "user" as const,
          content: `[Mode Switch] I've switched to ${next.toUpperCase()} mode. ${next === "plan" ? "You can ONLY read and analyze files. All write tools are BLOCKED. Propose a plan and wait for approval." : "You can read, write, edit, and delete files freely. Execute your plan directly."}`,
        },
      ],
    }));
  },

  setPendingQuestions: (data) => {
    set({ pendingQuestions: data });
  },

  send: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (get().isStreaming) return;

    const config = get().config;
    if (!apiKeyVault.hasKey()) {
      set({
        events: [
          ...get().events,
          {
            id: nextId(),
            kind: "error",
            text: "No API key configured. Click the Settings button (top-right) to add your API key.",
            ts: Date.now(),
          },
        ],
      });
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const userEvent: SessionEvent = {
      id: nextId(),
      kind: "user",
      text: trimmed,
      ts: Date.now(),
    };
    const ac = new AbortController();
    set((s) => {
      const newMessages = [...s.messages, userMsg];
      return {
        events: [...s.events, userEvent],
        messages: newMessages,
        isStreaming: true,
        abortController: ac,
        agentStatus: "Thinking…",
        agentIteration: 0,
      };
    });

    try {
      await runAgentLoop(set, get, ac.signal);
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      const errEvent: SessionEvent = {
        id: nextId(),
        kind: "error",
        text: isAbort
          ? "Stopped by user."
          : e instanceof Error
            ? classifyApiError(e)
            : String(e),
        ts: Date.now(),
      };
      set((s) => ({
        events: [...s.events, errEvent],
        isStreaming: false,
        abortController: null,
        agentStatus: "",
  streamingText: null,
        agentIteration: 0,
      }));
    } finally {
      set({
        isStreaming: false,
        abortController: null,
        agentStatus: "",
  streamingText: null,
        agentIteration: 0,
      });
      // Persist the final state of this turn.
      schedulePersist(get);
    }
  },
}));

// ---------------------------------------------------------------------------
// The agent loop
// ---------------------------------------------------------------------------

async function runAgentLoop(
  set: (partial: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) => void,
  get: () => SessionState,
  signal: AbortSignal,
) {
  const PER_REQUEST_TIMEOUT_MS = 90_000; // 90 seconds per AI request
  const config = get().config;
  const aiConfig: AiClientConfig = {
    baseUrl: config.baseUrl,
    apiKey: apiKeyVault.getKey() ?? "",
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    thinkingEnabled: config.thinkingEnabled,
    reasoningEffort: config.reasoningEffort,
  };

  // No iteration cap — modern agents run until the task is done. The loop
  // exits naturally when the AI stops calling tools, returns an empty
  // response, or the user aborts. A runaway AI is the user's responsibility
  // (they can hit Stop).
  set({ agentMaxIterations: 0 });

  // Build static system prompt once. This NEVER changes between iterations
  // (customInstructions is user-controlled and rarely changes), ensuring the
  // prompt prefix is stable for API caching.
  const STATIC_SYSTEM_PROMPT = buildSystemPrompt({
    customInstructions: config.customInstructions,
  });

  let iter = 0;
  while (true) {
    if (signal.aborted) return;

    set({
      agentIteration: iter + 1,
      agentStatus: iter === 0 ? "Thinking…" : "Continuing…",
    });

    // Build fresh workspace context for this iteration — the VFS tree may
    // have changed after tool execution, and the mode may have been toggled.
    const contextBlock = buildWorkspaceContext({ mode: get().mode });

    // Apply smart truncation before sending to the AI.
    const fullMessages: ChatMessage[] = [
      { role: "system", content: STATIC_SYSTEM_PROMPT },
      // The context block is injected as a user message so that the system
      // prompt stays fully static and cacheable.
      { role: "user", content: contextBlock },
      ...get().messages,
    ];
    const { messages: truncatedMsgs, dropped, tokensBefore, tokensAfter } =
      truncateConversation(fullMessages, DEFAULT_TOKEN_BUDGET, 10);
    if (dropped > 0) {
      set({ truncated: true });
      // Surface a system notice the FIRST time we truncate in this turn.
      if (iter === 0) {
        set((s) => ({
          events: [
            ...s.events,
            {
              id: nextId(),
              kind: "system",
              text: `Context truncated to fit token budget: dropped ${dropped} older message(s), compressed tool results. (~${tokensBefore} → ~${tokensAfter} tokens)`,
              ts: Date.now(),
            },
          ],
        }));
      }
    }
    const messagesForAI = truncatedMsgs;

    let streamedText = "";
    let firstTokenReceived = false;
    const streamEventId = nextId();
    // Don't push to events yet — use streamingText for live updates.
    // The final event is pushed once when streaming completes.
    set({ streamingText: { id: streamEventId, text: "" } });

    // Combine the user's abort signal with a per-request timeout.
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(new DOMException("Request timed out", "TimeoutError")),
      PER_REQUEST_TIMEOUT_MS,
    );
    const onUserAbort = () => timeoutController.abort(signal.reason);
    if (signal.aborted) timeoutController.abort(signal.reason);
    else signal.addEventListener("abort", onUserAbort, { once: true });

    let assistantMsg: ChatMessage;
    let finishReason: string | null = null;
    try {
      const result = await streamChatCompletionWithRetry(
        aiConfig,
        messagesForAI,
        TOOL_DEFINITIONS,
        {
          onText: (delta) => {
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              set({ agentStatus: "Generating response…" });
            }
            streamedText += delta;
            set({ streamingText: { id: streamEventId, text: streamedText } });
          },
          onUsage: (usage) => {
            set((s) => ({
              totalTokens: s.totalTokens + usage.total_tokens,
              lastUsage: usage,
            }));
          },
        },
        timeoutController.signal,
      );
      assistantMsg = result.message;
      finishReason = result.finishReason;
    } catch (e) {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onUserAbort);
      // Clear streaming text
      set({ streamingText: null });
      const isTimeout = e instanceof Error && e.name === "TimeoutError";
      const isAbort = e instanceof Error && e.name === "AbortError";
      if (isAbort) return;
      if (isTimeout) {
        set((s) => ({
          events: [
            ...s.events,
            {
              id: nextId(),
              kind: "error",
              text: `The AI took longer than ${PER_REQUEST_TIMEOUT_MS / 1000}s to respond. The request was aborted. You can try again or switch to a faster model.`,
              ts: Date.now(),
            },
          ],
        }));
        return;
      }
      throw e;
    }
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", onUserAbort);

    // Check finish_reason — "length" means the response was truncated at max_tokens
    if (finishReason === "length") {
      set((s) => ({
        events: [
          ...s.events,
          {
            id: nextId(),
            kind: "system" as const,
            text: `⚠️ Response was truncated at max_tokens (${config.maxTokens}). The AI's output was cut off mid-sentence or mid-JSON. Increase maxTokens in Settings, or shorten the conversation with /clear.`,
            ts: Date.now(),
          },
        ],
      }));
    }

    // Clear streaming text and push the final event to events ONCE.
    set({ streamingText: null });
    const hasText = streamedText.trim().length > 0;
    const hasToolCalls =
      !!assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0;

    if (hasText) {
      set((s) => ({
        events: [
          ...s.events,
          {
            id: streamEventId,
            kind: "assistant-message" as const,
            text: streamedText,
            ts: Date.now(),
          },
        ],
      }));
    }

    // Append the assistant message to conversation history regardless,
    // so the AI can continue if it had tool calls.
    set((s) => ({
      messages: [...s.messages, assistantMsg],
    }));

    if (!hasToolCalls) {
      // AI is done — either it replied with text, or it returned nothing
      // at all (empty response). If empty, surface a system notice so the
      // user isn't left wondering what happened.
      if (!hasText) {
        set((s) => ({
          events: [
            ...s.events,
            {
              id: nextId(),
              kind: "system",
              text: "The AI returned an empty response (no text and no tool calls). This can happen with certain models or when the context is too large. Try rephrasing your message or switching models.",
              ts: Date.now(),
            },
          ],
        }));
      }
      return;
    }

    // Execute tool calls concurrently when independent. All VFS operations
    // are sync/in-memory so parallelism is safe and much faster for batches
    // like reading 5 files at once.
    if (signal.aborted) return;
    const toolCalls = assistantMsg.tool_calls;
    if (!toolCalls) return;
    if (toolCalls.length === 1) {
      set({ agentStatus: `Calling ${toolCalls[0].function.name}…` });
      await executeToolCallSafe(set, get, toolCalls[0], signal, false);
    } else {
      // Take a SINGLE snapshot before the batch so that undo reverts the
      // entire batch, not just the last tool call. With Promise.all, all
      // tool calls start simultaneously — if each took its own snapshot,
      // they'd all capture the SAME pre-batch state (race condition), and
      // one undo would wipe everything.
      const hasMutating = toolCalls.some((tc) => MUTATING_TOOLS.has(tc.function.name));
      if (hasMutating) {
        vfs.takeSnapshot(`batch:${toolCalls.length} tools`);
      }
      // Run all tool calls in parallel with skipSnapshot=true since we
      // already took the batch snapshot above.
      set({ agentStatus: `Calling ${toolCalls.length} tools…` });
      await Promise.all(
        toolCalls.map((tc) => executeToolCallSafe(set, get, tc, signal, true)),
      );
    }
    iter++;
  }
  // unreachable — loop exits via return statements above
}

/** Tools that mutate the VFS. Undo snapshots are taken before these. */
const MUTATING_TOOLS = new Set([
  "write_file", "edit_file", "multi_edit", "delete_file",
  "move_file", "append_file", "create_dir", "update_plan",
  "apply_patch", "insert_at",
]);

/** Wrapper that guarantees a tool result message is ALWAYS added to the
 *  conversation, even if executeToolCall throws. This prevents the
 *  "insufficient tool messages following tool_calls" API error that
 *  happens when a tool call fails (e.g., subagent abort) and leaves
 *  the assistant message without a matching tool response. */
async function executeToolCallSafe(
  set: (partial: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) => void,
  get: () => SessionState,
  tc: ToolCall,
  signal?: AbortSignal,
  skipSnapshot = false,
): Promise<void> {
  const toolCallId = tc.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!tc.id) tc.id = toolCallId;
  try {
    await executeToolCall(set, get, tc, signal, skipSnapshot);
  } catch (e) {
    // Tool execution threw — add a fallback tool result so the API
    // doesn't complain about missing tool_call_id responses.
    const errorMsg = e instanceof Error ? e.message : String(e);
    const isAbort = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
    const toolMsg: ChatMessage = {
      role: "tool",
      content: isAbort
        ? `Tool execution was aborted.`
        : `Tool execution failed with error: ${errorMsg}`,
      tool_call_id: toolCallId,
      name: tc.function.name,
    };
    set((s) => ({
      messages: [...s.messages, toolMsg],
    }));
  }
}

async function executeToolCall(
  set: (partial: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) => void,
  get: () => SessionState,
  tc: ToolCall,
  signal?: AbortSignal,
  skipSnapshot = false,
) {
  // H3: ensure tool_call_id is non-empty (some providers don't return it)
  const toolCallId = tc.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!tc.id) tc.id = toolCallId;

  // H2: parse arguments; surface JSON errors clearly instead of swallowing
  let args: Record<string, unknown>;
  let parseError: string | null = null;
  try {
    args = JSON.parse(tc.function.arguments || "{}");
  } catch (e) {
    args = {};
    parseError = e instanceof Error ? e.message : String(e);
  }

  const callEventId = nextId();
  set((s) => ({
    events: [
      ...s.events,
      {
        id: callEventId,
        kind: "tool-call",
        toolName: tc.function.name,
        toolArgs: args,
        ts: Date.now(),
      },
    ],
  }));

  // Pre-set pendingQuestions for ask_user_input — the modal appears
  // immediately on this render cycle, without waiting for dispatchTool.
  if (tc.function.name === "ask_user_input" && !parseError) {
    const rawQuestions = args.questions as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
      // Don't overlay existing pending questions
      if (get().pendingQuestions !== null) return;
      set({
        pendingQuestions: {
          title: args.title ? String(args.title) : "",
          description: args.description ? String(args.description) : "",
          submit_label: args.submit_label ? String(args.submit_label) : "提交",
          request_id: args.request_id ? String(args.request_id) : crypto.randomUUID().slice(0, 12),
          questions: rawQuestions.map((q: Record<string, unknown>) => {
            const qType = String(q.type ?? "text_input");
            const isSelect = qType === "single_select" || qType === "multi_select";
            return {
              id: q.id ? String(q.id) : `q_${crypto.randomUUID().slice(0, 6)}`,
              question: String(q.question),
              type: qType as "single_select" | "multi_select" | "text_input",
              options: isSelect
                ? (q.options as Array<Record<string, unknown>>)?.map((o) => ({
                    id: o.id ? String(o.id) : `opt_${crypto.randomUUID().slice(0, 6)}`,
                    label: String(o.label),
                    description: o.description ? String(o.description) : "",
                  })) ?? []
                : [],
              required: q.required !== false,
              allow_other: !!q.allow_other,
            };
          }),
        },
      });
    }
  }

  let result: ToolResult;
  if (parseError) {
    // Tell the AI its arguments were malformed JSON so it can retry
    result = {
      ok: false,
      output: `Failed to parse tool arguments as JSON: ${parseError}. Raw arguments (truncated): ${tc.function.arguments.slice(0, 200)}`,
      tool: tc.function.name,
      args,
    };
  } else {
    // Special-case: dispatch_subagent runs a nested agent loop with its own
    // context. Token usage is accumulated into the session.
    if (tc.function.name === "dispatch_subagent") {
      const task = String(args.task ?? "");
      const maxIter = typeof args.max_iterations === "number" ? args.max_iterations : 8;
      if (!task) {
        result = {
          ok: false,
          output: "dispatch_subagent requires a 'task' argument.",
          tool: "dispatch_subagent",
          args,
        };
      } else {
        const config = get().config;
        const aiConfig: AiClientConfig = {
          baseUrl: config.baseUrl,
          apiKey: apiKeyVault.getKey() ?? "",
          model: config.model,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          thinkingEnabled: config.thinkingEnabled,
          reasoningEffort: config.reasoningEffort,
        };
        set({ agentStatus: `Subagent: ${task.slice(0, 40)}…` });
        const subResult = await runSubagent(aiConfig, {
          task,
          maxIterations: maxIter,
          onUsage: (usage) => {
            set((s) => ({
              totalTokens: s.totalTokens + usage.total_tokens,
              lastUsage: usage,
            }));
          },
          signal,
        });
        result = {
          ok: subResult.completed,
          output: `Subagent ${subResult.completed ? "completed" : "stopped (hit iteration limit)"} after ${subResult.iterations} iterations, ${subResult.toolCallCount} tool calls.\n\n--- Subagent summary ---\n${subResult.summary}`,
          tool: "dispatch_subagent",
          args,
        };
      }
    } else if (tc.function.name === "orchestrate_task") {
      const task = String(args.task ?? "");
      const maxSub = Math.min(Number(args.max_sub_agents) || 3, 5);
      const subMaxIter = Number(args.sub_agent_max_iterations) || 8;
      if (!task) {
        result = {
          ok: false,
          output: "orchestrate_task requires a 'task' argument.",
          tool: "orchestrate_task",
          args,
        };
      } else {
        const config = get().config;
        const aiConfig: AiClientConfig = {
          baseUrl: config.baseUrl,
          apiKey: apiKeyVault.getKey() ?? "",
          model: config.model,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          thinkingEnabled: config.thinkingEnabled,
          reasoningEffort: config.reasoningEffort,
        };
        set({ agentStatus: `🧠 Orchestrator: 分解任务中…` });
        try {
          const orchResult = await orchestrateTask(aiConfig, {
            task,
            maxSubAgents: maxSub,
            subAgentMaxIterations: subMaxIter,
            onStatus: (s) => {
              set({ agentStatus: `🧠 ${s}` });
            },
            onUsage: (usage) => {
              set((s) => ({
                totalTokens: s.totalTokens + usage.total_tokens,
                lastUsage: usage,
              }));
            },
            signal,
          });
          result = {
            ok: true,
            output: `Orchestration completed: ${orchResult.subTasks.length} subtasks, ${orchResult.totalToolCalls} total tool calls.\n\n--- Synthesized result ---\n${orchResult.summary}`,
            tool: "orchestrate_task",
            args,
          };
        } catch (e) {
          result = {
            ok: false,
            output: `Orchestration failed: ${e instanceof Error ? e.message : String(e)}`,
            tool: "orchestrate_task",
            args,
          };
        }
      }
    } else {
      // Plan mode: block all mutating tools — AI can only read/analyze.
      const mutatingTools = new Set([
        "write_file", "edit_file", "multi_edit", "delete_file",
        "move_file", "append_file", "create_dir", "update_plan",
        "apply_patch", "insert_at", "undo_edit",
      ]);
      if (get().mode === "plan" && mutatingTools.has(tc.function.name)) {
        result = {
          ok: false,
          output: `[Plan mode] This tool (${tc.function.name}) is blocked. In Plan mode you can only READ and ANALYZE files — you cannot modify them. Propose your plan in text, and the user will switch to Bypass mode to let you execute it.`,
          tool: tc.function.name,
          args,
        };
      } else {
        // Push a VFS snapshot before mutating tools (for /undo).
        // When skipSnapshot is true (parallel batch), the caller already took
        // a single batch snapshot — we must not take individual ones or they'd
        // all capture the same pre-batch state (race via Promise.all).
        if (!skipSnapshot && MUTATING_TOOLS.has(tc.function.name) && tc.function.name !== "undo_edit") {
          vfs.takeSnapshot(`${tc.function.name}(${formatToolArgsPreview(args)})`);
        }
        result = await dispatchTool(tc.function.name, args);
        // Ensure the file bag UI refreshes after any mutating tool
        if (result.mutated) useVfsView.getState().bump();
      }
    }
  }

  set((s) => ({
    events: [
      ...s.events,
      {
        id: nextId(),
        kind: "tool-result",
        toolName: tc.function.name,
        toolArgs: args,
        toolOutput: result.output,
        diff: result.diff,
        plan: result.plan,
        ok: result.ok,
        ts: Date.now(),
      },
    ],
  }));

  const toolMsg: ChatMessage = {
    role: "tool",
    content: result.output,
    tool_call_id: toolCallId,
    name: tc.function.name,
  };
  set((s) => ({
    messages: [...s.messages, toolMsg],
  }));
  // Persist after each tool execution so a crash mid-loop still saves progress.
  schedulePersist(get);
}
