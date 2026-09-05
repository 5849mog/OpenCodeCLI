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
  type ContentPart,
  type ToolCall,
  type TokenUsage,
} from "@/lib/ai-client";
import {
  dispatchTool,
  buildSystemPrompt,
  filterToolsByPreset,
  type AgentPreset,
  type ToolResult,
} from "@/lib/tools/index";
import { buildWorkspaceContext } from "@/lib/tools/system-prompt";
import { vfs, onVfsEvent } from "@/lib/vfs";
import { useVfsView } from "@/store/vfs-view";
import { compactConversation } from "@/lib/compact";
import {
  truncateConversation,
} from "@/lib/context";
import {
  createSession,
  saveSession,
  loadSession,
  deleteSession as deleteSessionStorage,
  renameSession as renameSessionStorage,
  listSessions,
  getActiveSessionId,
  setActiveSessionId,
  deriveTitle,
  type PersistedSession,
  type SessionMeta,
} from "@/lib/session-storage";
import { runSubagent } from "@/lib/subagent";
import { orchestrateTask } from "@/lib/orchestrator";
import { apiKeyVault } from "@/lib/api-key-vault";
import { warmup, tokenizerStatus, countConversationTokensAccurate } from "@/lib/wasm/tokenizer";
import { uuid } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Idle auto-lock — wipes API keys from memory after N minutes of inactivity.
// ---------------------------------------------------------------------------

const IDLE_ACTIVITY_EVENTS = ["pointerdown", "keydown", "pointermove", "wheel", "touchstart"];
let idleLockTimer: ReturnType<typeof setTimeout> | null = null;
let idleLockListenersAttached = false;

/** Re-arm (or disarm) the idle-lock timer based on the current config. */
function rearmIdleLock() {
  if (typeof window === "undefined") return;
  if (idleLockTimer) {
    clearTimeout(idleLockTimer);
    idleLockTimer = null;
  }
  const minutes = useSession.getState().config.idleLockMinutes ?? 0;
  if (minutes <= 0) return; // disabled
  idleLockTimer = setTimeout(() => {
    // Inactive long enough — wipe keys from memory + localStorage.
    apiKeyVault.lockAll();
    useSession.setState((s) => ({
      config: { ...s.config, hasApiKey: false, hasSearchKey: false },
      events: [
        ...s.events,
        {
          id: `e${Date.now()}_idlelock`,
          kind: "system" as const,
          text: `已因空闲超时自动锁定 API 密钥（超过 ${minutes} 分钟无操作）。需要时在设置中重新输入。`,
          ts: Date.now(),
        },
      ],
    }));
  }, minutes * 60_000);
}

/** Attach activity listeners once; each activity re-arms the timer. */
function attachIdleLock() {
  if (typeof window === "undefined" || idleLockListenersAttached) return;
  idleLockListenersAttached = true;
  for (const ev of IDLE_ACTIVITY_EVENTS) {
    window.addEventListener(ev, rearmIdleLock, { passive: true });
  }
}


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
  /** Model reasoning/thinking content (DeepSeek reasoning_content), rendered as a thinking block. */
  reasoning?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolOutput?: string;
  diff?: { path: string; before: string; after: string };
  /** Plan content for update_plan tool — rendered as checkbox list. */
  plan?: string;
  ok?: boolean;
  /** 用户随消息上传的附件（图片等）。图片含 dataUrl（工作区/UI 显示），
   *  已走 Files API 的有 fileId（content 用 file 块引用，无 dataUrl 占用体积）。 */
  attachments?: Array<{ name: string; path: string; dataUrl?: string; fileId?: string }>;
  ts: number;
  /** 思考/回合持续时长（毫秒）——用于「思考过程 持续了几秒」（真实计时，非硬编码）。 */
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Audit data (per-session, persisted with the session)
// ---------------------------------------------------------------------------

/** 用户随消息上传的附件（图片等）。dataUrl 用于工作区/UI 显示与 base64 兜底；
 *  fileId 是 DeepSeek Files API 上传成功后拿到的引用（content 用 file 块，不再带 dataUrl）。 */
export interface UploadedAttachment {
  name: string;
  /** VFS 路径（uploads/<name>）。 */
  path: string;
  /** 图片 data: URL（base64）。仅图片有；Files API 成功后可省略以省内存。 */
  dataUrl?: string;
  /** DeepSeek Files API 的 file_id（仅图片，上传成功后设置）。 */
  fileId?: string;
  /** 是否图片（决定进 ContentPart[] 还是仅写工作区）。 */
  isImage: boolean;
  /** 附件内容 token 估算（图片=384 固定值，文本=真分词器计数）——输入框实时计数用。 */
  tokens?: number;
}

/** 逐次 API 用量记录（审计面板/报告用，来源分主循环/子代理/编排）。 */
export interface UsageRecord {
  ts: number;
  source: "main" | "subagent" | "orchestrator";
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** VFS 变更日志条目（审计面板用；覆盖 delete/move/bash 写入——这些工具没有 diff）。 */
export interface VfsChangeRecord {
  ts: number;
  type: "write" | "delete" | "rename" | "clear";
  path?: string;
  toPath?: string;
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
  /** 单次请求发送给模型的上下文预算（token）。超出时自动截断/压缩旧历史。
   *  默认 60000；高上下文模型（如 DeepSeek 1M）可在设置里调大。 */
  tokenBudget: number;
  /** 自动压缩：真分词器就绪且估算超预算 85% 时自动 LLM 摘要压缩历史
   *  （距上次压缩 ≥10 条新消息才再触发，防抖）。关闭则只 truncate（丢旧消息）。 */
  autoCompact: boolean;
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
  /** Auto-lock API keys after N minutes of inactivity (0 = disabled). */
  idleLockMinutes: number;
  /** 当前模型是否支持视觉输入（图片）。支持时用户上传的图片会作为
   *  ContentPart 传入；不支持时带图发送会记 error 提示（后端会 400）。 */
  supportVision: boolean;
  /** 新建会话默认的运行模式（full/light/minimal）。会话创建时锁定。 */
  defaultPreset: AgentPreset;
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
  tokenBudget: 60_000,
  autoCompact: true,
  thinkingEnabled: true,
  reasoningEffort: "max",
  searchProvider: "tavily",
  hasSearchKey: false,
  useJinaReader: true,
  corsProxyUrl: "",
  idleLockMinutes: 0,
  supportVision: true,
  defaultPreset: "full",
};

function loadConfig(): AiConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    // Never accept apiKey from localStorage — it shouldn't be there
    delete parsed.apiKey;
    // "medium" was offered by older versions but is not a valid DeepSeek
    // reasoning_effort value — coerce to "high" so we never send an invalid enum.
    if (typeof parsed.reasoningEffort === "string" && !["low", "high", "xhigh", "max"].includes(parsed.reasoningEffort)) {
      parsed.reasoningEffort = "high";
    }
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
  /** Id of the active session (IndexedDB key + localStorage pointer). */
  sessionId: string;
  /** Auto-derived (or user-renamed) session title. */
  title: string;
  /** Lightweight session list for the sidebar (meta only, newest first). */
  sessions: SessionMeta[];
  config: AiConfig;
  isStreaming: boolean;
  /** True while /compact is running (LLM summarization) — drives the
   *  "compressing…" animation in the terminal. */
  isCompacting: boolean;
  abortController: AbortController | null;
  /** Human-readable status for the UI to show what the agent is doing. */
  agentStatus: string;
  /** Streaming text — kept separate from events to avoid O(n) re-render
   *  of the entire events list on every token. Terminal subscribes to this
   *  for the live streaming bubble, and only touches events when streaming
   *  completes. */
  streamingText: { id: string; text: string } | null;
  /** Live reasoning/thinking text (streamed before the answer). Cleared together with streamingText. */
  streamingReasoning: { id: string; text: string } | null;
  /** Current agent loop iteration (1-based) for the progress bar. */
  agentIteration: number;
  /** Max iterations for the current loop (for progress bar denominator). */
  agentMaxIterations: number;
  /** Cumulative REAL tokens used in this session (sum of API-returned total_tokens). */
  totalTokens: number;
  /** Most recent API-returned usage breakdown (for display). */
  lastUsage: TokenUsage | null;
  /** Cumulative tokens RELEASED by compaction (sum of before−after). Never
   *  decreases; lets the UI show how much context pressure compacting has
   *  relieved, without changing totalTokens' "real API usage" meaning. */
  compactedReleases: number;
  /** 上次压缩时的消息条数（auto-compact 节流：距上次 ≥10 条新消息才再触发）。 */
  lastCompactMsgCount: number;
  /** 逐次 API 用量（审计面板用；上限 200 条）。 */
  usageHistory: UsageRecord[];
  /** VFS 变更日志（审计面板用；覆盖无 diff 的写操作，上限 500 条）。 */
  vfsChangeLog: VfsChangeRecord[];
  /** How many times /compact successfully ran in this session. */
  compactCount: number;
  /** True if the last send truncated history to fit the token budget. */
  truncated: boolean;
  /** Agent mode: "bypass" (auto-execute everything) or "plan" (read-only, AI proposes plan). */
  mode: "bypass" | "plan";

  // ---------------------------------------------------------------------------
  // Pending questions for ask_user_input tool
  // ---------------------------------------------------------------------------
  pendingQuestions: QuestionPanelData | null;

  /** zip_archive 工具把真实 zip blob 交给 UI 触发下载。组件消费后清空。 */
  pendingDownload: { blob: Blob; filename: string } | null;
  /** unzip_archive 工具请求用户选 zip；UI 挂载隐藏文件选择器。 */
  pendingZipRequest: { requestId: string } | null;

  // ---------------------------------------------------------------------------
  // Payload inspector — 查看/编辑上次实际发送给 AI 服务器的完整上下文
  // ---------------------------------------------------------------------------
  /** 上次成功发送时组装后的完整 payload（system + workspace-context + 消息）。
   *  供 payload-inspector 弹窗展示。系统与上下文段只读，消息段可编辑。 */
  lastSentPayload: ChatMessage[] | null;
  /** 用户在 payload 编辑器确认后的消息覆盖层：下一次 send 用它替换
   *  get().messages 注入（system/workspace-context 由 send 自行重建），
   *  发送后清空。null = 不使用覆盖。 */
  pendingOverrideMessages: ChatMessage[] | null;
  setPendingOverrideMessages: (msgs: ChatMessage[] | null) => void;

  init: () => void;
  setConfig: (patch: Partial<AiConfig>) => void;
  /** 从 provider /models 端点拉取到的可用模型列表（设置面板写入，主对话 header 切换器读取）。 */
  availableModels: string[];
  setAvailableModels: (models: string[]) => void;
  /** 当前会话的运行模式（full/light/minimal）。运行中可切换（下一次请求即用新提示词/工具集）。 */
  agentPreset: AgentPreset;
  /** 运行中切换会话模式（更新 agentPreset 并持久化）。 */
  setAgentPreset: (preset: AgentPreset) => void;
  /** Clear the current session's content but keep its entry. Alias of clearSession. */
  reset: () => void;
  clearSession: () => Promise<void>;
  /** 新建会话时指定运行模式（从设置面板的"新会话默认"读取）。 */
  newSession: () => Promise<void>;
  switchSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  refreshSessionList: () => Promise<void>;
  abort: () => void;
  send: (text: string, attachments?: UploadedAttachment[]) => Promise<void>;
  /** 重改：丢弃最后一轮 Q→A，用同一个用户消息重新跑一遍。 */
  regenerate: () => Promise<void>;
  /** 修改某条用户消息：原地替换，清空其后全部内容，并从该消息重新开始重构。 */
  rewriteFromMessage: (eventId: string, newText: string) => Promise<void>;
  /** 真正的上下文压缩：LLM 摘要旧对话并写回 store（/compact 命令调用）。 */
  compact: () => Promise<void>;
  toggleMode: () => void;
  setPendingQuestions: (data: QuestionPanelData | null) => void;
  setPendingDownload: (d: { blob: Blob; filename: string } | null) => void;
  setPendingZipRequest: (r: { requestId: string } | null) => void;
}

let eventCounter = 0;
function nextId(): string {
  eventCounter += 1;
  return `e${Date.now()}_${eventCounter}`;
}

/** Debounced session persistence — avoids writing to IndexedDB on every token. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Immediately persist the current session, bypassing the debounce. */
async function flushPersist(get: () => SessionState): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const s = get();
  if (s.messages.length === 0) return;
  const session: PersistedSession = {
    id: s.sessionId || getActiveSessionId(),
    title: s.title || "新会话",
    messages: s.messages,
    events: s.events,
    totalTokens: s.totalTokens,
    lastUsage: s.lastUsage,
    compactedReleases: s.compactedReleases ?? 0,
    compactCount: s.compactCount ?? 0,
    usageHistory: s.usageHistory ?? [],
    vfsChangeLog: s.vfsChangeLog ?? [],
    agentPreset: s.agentPreset ?? "full",
    createdAt: s.events[0]?.ts ?? Date.now(),
    updatedAt: Date.now(),
  };
  await saveSession(session);
}

function schedulePersist(get: () => SessionState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flushPersist(get);
  }, 500);
}

/** Short preview of tool args for snapshot labels, e.g. 'edit_file(a.ts)'. */
function formatToolArgsPreview(args: Record<string, unknown>): string {
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
function bashCommandMutates(command: string): boolean {
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

type SessionSet = (partial: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) => void;
type SessionGet = () => SessionState;

/** 累计真实 API 用量 + 追加逐次记录（审计面板用，上限 200 条）。 */
function recordUsage(
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

/**
 * auto-compact 触发判定（纯函数，可测）：
 * 开关开启 + 未在压缩中 + 真分词器估算超预算 85% + 距上次压缩 ≥10 条新消息。
 */
export function shouldAutoCompact(opts: {
  autoCompact: boolean;
  isCompacting: boolean;
  estimatedTokens: number;
  tokenBudget: number;
  messagesSinceLastCompact: number;
}): boolean {
  return (
    opts.autoCompact &&
    !opts.isCompacting &&
    opts.estimatedTokens > opts.tokenBudget * 0.85 &&
    opts.messagesSinceLastCompact >= 10
  );
}

/**
 * 压缩会话历史（手动 /compact 与 auto-compact 共用）。
 * - 对话太短 / 未配置 API Key：manual 推事件提示；auto 静默跳过（truncate 兜底）。
 * - 成功：写回 messages + 累计 compactedReleases/compactCount + lastCompactMsgCount
 *   （auto-compact 节流基准）+ 立即持久化 + 推 system 事件（触发方式标注）。
 * - 失败：manual 推 error 事件；auto 静默（truncate 兜底）。
 */
async function doCompact(trigger: "manual" | "auto", set: SessionSet, get: SessionGet): Promise<void> {
  const { messages } = get();
  if (messages.length < 4) {
    if (trigger === "manual") {
      set((s) => ({
        events: [
          ...s.events,
          { id: nextId(), kind: "system", text: "对话太短，无需压缩（至少需要 4 条消息）。", ts: Date.now() },
        ],
      }));
    }
    return;
  }
  if (!apiKeyVault.hasKey()) {
    if (trigger === "manual") {
      set((s) => ({
        events: [
          ...s.events,
          { id: nextId(), kind: "error", text: "无法压缩：未配置 API Key。压缩需要调用模型生成摘要。", ts: Date.now() },
        ],
      }));
    }
    return;
  }
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
  set({ isCompacting: true, agentStatus: "正在压缩对话历史…" });
  try {
    const result = await compactConversation(messages, aiConfig);
    // 真写回 store——后续每一轮请求都发送压缩后的历史
    const released = result.tokensBefore - result.tokensAfter;
    set((s) => ({
      messages: result.messages,
      truncated: false,
      // 累计本次释放的 token 数与压缩次数（压缩感知面板用）
      compactedReleases: (s.compactedReleases ?? 0) + (released > 0 ? released : 0),
      compactCount: (s.compactCount ?? 0) + 1,
      lastCompactMsgCount: result.messages.length,
    }));
    // 立即持久化压缩后的历史——否则刷新页面后 IndexedDB 里还是
    // 未压缩的完整对话，压缩效果丢失（send 里下一次 schedulePersist
    // 才会覆盖，但刷新前这个窗口期内持久化层是旧数据）。
    void flushPersist(get);
    const modeLabel = result.mode === "llm" ? "LLM 摘要" : "启发式压缩（摘要调用失败，已降级）";
    set((s) => ({
      events: [
        ...s.events,
        {
          id: nextId(),
          kind: "system",
          text: `${trigger === "auto" ? "已自动压缩对话历史" : "已压缩对话历史"}（${modeLabel}）：${messages.length} 条消息 → ${result.messages.length} 条，释放约 ${((result.tokensBefore - result.tokensAfter) / 1000).toFixed(1)}K token（${result.tokensBefore.toLocaleString()} → ${result.tokensAfter.toLocaleString()}）。旧对话已浓缩为摘要。`,
          ts: Date.now(),
        },
      ],
    }));
  } catch (e) {
    if (trigger === "manual") {
      set((s) => ({
        events: [
          ...s.events,
          { id: nextId(), kind: "error", text: `压缩失败：${e instanceof Error ? e.message : String(e)}。对话历史保持不变。`, ts: Date.now() },
        ],
      }));
    }
  } finally {
    // 无论成功失败都清除压缩状态——UI 的"压缩中"动画随之消失
    set({ isCompacting: false, agentStatus: "" });
  }
}

export const useSession = create<SessionState>((set, get) => ({
  events: [],
  messages: [],
  sessionId: "",
  title: "",
  sessions: [],
  config: DEFAULT_CONFIG,
  isStreaming: false,
  isCompacting: false,
  abortController: null,
  agentStatus: "",
  streamingText: null,
      streamingReasoning: null,
  agentIteration: 0,
  agentMaxIterations: 12,
  totalTokens: 0,
  lastUsage: null,
  compactedReleases: 0,
  compactCount: 0,
  lastCompactMsgCount: 0,
  usageHistory: [],
  vfsChangeLog: [],
  truncated: false,
  mode: "bypass",
  pendingQuestions: null,
  pendingDownload: null,
  pendingZipRequest: null,
  lastSentPayload: null,
  pendingOverrideMessages: null,
  setPendingOverrideMessages: (msgs) => set({ pendingOverrideMessages: msgs }),
  availableModels: [],
  setAvailableModels: (models) => set({ availableModels: models }),
  agentPreset: "full",

  init: () => {
    const cfg = loadConfig();
    // Idle auto-lock: attach listeners once, arm the timer per config.
    attachIdleLock();
    rearmIdleLock();
    // Try to restore API keys from encrypted localStorage copy
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
    // Restore the active session (messages + events + token counts) so that
    // a page refresh doesn't lose the conversation.
    const sessionId = getActiveSessionId();
    set({ sessionId });
    void loadSession(sessionId).then((persisted) => {
      if (persisted) {
        set({
          title: persisted.title || "",
          messages: persisted.messages,
          events: persisted.events,
          totalTokens: persisted.totalTokens,
          lastUsage: persisted.lastUsage,
          compactedReleases: persisted.compactedReleases ?? 0,
          compactCount: persisted.compactCount ?? 0,
          // 恢复的会话视作"刚压缩过"：auto-compact 需再累积 10 条新消息才触发，
          // 避免恢复长会话时意外多花一次摘要调用。
          lastCompactMsgCount: persisted.messages.length,
          usageHistory: persisted.usageHistory ?? [],
          vfsChangeLog: persisted.vfsChangeLog ?? [],
        });
      }
      void get().refreshSessionList();
    });
  },

  setConfig: (patch) => {
    const next = { ...get().config, ...patch };
    set({ config: next });
    saveConfig(next);
    // If the idle-lock threshold changed, re-arm the timer.
    if ("idleLockMinutes" in patch) rearmIdleLock();
  },

  clearSession: async () => {
    get().abort();
    const now = Date.now();
    // Persist the now-empty record so the session entry (and its title) survives.
    const session: PersistedSession = {
      id: get().sessionId || getActiveSessionId(),
      title: get().title || "新会话",
      messages: [],
      events: [],
      totalTokens: 0,
      lastUsage: null,
      compactedReleases: 0,
      compactCount: 0,
      usageHistory: [],
      vfsChangeLog: [],
      createdAt: get().events[0]?.ts ?? now,
      updatedAt: now,
    };
    await saveSession(session);
    set({
      events: [
        {
          id: nextId(),
          kind: "system",
          text: "Session cleared. The workspace (文件袋) is unchanged.",
          ts: now,
        },
      ],
      messages: [],
      isStreaming: false,
      agentStatus: "",
      streamingText: null,
      streamingReasoning: null,
      agentIteration: 0,
      totalTokens: 0,
      lastUsage: null,
      compactedReleases: 0,
      compactCount: 0,
      lastCompactMsgCount: 0,
      usageHistory: [],
      vfsChangeLog: [],
      truncated: false,
      pendingQuestions: null,
      pendingDownload: null,
      pendingZipRequest: null,
      lastSentPayload: null,
      pendingOverrideMessages: null,
    });
    await get().refreshSessionList();
  },

  reset: () => {
    void get().clearSession();
  },

  newSession: async () => {
    get().abort();
    await flushPersist(get);
    const preset = get().config.defaultPreset ?? "full";
    const session = await createSession(undefined, preset);
    setActiveSessionId(session.id);
    set({
      sessionId: session.id,
      agentPreset: preset,
      title: "",
      events: [],
      messages: [],
      isStreaming: false,
      agentStatus: "",
      streamingText: null,
      streamingReasoning: null,
      agentIteration: 0,
      totalTokens: 0,
      lastUsage: null,
      compactedReleases: 0,
      compactCount: 0,
      lastCompactMsgCount: 0,
      usageHistory: [],
      vfsChangeLog: [],
      truncated: false,
      pendingQuestions: null,
      pendingDownload: null,
      pendingZipRequest: null,
      lastSentPayload: null,
      pendingOverrideMessages: null,
    });
    await get().refreshSessionList();
  },

  switchSession: async (id: string) => {
    if (id === get().sessionId) return;
    get().abort();
    await flushPersist(get);
    setActiveSessionId(id);
    const rec = await loadSession(id);
    const events = rec?.events?.length ? rec.events : [];
    set({
      sessionId: id,
      title: rec?.title ?? "",
      messages: rec?.messages ?? [],
      events,
      totalTokens: rec?.totalTokens ?? 0,
      lastUsage: rec?.lastUsage ?? null,
      compactedReleases: rec?.compactedReleases ?? 0,
      compactCount: rec?.compactCount ?? 0,
      lastCompactMsgCount: rec?.messages?.length ?? 0,
      usageHistory: rec?.usageHistory ?? [],
      vfsChangeLog: rec?.vfsChangeLog ?? [],
      agentPreset: rec?.agentPreset ?? "full",
      isStreaming: false,
      agentStatus: "",
      streamingText: null,
      streamingReasoning: null,
      agentIteration: 0,
      truncated: false,
      pendingQuestions: null,
      pendingDownload: null,
      pendingZipRequest: null,
      lastSentPayload: null,
      pendingOverrideMessages: null,
    });
    await get().refreshSessionList();
  },

  setAgentPreset: (preset: AgentPreset) => {
    set({ agentPreset: preset });
    void flushPersist(get);
  },

  deleteSession: async (id: string) => {
    const isCurrent = id === get().sessionId;
    await deleteSessionStorage(id);
    await get().refreshSessionList();
    // Never leave the active pointer dangling on a deleted session.
    if (isCurrent) await get().newSession();
  },

  renameSession: async (id: string, title: string) => {
    await renameSessionStorage(id, title);
    if (id === get().sessionId) set({ title });
    await get().refreshSessionList();
  },

  refreshSessionList: async () => {
    set({ sessions: await listSessions() });
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
      streamingReasoning: null,
        agentIteration: 0,
      });
    }
  },

  compact: async () => {
    await doCompact("manual", set, get);
  },

  toggleMode: () => {
    const current = get().mode;
    const next = current === "bypass" ? "plan" : "bypass";
    set({ mode: next });
    // 不再 push system 事件（避免全宽 SystemRow 色块占满屏幕）——
    // 切换反馈由 terminal 用 toast 轻提示。仅注入 AI 可见的
    // [Mode Switch] 消息（AI 必须感知模式，否则依赖过期上下文误报）。
    useSession.setState((s) => ({
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
  setPendingDownload: (d) => {
    set({ pendingDownload: d });
  },
  setPendingZipRequest: (r) => {
    set({ pendingZipRequest: r });
  },

  send: async (text: string, attachments?: UploadedAttachment[]) => {
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

    const imgs = (attachments ?? []).filter((a) => a.isImage);
    const hasImages = imgs.length > 0;

    // 视觉模型：content 用数组（text + 每张图的 file_id 或 base64 兜底）。
    // 非视觉模型：content 保持纯字符串（图片若存在则报错提示——后端会 400）。
    let userMsg: ChatMessage;
    let note: string | null = null;
    if (hasImages && !config.supportVision) {
      userMsg = {
        role: "user",
        content: `${trimmed}\n\n[用户上传了 ${imgs.length} 张图片，但当前模型不支持视觉输入，图片未附加上传。请切换到支持视觉的模型（如 deepseek-v4-flash-vision-exp）后重试。]`,
      };
      note = `当前模型不支持视觉输入，已跳过 ${imgs.length} 张图片。`;
    } else if (hasImages) {
      const parts: ContentPart[] = [
        { type: "text", text: trimmed },
        ...imgs.map((a): ContentPart =>
          a.fileId
            ? { type: "file", file_id: a.fileId }
            : { type: "image_url", image_url: { url: a.dataUrl ?? "" } },
        ),
      ];
      userMsg = { role: "user", content: parts };
    } else {
      userMsg = { role: "user", content: trimmed };
    }

    const userEvent: SessionEvent = {
      id: nextId(),
      kind: "user",
      text: trimmed,
      attachments: (attachments ?? []).length > 0 ? attachments : undefined,
      ts: Date.now(),
    };
    const ac = new AbortController();
    set((s) => {
      const newMessages = [...s.messages, userMsg];
      // Auto-title from the first user message (empty/new sessions only).
      const title = !s.title ? deriveTitle(trimmed) : s.title;
      const extraEvents = note
        ? [{ id: nextId(), kind: "error" as const, text: note, ts: Date.now() }]
        : [];
      return {
        events: [...s.events, userEvent, ...extraEvents],
        messages: newMessages,
        title,
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
      streamingReasoning: null,
        agentIteration: 0,
      }));
    } finally {
      set({
        isStreaming: false,
        abortController: null,
        agentStatus: "",
  streamingText: null,
      streamingReasoning: null,
        agentIteration: 0,
      });
      // Persist the final state of this turn.
      schedulePersist(get);
    }
  },

  /** 重改：找到最后一轮 user 提问，丢弃其后全部消息/事件，用同一提问重跑。 */
  regenerate: async () => {
    if (get().isStreaming) return;
    const s = get();
    let lastUserMsgIdx = -1;
    for (let i = s.messages.length - 1; i >= 0; i--) {
      if (s.messages[i].role === "user") {
        lastUserMsgIdx = i;
        break;
      }
    }
    if (lastUserMsgIdx < 0) return;
    const lastUserMsg = s.messages[lastUserMsgIdx];
    let lastUserEventIdx = -1;
    for (let i = s.events.length - 1; i >= 0; i--) {
      if (s.events[i].kind === "user") {
        lastUserEventIdx = i;
        break;
      }
    }
    const newMessages = [...s.messages.slice(0, lastUserMsgIdx), lastUserMsg];
    const newEvents = lastUserEventIdx >= 0 ? s.events.slice(0, lastUserEventIdx) : [...s.events];
    if (lastUserEventIdx >= 0 && s.events[lastUserEventIdx]) {
      newEvents.push({ ...s.events[lastUserEventIdx], id: nextId(), ts: Date.now() });
    }
    const ac = new AbortController();
    set({
      messages: newMessages,
      events: newEvents,
      isStreaming: true,
      abortController: ac,
      agentStatus: "Thinking…",
      agentIteration: 0,
      streamingText: null,
      streamingReasoning: null,
    });
    try {
      await runAgentLoop(set, get, ac.signal);
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      const errEvent: SessionEvent = {
        id: nextId(),
        kind: "error",
        text: isAbort ? "Stopped by user." : e instanceof Error ? classifyApiError(e) : String(e),
        ts: Date.now(),
      };
      set((st) => ({
        events: [...st.events, errEvent],
        isStreaming: false,
        abortController: null,
        agentStatus: "",
        streamingText: null,
        streamingReasoning: null,
        agentIteration: 0,
      }));
    } finally {
      set({
        isStreaming: false,
        abortController: null,
        agentStatus: "",
        streamingText: null,
        streamingReasoning: null,
        agentIteration: 0,
      });
      schedulePersist(get);
    }
  },

  /** 修改某条用户消息：替换它，清空其后所有事件/消息，并从它重新跑 agent。 */
  rewriteFromMessage: async (eventId: string, newText: string) => {
    if (get().isStreaming) return;
    const trimmed = newText.trim();
    if (!trimmed) return;
    const s = get();
    let userEventIdx = -1;
    for (let i = s.events.length - 1; i >= 0; i--) {
      if (s.events[i].id === eventId && s.events[i].kind === "user") {
        userEventIdx = i;
        break;
      }
    }
    if (userEventIdx < 0) return;
    const oldEvent = s.events[userEventIdx];
    // 该事件之前有多少个 user 事件 → 对应 messages 中第 N 条 user 消息
    let userCount = 0;
    for (let i = 0; i <= userEventIdx; i++) if (s.events[i].kind === "user") userCount++;
    let userMsgIdx = -1;
    let seen = 0;
    for (let i = 0; i < s.messages.length && userMsgIdx < 0; i++) {
      if (s.messages[i].role === "user") {
        seen++;
        if (seen === userCount) userMsgIdx = i;
      }
    }
    // 构造替换后的 user 消息（保留图片附件的 file_id / base64）
    let userMsg: ChatMessage;
    const attachments = oldEvent.attachments;
    if (attachments && attachments.length > 0) {
      const parts: ContentPart[] = [{ type: "text", text: trimmed }];
      for (const a of attachments) {
        if (a.fileId) parts.push({ type: "file", file_id: a.fileId });
        else if (a.dataUrl) parts.push({ type: "image_url", image_url: { url: a.dataUrl } });
      }
      userMsg = { role: "user", content: parts };
    } else {
      userMsg = { role: "user", content: trimmed };
    }
    const newMessages = userMsgIdx >= 0
      ? [...s.messages.slice(0, userMsgIdx), userMsg]
      : [...s.messages, userMsg];
    const newEvents = [
      ...s.events.slice(0, userEventIdx),
      { id: nextId(), kind: "user" as const, text: trimmed, attachments, ts: Date.now() },
    ];
    const ac = new AbortController();
    set({
      messages: newMessages,
      events: newEvents,
      title: !s.title ? deriveTitle(trimmed) : s.title,
      isStreaming: true,
      abortController: ac,
      agentStatus: "Thinking…",
      agentIteration: 0,
      streamingText: null,
      streamingReasoning: null,
    });
    try {
      await runAgentLoop(set, get, ac.signal);
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      const errEvent: SessionEvent = {
        id: nextId(),
        kind: "error",
        text: isAbort ? "Stopped by user." : e instanceof Error ? classifyApiError(e) : String(e),
        ts: Date.now(),
      };
      set((st) => ({
        events: [...st.events, errEvent],
        isStreaming: false,
        abortController: null,
        agentStatus: "",
        streamingText: null,
        streamingReasoning: null,
        agentIteration: 0,
      }));
    } finally {
      set({
        isStreaming: false,
        abortController: null,
        agentStatus: "",
        streamingText: null,
        streamingReasoning: null,
        agentIteration: 0,
      });
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
  const PER_REQUEST_TIMEOUT_MS = 300_000; // 5 minutes per AI request (long thinking)
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
  // (customInstructions is user-controlled and rarely changes; agentPreset is
  // locked at session creation), ensuring the prompt prefix is stable for API
  // caching.
  const preset = get().agentPreset ?? "full";
  const STATIC_SYSTEM_PROMPT = buildSystemPrompt({
    preset,
    customInstructions: config.customInstructions,
  });
  // 按运行模式过滤模型可见的工具集（full=全部；light/minimal=白名单子集）。
  // dispatch 层仍注册全部工具——被过滤的模型看不到就不会调用。
  const ACTIVE_TOOLS = filterToolsByPreset(preset);

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
    // pendingOverrideMessages: 用户在 payload 编辑器中改过的消息列表，用它
    // 替换当前历史（system/workspace-context 由 send 自行重建）。首轮消费后清空。
    const overrideMsgs = get().pendingOverrideMessages;
    const historyMsgs = overrideMsgs ?? get().messages;
    let fullMessages: ChatMessage[] = [
      { role: "system", content: STATIC_SYSTEM_PROMPT },
      // The context block is injected as a user message so that the system
      // prompt stays fully static and cacheable.
      { role: "user", content: contextBlock },
      ...historyMsgs,
    ];
    if (overrideMsgs) set({ pendingOverrideMessages: null, truncated: false });
    // 预热真分词器（fire-and-forget，不阻塞发送；本轮估算仍走字符启发式，
    // 下一轮起自动升级为 DeepSeek BPE 精确计数）。
    warmup();
    // auto-compact：真分词器就绪 + 估算超预算 85% + 距上次压缩 ≥10 条新消息
    // → 自动 LLM 摘要（信息保留）；否则由 truncateConversation 丢旧消息兜底。
    if (tokenizerStatus() === "ready") {
      const estimatedTokens = await countConversationTokensAccurate(fullMessages);
      if (shouldAutoCompact({
        autoCompact: config.autoCompact,
        isCompacting: get().isCompacting,
        estimatedTokens,
        tokenBudget: config.tokenBudget,
        messagesSinceLastCompact: get().messages.length - (get().lastCompactMsgCount ?? 0),
      })) {
        await doCompact("auto", set, get);
        // compact 已替换 get().messages——重建 fullMessages（含新注入的 context block）
        fullMessages = [
          { role: "system", content: STATIC_SYSTEM_PROMPT },
          { role: "user", content: contextBlock },
          ...get().messages,
        ];
      }
    }
    const { messages: truncatedMsgs, dropped, tokensBefore, tokensAfter } =
      await truncateConversation(fullMessages, config.tokenBudget, 10);
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
    // 记录本次实际发送的 payload，供 payload-inspector 弹窗展示/编辑。
    set({ lastSentPayload: messagesForAI });

    let streamedText = "";
    let reasoning = "";
    let firstTokenReceived = false;
    let firstReasoningMs: number | null = null;
    const streamStartMs = Date.now();
    const streamEventId = nextId();
    // Don't push to events yet — use streamingText for live updates.
    // The final event is pushed once when streaming completes.
    set({ streamingText: { id: streamEventId, text: "" } });

    // Combine the user's abort signal with a per-request timeout.
    // The flag disambiguates timeout from user-abort: fetch rejects a timeout
    // abort with name === "AbortError", so e.name alone cannot tell them apart.
    let requestTimedOut = false;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      requestTimedOut = true;
      timeoutController.abort(new DOMException("Request timed out", "TimeoutError"));
    }, PER_REQUEST_TIMEOUT_MS);
    const onUserAbort = () => timeoutController.abort(signal.reason);
    if (signal.aborted) timeoutController.abort(signal.reason);
    else signal.addEventListener("abort", onUserAbort, { once: true });

    let assistantMsg: ChatMessage;
    let finishReason: string | null = null;
    try {
      const result = await streamChatCompletionWithRetry(
        aiConfig,
        messagesForAI,
        ACTIVE_TOOLS,
        {
          onText: (delta) => {
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              set({ agentStatus: "Generating response…" });
            }
            streamedText += delta;
            set({ streamingText: { id: streamEventId, text: streamedText } });
          },
          onReasoning: (delta) => {
            if (firstReasoningMs === null) firstReasoningMs = Date.now();
            reasoning += delta;
            set({ streamingReasoning: { id: streamEventId, text: reasoning } });
          },
          onUsage: (usage) => {
            recordUsage(set, usage, "main");
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
      set({ streamingText: null, streamingReasoning: null });
      // Timeout must be checked before isAbort: a timeout abort also surfaces
      // as name === "AbortError", but should show a real error, not go silent.
      if (requestTimedOut) {
        set((s) => ({
          events: [
            ...s.events,
            {
              id: nextId(),
              kind: "error",
              text: `AI 请求超过 ${PER_REQUEST_TIMEOUT_MS / 1000 / 60} 分钟仍无响应，已中止。可能是思考内容过长或网络问题；可重试，或到设置里调大 Max tokens。`,
              ts: Date.now(),
            },
          ],
        }));
        return;
      }
      const isAbort = e instanceof Error && e.name === "AbortError";
      if (isAbort) return; // user pressed Stop — stay silent
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
    set({ streamingText: null, streamingReasoning: null });
    const hasText = streamedText.trim().length > 0;
    const hasReasoning = reasoning.trim().length > 0;
    const hasToolCalls =
      !!assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0;

    // Push the final assistant event (text and/or reasoning). Reasoning-only
    // responses (e.g. thinking consumed the whole budget) still render.
    if (hasText || hasReasoning) {
      set((s) => ({
        events: [
          ...s.events,
          {
            id: streamEventId,
            kind: "assistant-message" as const,
            text: hasText ? streamedText : undefined,
            reasoning: hasReasoning ? reasoning : undefined,
            ts: Date.now(),
            durationMs: firstReasoningMs !== null ? Date.now() - firstReasoningMs : Date.now() - streamStartMs,
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
      // at all (no text AND no reasoning). If empty, surface a system notice
      // so the user isn't left wondering what happened.
      if (!hasText && !hasReasoning) {
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
  "move_file", "batch_rename", "append_file", "create_dir", // update_plan 不在其中：计划存独立 plan store（不在 VFS），无需快照
  "apply_patch", "insert_at", "run_lua", "run_js", // run_lua/run_js 带 outputs 时写回 VFS → 需快照可 undo
  "bash", // bash 的 > / >> / tee / mkdir / rm / rmdir / touch / cp / mv / sed -i 会写 VFS
  "create_skill", "delete_skill", // 创建/删除 skill（写 skills/ 目录）→ 需快照可 undo
  "transpile", // 编译器语义：file/files/path 模式把产物写入 VFS → 需快照可 undo
  "git_commit", // git 提交（写 git 工作区）→ 需快照可 undo
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
          request_id: args.request_id ? String(args.request_id) : uuid().slice(0, 12),
          questions: rawQuestions.map((q: Record<string, unknown>) => {
            const qType = String(q.type ?? "text_input");
            const isSelect = qType === "single_select" || qType === "multi_select";
            return {
              id: q.id ? String(q.id) : `q_${uuid().slice(0, 6)}`,
              question: String(q.question),
              type: qType as "single_select" | "multi_select" | "text_input",
              options: isSelect
                ? (q.options as Array<Record<string, unknown>>)?.map((o) => ({
                    id: o.id ? String(o.id) : `opt_${uuid().slice(0, 6)}`,
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
          tokenBudget: config.tokenBudget,
          onUsage: (usage) => {
            recordUsage(set, usage, "subagent");
          },
          onStatus: (status) => {
            set({ agentStatus: `Subagent · ${status}` });
          },
          // 继承主循环模式：Plan 模式下子代理也只读（堵住绕过只读的漏洞）
          mode: get().mode,
          preset: get().agentPreset,
          signal,
        });
        // 撞迭代上限也是正常结果（部分完成），不标记失败——主代理从
        // summary 文本知道完成度；失败协议只对真正的失败生效。
        result = {
          ok: true,
          output: `Subagent ${subResult.completed ? "completed" : "stopped (hit iteration limit)"} after ${subResult.iterations} iterations, ${subResult.toolCallCount} tool calls.\n\n--- Subagent summary ---\n${subResult.summary}`,
          tool: "dispatch_subagent",
          args,
        };
      }
    } else if (tc.function.name === "orchestrate_task") {
      // Plan 模式拦截（special-case 在 Plan 检查之前，必须在此处理）：
      // orchestrate_task 产出工作产物，Plan 模式下不允许。
      if (get().mode === "plan") {
        result = {
          ok: false,
          output:
            "[Plan mode] orchestrate_task (produces work product) is blocked. " +
            "In Plan mode you can only READ and ANALYZE — propose your plan in text, " +
            "and the user will switch to Bypass mode to let you execute it.",
          tool: "orchestrate_task",
          args,
        };
      } else {
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
              recordUsage(set, usage, "orchestrator");
            },
            signal,
            preset: get().agentPreset,
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
      }
    } else {
      // Plan mode: block all mutating tools — AI can only read/analyze.
      // update_plan is EXEMPT: the plan is the planning artifact itself, so
      // maintaining it in Plan mode is allowed (aligned with modern agents).
      // dispatch_subagent stays allowed (read-only exploration is legal; the
      // subagent inherits the mode and runs read-only too). orchestrate_task
      // produces work product → blocked in Plan mode (in its special-case).
      const mutatingTools = new Set([
        "write_file", "edit_file", "multi_edit", "delete_file",
        "move_file", "batch_rename", "append_file", "create_dir",
        "apply_patch", "insert_at", "undo_edit", "unzip_archive",
        "create_skill", "delete_skill",
        "transpile", // 编译器语义：file/files/path 模式把产物写入 VFS → Plan 模式拦截
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
        const isUndo = tc.function.name === "undo_edit";
        // bash writes (>/>>/tee/mkdir/rm/rmdir/touch/cp/mv/sed -i) mutate the VFS,
        // but read-only bash (ls/cat/grep) must NOT push a no-op snapshot.
        const isMutatingBash =
          tc.function.name === "bash" &&
          bashCommandMutates(typeof args.command === "string" ? args.command : "");
        if (
          !skipSnapshot &&
          !isUndo &&
          (MUTATING_TOOLS.has(tc.function.name) || isMutatingBash)
        ) {
          vfs.takeSnapshot(`${tc.function.name}(${formatToolArgsPreview(args)})`);
        }
        result = await dispatchTool(tc.function.name, args, { readOnly: get().mode === "plan" });
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

/* ────────────────────────── VFS 变更日志订阅 ──────────────────────────
 * emit 是同步的（vfs.ts），这里把每次写/删/改名/清空记入当前会话的
 * vfsChangeLog（审计面板的"文件改动"数据源，覆盖 delete/move/bash 写入
 * ——这些工具没有 diff）。上限 500 条防爆。 */
onVfsEvent((e) => {
  useSession.setState((s) => ({
    vfsChangeLog: [
      ...(s.vfsChangeLog ?? []),
      { ts: Date.now(), ...e },
    ].slice(-500),
  }));
});
