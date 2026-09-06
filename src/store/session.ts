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

import {  create  } from "zustand";
import {
  classifyApiError,
  type ChatMessage,
  type ContentPart,
  type TokenUsage
} from "@/lib/ai-client";
import {
  type AgentPreset,
} from "@/lib/tools/index";
import {  onVfsEvent  } from "@/lib/vfs";
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
  type SessionMeta
} from "@/lib/session-storage";
import {  apiKeyVault  } from "@/lib/api-key-vault";
import {  nextId,  flushPersist,  schedulePersist  } from "./session-persist";
import {  setCwd  } from "@/lib/tools/bash/context";
import {  doCompact  } from "./session-compact";
import {  runAgentLoop } from "./agent-loop";
import {  MODE_SWITCH_PREFIX, isModeSwitchMessage  } from "./session-helpers";

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
  defaultPreset: "full"
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

export interface SessionState {
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

// ---------------------------------------------------------------------------
// 回合身份守卫 —— 流式回合进行中用户可能切走会话（switch/new/clear 都会
// abort 后整体替换 store 内容），而取消是协作式的：await 空窗里迟到的写回
// 若不校验身份，会把旧回合的半截输出/错误注记落进新会话，尾声的
// schedulePersist 还会把新会话误存一次。回合开始时捕获 sessionId，
// 之后所有写回都走"会话未变才生效"的 turnSet。
// ---------------------------------------------------------------------------
type TurnSet = (
  partial: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>),
) => void;
function makeTurnSet(set: TurnSet, get: () => SessionState, turnSessionId: string): TurnSet {
  return (partial) => {
    if (get().sessionId !== turnSessionId) return;
    set(partial);
  };
}

// 快速连点两个会话的竞态守卫：两次 switchSession 交错 await loadSession，
// 后完成者会覆盖先完成者、高亮与内容错位——序号不一致时放弃本次切换。
let switchSessionSeq = 0;

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
    setCwd(""); // 重置 bash 沙箱会话 cwd（跨会话残留会让相对路径解析错乱）
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
    const seq = ++switchSessionSeq;
    get().abort();
    setCwd(""); // 重置 bash 沙箱会话 cwd
    await flushPersist(get);
    if (seq !== switchSessionSeq) return; // 更晚的切换已接管，放弃本次
    setActiveSessionId(id);
    const rec = await loadSession(id);
    if (seq !== switchSessionSeq) return; // loadSession 期间有更晚的切换
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
    schedulePersist(get);
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
          content: `${MODE_SWITCH_PREFIX} I've switched to ${next.toUpperCase()} mode. ${next === "plan" ? "You can ONLY read and analyze files. All write tools are BLOCKED. Propose a plan and wait for approval." : "You can read, write, edit, and delete files freely. Execute your plan directly."}`,
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
    // 空文本但有附件（纯图片发送）是合法输入——此前这里直接 return，
    // 而 UI 侧已清空附件，导致附件被静默丢弃。
    if (!trimmed && (!attachments || attachments.length === 0)) return;
    if (get().isStreaming) return;
    const turnSessionId = get().sessionId;
    const turnSet = makeTurnSet(set, get, turnSessionId);

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
        // 纯图片发送时 trimmed 为空——给 text part 一个占位，避免空字符串部分被部分 API 拒绝
        { type: "text", text: trimmed || "（见图片）" },
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
      text: trimmed || (hasImages ? "[图片]" : ""),
      attachments: (attachments ?? []).length > 0 ? attachments : undefined,
      ts: Date.now(),
    };
    const ac = new AbortController();
    turnSet((s) => {
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
      await runAgentLoop(turnSet, get, ac.signal);
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
      turnSet((s) => ({
        events: [...s.events, errEvent],
        isStreaming: false,
        abortController: null,
        agentStatus: "",
  streamingText: null,
      streamingReasoning: null,
        agentIteration: 0,
      }));
    } finally {
      turnSet({
        isStreaming: false,
        abortController: null,
        agentStatus: "",
        streamingText: null,
        streamingReasoning: null,
        agentIteration: 0,
      });
      // Persist the final state of this turn. 会话已切走时不得误存新会话。
      if (get().sessionId === turnSessionId) schedulePersist(get);
    }
  },

  /** 重改：找到最后一轮 user 提问，丢弃其后全部消息/事件，用同一提问重跑。 */
  regenerate: async () => {
    if (get().isStreaming) return;
    const turnSessionId = get().sessionId;
    const turnSet = makeTurnSet(set, get, turnSessionId);
    const s = get();
    let lastUserMsgIdx = -1;
    for (let i = s.messages.length - 1; i >= 0; i--) {
      // 跳过 toggleMode 注入的幽灵消息——它不是真实用户输入
      if (s.messages[i].role === "user" && !isModeSwitchMessage(s.messages[i])) {
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
      await runAgentLoop(turnSet, get, ac.signal);
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      const errEvent: SessionEvent = {
        id: nextId(),
        kind: "error",
        text: isAbort ? "Stopped by user." : e instanceof Error ? classifyApiError(e) : String(e),
        ts: Date.now(),
      };
      turnSet((st) => ({
        events: [...st.events, errEvent],
        isStreaming: false,
        abortController: null,
        agentStatus: "",
        streamingText: null,
        streamingReasoning: null,
        agentIteration: 0,
      }));
    } finally {
      turnSet({
        isStreaming: false,
        abortController: null,
        agentStatus: "",
        streamingText: null,
        streamingReasoning: null,
        agentIteration: 0,
      });
      if (get().sessionId === turnSessionId) schedulePersist(get);
    }
  },

  /** 修改某条用户消息：替换它，清空其后所有事件/消息，并从它重新跑 agent。 */
  rewriteFromMessage: async (eventId: string, newText: string) => {
    if (get().isStreaming) return;
    const trimmed = newText.trim();
    if (!trimmed) return;
    const turnSessionId = get().sessionId;
    const turnSet = makeTurnSet(set, get, turnSessionId);
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
      // 跳过 toggleMode 注入的幽灵消息——否则序号映射错位，真实用户消息被顶掉
      if (s.messages[i].role === "user" && !isModeSwitchMessage(s.messages[i])) {
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
      await runAgentLoop(turnSet, get, ac.signal);
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      const errEvent: SessionEvent = {
        id: nextId(),
        kind: "error",
        text: isAbort ? "Stopped by user." : e instanceof Error ? classifyApiError(e) : String(e),
        ts: Date.now(),
      };
      turnSet((st) => ({
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
  }
}));

// ---------------------------------------------------------------------------
// The agent loop
// ---------------------------------------------------------------------------

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
