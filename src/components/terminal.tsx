"use client";

/**
 * Terminal — the main Open Code Web TUI panel.
 *
 * Renders the session event stream (user input, streamed assistant text,
 * tool calls + results with diffs, errors, system notices) and exposes a
 * multi-line input at the bottom.
 *
 * Markdown is rendered with react-markdown + remark-gfm for full GFM support
 * (tables, strikethrough, task lists, autolinks).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  ArrowUp,
  Download,
  Plus,
  Loader2,
  Square,
  Trash2,
  FileText,
  Check,
  X,
  ChevronDown,
  Wrench,
  Sparkles,
  Sigma,
  FolderOpen,
  PanelRight,
  Shield,
  ClipboardList,
  ScrollText,
  Pencil,
  Zap,
  Settings2,
  MoreHorizontal,
  Bell,
  FlaskConical,
  Lock,
  GitMerge,
  Bug,
  PenLine} from "lucide-react";
import { useSession, type SessionEvent, type UploadedAttachment } from "@/store/session";
import { uploadFileToDeepSeek } from "@/lib/files-api";
import { apiKeyVault } from "@/lib/api-key-vault";
import { countTokens, countConversationTokensAccurate, onTokenizerStatus, tokenizerStatus, warmup, type TokenizerStatus } from "@/lib/wasm/tokenizer";

/** Read a File/Blob as a data: URL (base64) — used for image attachments. */
function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}
import { buildHelpText } from "@/lib/help-content";
import { useVfsView } from "@/store/vfs-view";
import { vfs } from "@/lib/vfs";
import { toast } from "sonner";
import { ZipDownloadBridge, ZipPickerModal } from "./zip-picker";
import { PayloadInspector } from "./payload-inspector";
import { TokenSheet } from "./token-sheet";
import { FileTypeIcon } from "@/lib/file-icon";
import { cn } from "@/lib/utils";
import { matchModelRate, estimateCost, split80_20 } from "@/lib/cost";
import { buildAuditReport, renderAuditMarkdown } from "@/lib/audit";
import { downloadBlob } from "@/lib/download";
import { groupToolEvents, groupAssistantTurns, groupRounds, RoundBlock, StepCard, ThinkingStep, SubagentCard } from "./terminal/rounds";
import { UserRow, AssistantRow, ErrorRow, SystemRow, PlanHeaderBadge } from "./terminal/rows";
import { QuestionModal } from "./terminal/question";
import { promptDialog } from "@/components/ui/confirm";

/** DeepSeek 官方模型兜底：即使 /models 尚未拉取，也保证模型菜单能看到这几个。 */
const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-vision-exp"];

// ---------------------------------------------------------------------------
// 首页（空状态）建议区与功能区 —— ZCode 式快捷入口：点击填入输入框
// ---------------------------------------------------------------------------
const HOME_SUGGESTIONS = [
  { icon: ClipboardList, text: "每周五总结这一周发生的事情。" },
  { icon: FlaskConical, text: "请分析以下终端报错日志，找出导致该错误的根本原因，并提供可以直接运行的修复代码示例。" },
  { icon: Lock, text: "帮我创建一份科技感十足的PPT，主题是「AI Agent 进化之路」。" },
];

const HOME_CARDS = [
  {
    icon: GitMerge,
    title: "Git 站会摘要",
    desc: "每周五总结这一周发生的事情。",
    prompt: "总结这一周的 Git 提交与项目进展，生成本周末的站会摘要。",
  },
  {
    icon: Bug,
    title: "CI 失败与不稳定测试报告",
    desc: "汇总近期 CI 失败和不稳定测试，并分析可能原因。",
    prompt: "汇总近期 CI 失败和不稳定测试，并分析可能原因。",
  },
  { icon: PenLine, title: "自定义", desc: "跳过模板，直接告诉它你想做什么。", prompt: "" },
];

/** 事件尾部窗口大小：默认只渲染最近 N 组（更早的按需展开）。 */
const RENDER_WINDOW = 200;

export function Terminal() {
  const isMobile = useIsMobile();
  const events = useSession((s) => s.events);
  const isStreaming = useSession((s) => s.isStreaming);
  const isCompacting = useSession((s) => s.isCompacting);
  const agentIteration = useSession((s) => s.agentIteration);
  const totalTokens = useSession((s) => s.totalTokens);
  const compactedReleases = useSession((s) => s.compactedReleases ?? 0);
  const compactCount = useSession((s) => s.compactCount ?? 0);
  const lastUsage = useSession((s) => s.lastUsage);
  const config = useSession((s) => s.config);
  const setConfig = useSession((s) => s.setConfig);
  const agentPreset = useSession((s) => s.agentPreset);
  const availableModels = useSession((s) => s.availableModels);
  const mode = useSession((s) => s.mode);
  const toggleMode = useSession((s) => s.toggleMode);
  const setAgentPreset = useSession((s) => s.setAgentPreset);
  const sessionId = useSession((s) => s.sessionId);
  const title = useSession((s) => s.title);
  const renameSession = useSession((s) => s.renameSession);
  const streamingText = useSession((s) => s.streamingText);
  const streamingReasoning = useSession((s) => s.streamingReasoning);
  const send = useSession((s) => s.send);
  const abort = useSession((s) => s.abort);
  const reset = useSession((s) => s.reset);
  const pendingQuestions = useSession((s) => s.pendingQuestions);
  const setPendingQuestions = useSession((s) => s.setPendingQuestions);
  // 订阅 VFS 就绪状态：@mention 下拉依赖 vfs 缓存，必须等 IndexedDB
  // hydrate 完成（及后续文件袋增删）触发重渲染，否则下拉永远是空。
  const vfsHydrated = useVfsView((s) => s.hydrated);
  const vfsVersion = useVfsView((s) => s.version);
  const rightPanelOpen = useVfsView((s) => s.rightPanelOpen);
  const setRightPanelOpen = useVfsView((s) => s.setRightPanelOpen);

  // 分词器 WASM 状态：footer 微标展示"后台加载的事"（就绪前 ≈N 为估算）
  const [tokStatus, setTokStatus] = useState<TokenizerStatus>(() => tokenizerStatus());
  useEffect(() => onTokenizerStatus(setTokStatus), []);
  // 上下文占用百分比（budget 口径，防抖 2s——不打断流式渲染）
  const [ctxPct, setCtxPct] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        const payload = useSession.getState().lastSentPayload;
        if (!payload?.length) return;
        const tokens = await countConversationTokensAccurate(payload);
        if (alive) setCtxPct(Math.min(100, Math.round((tokens / config.tokenBudget) * 100)));
      })();
    }, 2000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [events, streamingText, config.tokenBudget]);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  // 模型切换下拉（header）
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  // 运行模式 / 执行模式 下拉
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  // 思考强度 下拉
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  const effortMenuRef = useRef<HTMLDivElement>(null);
  // 顶栏 ⋯ 菜单（重命名 / 导出 / 清空）
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  // header 可选的模型：provider 拉取的 + DeepSeek 兜底 + 当前模型（可能手动输入不在列表）
  const headerModelChoices = useMemo(
    () =>
      Array.from(
        new Set([...DEEPSEEK_MODELS, ...(availableModels ?? []), config.model].filter(Boolean)),
      ),
    [availableModels, config.model],
  );
  // @mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  // Payload inspector modal (查看/编辑上次发送给 AI 的完整上下文)
  const [payloadOpen, setPayloadOpen] = useState(false);
  // Token usage sheet (右侧滑出)
  const [tokenSheetOpen, setTokenSheetOpen] = useState(false);
  // 附件（用户上传，随消息发送 + 写入 VFS uploads/）
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  // 在途的 Files API 上传（避免并发 setState 竞态）
  const filesUploading = useRef(0);
  // 实时输入 token 计数：输入文本 + 附件（真分词器精确，未就绪自动回退估算；300ms 防抖）
  const [liveTokens, setLiveTokens] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        const textTokens = input.trim() ? await countTokens(input) : 0;
        const attTokens = (attachments ?? []).reduce((s, a) => s + (a.tokens ?? 0), 0);
        setLiveTokens(textTokens + attTokens);
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [input, attachments]);
  // 最后一个 assistant-message（最终答案）id——只有它能在下方显示「重改」。
  const lastAssistantEventId = useMemo(() => {
    let id: string | null = null;
    for (const ev of events) if (ev.kind === "assistant-message") id = ev.id;
    return id;
  }, [events]);

  // 每个 assistant-message 所属「回合」的完整 AI 文本（思考 + 叙述 + 答案），
  // 供复制按钮用——否则只复制到最后一条无工具调用的部分。
  const assistantTurnTexts = useMemo(() => {
    const map = new Map<string, string>();
    let turnText = "";
    for (const ev of events) {
      if (ev.kind === "user" || ev.kind === "error" || ev.kind === "system") {
        turnText = "";
        continue;
      }
      if (ev.kind === "assistant-message") {
        const parts: string[] = [];
        if (ev.reasoning?.trim()) parts.push(ev.reasoning.trim());
        if (ev.text?.trim()) parts.push(ev.text.trim());
        const text = parts.join("\n\n");
        if (text) turnText = turnText ? `${turnText}\n\n${text}` : text;
        map.set(ev.id, turnText);
      }
    }
    return map;
  }, [events]);

  // Auto-scroll to bottom on new events when user is near the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (autoScroll) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events, streamingText, streamingReasoning, autoScroll]);

  // 点击 header 模型下拉外部 → 关闭
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [modelMenuOpen]);

  // 点击顶栏 ⋯ 菜单外部 → 关闭
  useEffect(() => {
    if (!moreMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [moreMenuOpen]);

  // 点击运行模式/执行模式下拉外部 → 关闭
  useEffect(() => {
    if (!modeMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [modeMenuOpen]);

  // 点击思考强度下拉外部 → 关闭
  useEffect(() => {
    if (!effortMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (effortMenuRef.current && !effortMenuRef.current.contains(e.target as Node)) {
        setEffortMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [effortMenuOpen]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  };

  const submit = () => {
    if ((!input.trim() && attachments.length === 0) || isStreaming) return;
    // Process @mentions: replace @filename with file content blocks
    const processedText = processMentions(input);
    const text = processedText;
    setInput("");
    setMentionQuery(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // Slash commands
    if (text.trim().startsWith("/")) {
      handleSlashCommand(text.trim());
      return;
    }

    const atts = attachments;
    setAttachments([]);
    void send(text, atts.length > 0 ? atts : undefined);
  };

  /** 附件上传：10MB 限制 → 写 VFS uploads/ → 图片异步尝试 Files API 拿 file_id。 */
  const handleAttach = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const MAX = 10 * 1024 * 1024;
    const next: UploadedAttachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX) {
        toast.error(`${file.name} 超过 10MB 上限，已跳过`);
        continue;
      }
      const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
      const path = `uploads/${file.name}`;
      // 附件 token 预计算：图片按 vision 固定 384（与 content 计数一致），文本用真分词器
      const att: UploadedAttachment = {
        name: file.name,
        path,
        isImage,
        tokens: isImage ? 384 : undefined,
      };
      // 写 VFS（图片=dataUrl，其余=文本）
      try {
        if (isImage) {
          att.dataUrl = await fileToDataUrl(file);
          await vfs.writeFile(path, att.dataUrl);
        } else {
          const text = await file.text();
          await vfs.writeFile(path, text);
          // 文本/代码类附件：内容 token（真分词器精确；未就绪时自动回退字符估算）
          att.tokens = await countTokens(text);
        }
      } catch {
        toast.error(`写入工作区失败: ${file.name}`);
        continue;
      }
      next.push(att);
      // 图片异步走 Files API（成功后清 dataUrl 省内存，失败保留 base64 兜底）
      if (isImage) {
        setUploading(true);
        filesUploading.current++;
        const res = await uploadFileToDeepSeek(config.baseUrl, file, apiKeyVault.getKey() ?? "");
        filesUploading.current--;
        if (res.ok && res.fileId) {
          att.fileId = res.fileId;
          att.dataUrl = undefined; // 已有 file_id，content 用 file 块，不必带 base64
        } else if (!res.ok) {
          // 保留 dataUrl → send 时自动走 image_url base64 兜底
          console.warn("[attach] Files API 失败，回退 base64:", res.error);
        }
        if (filesUploading.current <= 0) setUploading(false);
        setAttachments((prev) => [...prev]);
      }
    }
    if (next.length > 0) {
      setAttachments((prev) => [...prev, ...next]);
      toast.success(`已添加 ${next.length} 个附件`);
    }
  };

  /** @ 引用：只把 @路径 规范成明确的路径标记，供 AI 用 read_file 等工具
   *  自行读取——不把文件内容注入上下文（内容注入是本工具的反模式，
   *  会撑爆上下文，且 AI 需要时自会去读）。找不到文件也保留路径让 AI 判断。 */
  const processMentions = (text: string): string => {
    // @ 后匹配路径：非空白、非 @ 字符序列（支持中文/点开头/带点目录），
    // 到空白或行尾为止。
    return text.replace(/@([^\s@]+)/g, (match, filePath) => {
      return `[文件引用 ${filePath}]`;
    });
  };

  /** Detect @mention in the current input and return matching files.
   *  useMemo 显式依赖 vfsHydrated/vfsVersion——VFS hydrate 完成或文件袋
   *  增删时重算，否则首次加载下拉永远为空（原 bug：没订阅 VFS 状态）。 */
  const mentionFiles = useMemo(() => {
    if (!mentionQuery || !vfsHydrated) return [];
    return vfs
      .listAllFilesSync("")
      .filter((f) => f.path.toLowerCase().includes(mentionQuery.toLowerCase()))
      .slice(0, 8);
  }, [mentionQuery, vfsHydrated, vfsVersion]);

  const onInputChange = (val: string) => {
    setInput(val);
    // Detect @mention: look for @ followed by non-space chars at cursor position
    const cursorPos = textareaRef.current?.selectionStart ?? val.length;
    const beforeCursor = val.substring(0, cursorPos);
    const atMatch = beforeCursor.match(/@([^\s@]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  // 首页建议/卡片点击 → 填入输入框并聚焦（不直接发送，方便用户修改）
  const fillPrompt = (text: string) => {
    setInput(text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const insertMention = (filePath: string) => {
    const cursorPos = textareaRef.current?.selectionStart ?? input.length;
    const beforeCursor = input.substring(0, cursorPos);
    const afterCursor = input.substring(cursorPos);
    // Replace @query with @filePath
    const newBefore = beforeCursor.replace(/@[^\s@]*$/, `@${filePath} `);
    const newVal = newBefore + afterCursor;
    setInput(newVal);
    setMentionQuery(null);
    // Refocus and set cursor after the inserted mention
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const pos = newBefore.length;
        ta.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const handleSlashCommand = (cmd: string) => {
    const [name, ...rest] = cmd.slice(1).split(/\s+/);
    const arg = rest.join(" ").trim();
    const pushSystem = (text: string) => {
      useSession.setState((s) => ({
        events: [
          ...s.events,
          { id: `e${Date.now()}_${name}`, kind: "system" as const, text, ts: Date.now() },
        ],
      }));
    };

    switch (name.toLowerCase()) {
      case "clear":
      case "reset":
        reset();
        break;

      case "help":
        pushSystem(buildHelpText());
        break;

      case "tokens": {
        // 预算读真实配置；当前上下文占用在分词器就绪时做精确计数（未就绪自动回退估算）
        const lines = lastUsage
          ? [
              `Tokens used this session: ${totalTokens.toLocaleString()} total (real API usage)`,
              `  • Last request: ${lastUsage.prompt_tokens.toLocaleString()} prompt + ${lastUsage.completion_tokens.toLocaleString()} completion = ${lastUsage.total_tokens.toLocaleString()} total`,
              `  • Compaction: ${compactCount} time(s), cumulatively released ~${(compactedReleases / 1000).toFixed(1)}K token`,
            ]
          : [
              `Tokens used this session: ${totalTokens.toLocaleString()} total (real API usage)`,
              `  • No usage data yet — send a message to the AI.`,
              compactCount > 0
                ? `  • Compaction: ${compactCount} time(s), cumulatively released ~${(compactedReleases / 1000).toFixed(1)}K token`
                : `  • No compaction yet — type /compact to collapse old context into a summary`,
            ];
        lines.push(
          `  • Context budget: ${config.tokenBudget.toLocaleString()} tokens (auto-truncates when exceeded)`,
        );
        const emit = () => pushSystem(lines.join("\n"));
        const payload = useSession.getState().lastSentPayload;
        if (payload) {
          void countConversationTokensAccurate(payload)
            .then((n) => {
              lines.push(`  • Current context: ~${n.toLocaleString()} tokens (精确计数)`);
              emit();
            })
            .catch(() => emit());
        } else {
          emit();
        }
        break;
      }

      case "run": {
        // /run <command> — execute a bash command directly (no AI needed)
        if (!arg) {
          pushSystem("Usage: /run <command>  (e.g. /run echo hello | base64 -d)");
          break;
        }
        // Import dispatchTool dynamically to avoid circular deps
        import("@/lib/tools").then(({ dispatchTool }) => {
          const result = dispatchTool("bash", { command: arg });
          result.then((r) => {
            pushSystem(`$ ${arg}\n${r.output || "(no output)"}`);
            // Bump file bag if mutated
            if (r.mutated) useVfsView.getState().bump();
          });
        });
        break;
      }

      case "model": {
        if (!arg) {
          pushSystem(`Current model: ${config.model}\nUsage: /model <name>  (e.g. /model gpt-4o-mini)`);
          break;
        }
        const oldModel = config.model;
        setConfig({ model: arg });
        pushSystem(`Model switched: ${oldModel} → ${arg}`);
        break;
      }

      case "compact": {
        const beforeMsgs = useSession.getState().messages.length;
        if (beforeMsgs < 4) {
          pushSystem("对话太短，无需压缩（至少需要 4 条消息）。");
          break;
        }
        // 真正的压缩：LLM 摘要旧对话并写回 store。进度与结果由
        // compact() 以 system 事件反馈（含压缩前后对比）。
        void useSession.getState().compact();
        break;
      }

      case "inspect": {
        // 打开 payload 查看/编辑器：展示上次实际发送给 AI 服务器的完整上下文。
        const lastPayload = useSession.getState().lastSentPayload;
        if (!lastPayload || lastPayload.length === 0) {
          pushSystem("No payload to inspect yet — send a message to the AI first, then run /inspect.");
          break;
        }
        setPayloadOpen(true);
        break;
      }

      case "export": {
        const { events: allEvents, messages: allMsgs } = useSession.getState();
        const isEmpty = allEvents.length === 0 && allMsgs.length === 0;
        const isJson = arg === "json";

        if (isEmpty) {
          pushSystem("Nothing to export — the conversation is empty.");
          break;
        }

        if (isJson) {
          // --- JSON export (full data) ---
          const payload = {
            exportedAt: new Date().toISOString(),
            model: config.model,
            totalTokens: totalTokens,
            config: {
              baseUrl: config.baseUrl,
              temperature: config.temperature,
              maxTokens: config.maxTokens,
              thinkingEnabled: config.thinkingEnabled,
              reasoningEffort: config.reasoningEffort,
            },
            eventCount: allEvents.length,
            messageCount: allMsgs.length,
            events: allEvents,
            messages: allMsgs,
          };
          const json = JSON.stringify(payload, null, 2);
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `opencode-session-${Date.now()}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          pushSystem(`Exported ${allEvents.length} events + ${allMsgs.length} messages as JSON.`);
        } else {
          // --- Markdown export (chronological events) ---
          const lines: string[] = [`# Open Code Web — Session Export`, ""];
          lines.push(`Exported: ${new Date().toLocaleString()}`);
          lines.push(`Model: ${config.model}`);
          lines.push(`Total tokens: ${totalTokens.toLocaleString()}`);
          lines.push(`Events: ${allEvents.length}`);
          lines.push(`Messages: ${allMsgs.length}`);
          lines.push("");
          lines.push("---");
          lines.push("");

          for (const ev of allEvents) {
            switch (ev.kind) {
              case "user":
                lines.push("## 👤 User");
                lines.push("");
                lines.push(ev.text ?? "");
                lines.push("");
                break;
              case "assistant-message":
              case "assistant-text":
                lines.push("## 🤖 Assistant");
                lines.push("");
                lines.push(ev.text ?? "");
                lines.push("");
                break;
              case "tool-call":
                lines.push(`### 🔧 Tool call: \`${ev.toolName}\``);
                lines.push("");
                if (ev.toolArgs && Object.keys(ev.toolArgs).length > 0) {
                  lines.push("**Args:**");
                  for (const [k, v] of Object.entries(ev.toolArgs)) {
                    const val = typeof v === "string" ? v : JSON.stringify(v);
                    lines.push(`- \`${k}\`: ${val.slice(0, 500)}`);
                  }
                  lines.push("");
                }
                break;
              case "tool-result":
                const icon = ev.ok ? "✅" : "❌";
                lines.push(`### ${icon} Tool result: \`${ev.toolName}\``);
                lines.push("");
                if (ev.toolOutput) {
                  const output = ev.toolOutput.length > 2000
                    ? ev.toolOutput.slice(0, 2000) + "\n\n... (truncated)"
                    : ev.toolOutput;
                  lines.push("```\n" + output + "\n```");
                  lines.push("");
                }
                break;
              case "error":
                lines.push("## ❌ Error");
                lines.push("");
                lines.push(ev.text ?? "");
                lines.push("");
                break;
              case "system":
                lines.push(`## ℹ️ System`);
                lines.push("");
                lines.push(ev.text ?? "");
                lines.push("");
                break;
            }
          }

          const md = lines.join("\n");
          const blob = new Blob([md], { type: "text/markdown" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `opencode-session-${Date.now()}.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          pushSystem(`Exported ${allEvents.length} events as Markdown.`);
        }
        break;
      }

      case "cost": {
        // 价格表与估算逻辑在共享模块（审计面板同用）：src/lib/cost.ts
        const rate = matchModelRate(config.model);
        if (!rate) {
          pushSystem(
            `Session tokens: ${totalTokens.toLocaleString()} total.\n` +
              `No cost estimate available for model "${config.model}".\n` +
              `Add its pricing to the /cost rate table in src/lib/cost.ts if needed.`,
          );
          break;
        }
        // 有逐次 usage 记录用真实拆分，否则退化为 80/20 假设。
        const usageHistory = useSession.getState().usageHistory ?? [];
        const promptSum = usageHistory.reduce((s, u) => s + u.promptTokens, 0);
        const completionSum = usageHistory.reduce((s, u) => s + u.completionTokens, 0);
        let promptTok = promptSum;
        let completionTok = completionSum;
        let splitNote = "split from real per-request usage";
        if (promptTok + completionTok === 0) {
          const s = split80_20(totalTokens);
          promptTok = s.prompt;
          completionTok = s.completion;
          splitNote = "split is estimated 80/20 (no per-request usage recorded yet)";
        }
        const costTotal = estimateCost(rate, promptTok, completionTok);
        pushSystem(
          `Estimated cost for "${config.model}":\n` +
            `  • Tokens: ${totalTokens.toLocaleString()} total (${promptTok.toLocaleString()} prompt + ${completionTok.toLocaleString()} completion)\n` +
            `  • Rate: $${rate.in}/M input, $${rate.out}/M output\n` +
            `  • Cost: $${costTotal.toFixed(4)} (≈ $${(costTotal * 100).toFixed(2)} cents)\n` +
            `Note: ${splitNote}.`,
        );
        break;
      }

      case "audit": {
        // 会话审计报告：与右侧栏「审计」面板共用 buildAuditReport 聚合，
        // 这里导出 Markdown 供存档/分享。
        const st = useSession.getState();
        const report = buildAuditReport(
          st.events,
          st.usageHistory ?? [],
          st.vfsChangeLog ?? [],
          st.totalTokens,
          st.config.model,
        );
        const md = renderAuditMarkdown(report);
        const blob = new Blob([md], { type: "text/markdown" });
        downloadBlob(blob, `opencode-audit-${Date.now()}.md`);
        pushSystem(
          `Audit report exported: ${report.toolCallCount} tool calls, ${report.fileChanges.length} file changes, ` +
            `${report.totalTokens.toLocaleString()} tokens` +
            (report.cost ? `, ≈ $${report.cost.usd.toFixed(4)}` : ", cost n/a"),
        );
        break;
      }

      case "undo": {
        const peek = vfs.peekSnapshot();
        if (!peek) {
          pushSystem("Nothing to undo — no file edits have been made yet.");
          break;
        }
        const fileCount = peek.files.size;
        const label = vfs.restoreLastSnapshot();
        // Bump file bag view to refresh tree
        useVfsView.getState().bump();
        pushSystem(
          `Undid: ${label}\nFiles restored to previous state (${fileCount} files). ` +
            `${vfs.snapshotCount()} snapshot(s) remaining in history.`,
        );
        break;
      }

      case "diff": {
        const snapshots = vfs.listSnapshots();
        if (snapshots.length === 0) {
          pushSystem("No file changes recorded this session. Snapshots are taken before each AI edit.");
          break;
        }
        const lines = snapshots.map(
          (s, i) => `  ${i + 1}. ${new Date(s.ts).toLocaleTimeString()} — ${s.label} (${s.fileCount} files)`,
        );
        pushSystem(
          `File change history this session (${snapshots.length} edits):\n${lines.join("\n")}\n\n` +
            `Use /undo to revert the most recent change. The AI can also call undo_edit.`,
        );
        break;
      }

      case "skills": {
        // 列出可用 Skill 技能包（/skills）
        void import("@/lib/tools").then(({ dispatchTool }) =>
          dispatchTool("list_skills", {}).then((res) => {
            pushSystem(res.ok ? res.output : `skills 列表失败: ${res.output}`);
          }),
        );
        break;
      }

      default:
        pushSystem(`Unknown command: /${name}. Try /help.`);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // @mention navigation
    if (mentionQuery !== null && mentionFiles.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionFiles.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionFiles.length) % mentionFiles.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionFiles[mentionIndex].path);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    // Shift+Tab toggles between Plan and Bypass mode (like Claude Code)
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      const next = mode === "plan" ? "bypass" : "plan";
      toggleMode();
      toast(next === "plan" ? "已切换到 Plan 模式 — 只读" : "已切换到 Bypass 模式");
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  // 空状态：还没有任何 user/assistant 事件 → Hero 布局（隐藏 header，输入框居中）
  const isEmpty =
    events.every((ev) => ev.kind !== "user" && ev.kind !== "assistant-message") &&
    !streamingText &&
    !streamingReasoning;
  // 提升到组件体：Hero 条件渲染后 JSX 内的 useMemo 会导致 hook 数量不稳定
  const turnGroupsAll = useMemo(
    () => groupRounds(groupAssistantTurns(groupToolEvents(events))),
    [events],
  );
  // 尾部窗口：长会话（数千事件）全量渲染会积累巨量 DOM 节点。
  // 默认只渲染最近 RENDER_WINDOW 条，更早的按需展开。
  const [windowSize, setWindowSize] = useState(RENDER_WINDOW);
  const hiddenCount = Math.max(0, turnGroupsAll.length - windowSize);
  const turnGroups = hiddenCount > 0 ? turnGroupsAll.slice(hiddenCount) : turnGroupsAll;
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";

  return (
    <div className="relative flex h-full flex-col bg-transparent pb-[env(safe-area-inset-bottom)] text-foreground font-mono text-[length:var(--font-size-base)] leading-[1.618] tracking-[-0.01em]">
      {/* 暖调光晕：静态装饰，衬在消息区后的深空里（仅低透明度，不抢内容） */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[420px]"
        style={{
          background:
            "radial-gradient(640px 320px at 30% 12%, rgba(229,143,103,0.05) 0%, transparent 70%), radial-gradient(520px 280px at 72% 4%, rgba(229,143,103,0.04) 0%, transparent 70%)",
        }}
      />
      {/* Header bar — model name centered, mode toggle right（空状态隐藏，首屏干净如 ZCode） */}
      {!isEmpty && (
      <div className="relative z-10 hidden items-center justify-between gap-2 border-b border-[#DEDEDE] bg-background/40 px-3.5 py-2 text-xs backdrop-blur-sm dark:border-[#333333] md:flex">
        {/* 左侧：会话标题 + 项目/分支上下文 chips（ZCode 式顶栏） */}
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="max-w-[180px] truncate text-[13px] font-medium text-zinc-200"
            title={title || "新会话"}
          >
            {title || "新会话"}
          </span>
          <div className="relative shrink-0" ref={moreMenuRef}>
            <button
              onClick={() => setMoreMenuOpen((v) => !v)}
              className="touch-target rounded px-1.5 py-1 text-[#8C8C8C] hover:bg-[#F0F0F0] hover:text-[#262626] dark:text-zinc-500 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200"
              title="更多"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {moreMenuOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-[#DEDEDE] bg-white shadow-xl shadow-black/10 dark:border-[#333333] glass-surface dark:shadow-black/40">
                <button
                  onClick={async () => {
                    setMoreMenuOpen(false);
                    const t = await promptDialog({ title: "重命名会话", input: { initial: title || "新会话", maxLength: 60 } });
                    if (t?.trim()) void renameSession(sessionId, t.trim());
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[length:var(--font-size-ui-sm)] text-[#383838] transition-colors hover:bg-[#F5F5F5] dark:text-zinc-300 dark:hover:bg-[#262626]"
                >
                  <Pencil className="h-3.5 w-3.5" /> 重命名会话
                </button>
                <button
                  onClick={() => {
                    setMoreMenuOpen(false);
                    handleSlashCommand("/export json");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[length:var(--font-size-ui-sm)] text-[#383838] transition-colors hover:bg-[#F5F5F5] dark:text-zinc-300 dark:hover:bg-[#262626]"
                >
                  <Download className="h-3.5 w-3.5" /> 导出 JSON
                </button>
                <button
                  onClick={() => {
                    setMoreMenuOpen(false);
                    reset();
                  }}
                  className="flex w-full items-center gap-2 border-t border-[#DEDEDE] px-3 py-2 text-left text-[length:var(--font-size-ui-sm)] text-[#E54D2E] transition-colors hover:bg-[#F5F5F5] dark:border-[#333333] dark:hover:bg-[#262626]"
                >
                  <Trash2 className="h-3.5 w-3.5" /> 清空会话
                </button>
              </div>
            )}
          </div>
        </div>
        {/* 右侧：文件袋 / 进度 / 导出 / Payload / 清空 / Stop */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() =>
              useVfsView.getState().setRightPanelOpen(!useVfsView.getState().rightPanelOpen)
            }
            className="touch-target rounded px-2.5 py-1.5 text-[#8C8C8C] hover:bg-[#F0F0F0] hover:text-[#262626] dark:text-zinc-500 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200"
            title="打开 / 收起文件袋"
          >
            <PanelRight className="h-3.5 w-3.5" />
          </button>
          {/* Plan progress indicator — click opens the Plan tab in the right panel */}
          <PlanHeaderBadge />
          <button
            onClick={() => handleSlashCommand("/export json")}
            className="touch-target rounded px-2.5 py-1.5 text-[#8C8C8C] hover:bg-[#F0F0F0] hover:text-[#262626] dark:text-zinc-500 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200"
            title="Export session as JSON"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          {/* Payload 查看器 — 图形入口（命令 /inspect 仍可用） */}
          <button
            onClick={() => {
              const hasPayload = useSession.getState().lastSentPayload?.length;
              if (!hasPayload) {
                toast.info("还没有可查看的上下文——先发一条消息给 AI，再打开这里。");
                return;
              }
              setPayloadOpen(true);
            }}
            className="touch-target rounded px-2.5 py-1.5 text-[#8C8C8C] hover:bg-[#F0F0F0] hover:text-[#262626] dark:text-zinc-500 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200"
            title="查看/编辑发送给 AI 的上下文"
          >
            <ScrollText className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={reset}
            className="touch-target rounded px-2.5 py-1.5 text-[#8C8C8C] hover:bg-[#F0F0F0] hover:text-[#262626] dark:text-zinc-500 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200"
            title="Clear session"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {isStreaming && (
            <button
              onClick={abort}
              className="touch-target flex items-center gap-1 rounded bg-[#E54D2E]/10 px-3 py-1.5 text-[#E54D2E] transition-transform duration-100 hover:bg-[#E54D2E]/10 active:scale-95"
              title="Stop"
            >
              <Square className="h-3 w-3 fill-current" />
              <span>Stop</span>
            </button>
          )}
        </div>
      </div>
      )}

      {/* Events stream */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 overflow-y-auto px-4 py-4 sm:px-6 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D4D4D4] [&::-webkit-scrollbar-track]:bg-transparent"
      >
        {/* 居中限宽列：对话内容与输入框同宽对齐（ZCode 式） */}
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {hiddenCount > 0 && (
            <button
              onClick={() => setWindowSize((w) => w + RENDER_WINDOW)}
              className="mx-auto block rounded-md border border-[#E0E0E0] px-3 py-1 text-xs text-[#8C8C8C] transition-colors hover:bg-[#F5F5F5] dark:border-[#333333] dark:text-zinc-500 dark:hover:bg-[#1F1F1F]"
            >
              ↑ 展开更早的 {hiddenCount} 条消息
            </button>
          )}
          {turnGroups.map((ev) =>
            ev.kind === "round" ? (
              <RoundBlock
                key={ev.id}
                round={ev}
                streaming={isStreaming}
                ctxPct={ctxPct}
                canRegenerate={ev.summary?.id === lastAssistantEventId}
                fullText={ev.summary ? assistantTurnTexts.get(ev.summary.id) : undefined}
              />
            ) : (
              <EventRow
                key={ev.id}
                ev={ev}
                pairedResult={ev.pairedResult}
                canRegenerate={ev.kind === "assistant-message" && ev.id === lastAssistantEventId}
                fullText={ev.kind === "assistant-message" ? assistantTurnTexts.get(ev.id) : undefined}
              />
            ),
          )}
          {/* Live streaming bubble — collapsed "analyzing" card with a single
              preview line. The full text stops scrolling in front of the user;
              once done, events take over and it becomes either a TurnBlock
              (process) or a full assistant message (the answer). */}
          {/* 流式思考：思考中实时显示，结束后由事件里的"思考过程"接管（自动闭合） */}
          {streamingReasoning?.text && (
            <ThinkingStep text={streamingReasoning.text} streaming={true} />
          )}
          {/* 流式输出直接以最终正文形态逐字渲染（不再用"正在分析"占位） */}
          {streamingText?.text && (
            <AssistantRow text={streamingText.text} streaming={true} />
          )}
        </div>
      </div>

      {/* Input — 有对话时是底部限宽列；空状态整体浮到主区正中（Hero，ZCode 式居中命令框） */}
      <div
        className={cn(
          isEmpty
            ? "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 overflow-x-hidden overflow-y-auto px-4 py-4 md:justify-start md:gap-0 md:px-0 md:py-0"
            : "mx-auto w-full max-w-3xl px-4 py-3",
        )}
      >
        {isEmpty && (
          <div className="pointer-events-none relative my-0 flex w-full flex-col items-center px-0 py-1 md:my-auto md:px-4 md:py-10">
            {/* 光晕衬底：logo 与问候语后的暖色雾——深度感来自这里（手机精简，桌面保留） */}
            <div
              aria-hidden
              className="absolute top-1/2 left-1/2 -z-10 hidden h-64 w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full md:block"
              style={{
                background:
                  "radial-gradient(280px 130px at 50% 55%, rgba(229,143,103,0.10) 0%, rgba(229,143,103,0.04) 45%, transparent 75%)",
              }}
            />
            {/* 背景装饰 Logo：超大低透明度几何图形（桌面 ZCode 式；手机移至页级顶栏，此处隐藏避免重复） */}
            <svg viewBox="0 0 200 120" aria-hidden className="hidden text-white opacity-[0.05] md:mb-10 md:block md:h-32 md:w-56">
              <path
                fill="currentColor"
                d="M30 15 L60 15 L124 85 L124 15 L150 15 L150 105 L120 105 L56 35 L56 105 L30 105 Z"
              />
            </svg>
            <div className="mb-4 font-serif text-[15px] font-medium tracking-tight text-zinc-200 [font-variation-settings:'opsz'_40] sm:text-[16px] md:mb-6 md:text-[21px]">
              {greeting}，接下来交给我吧
            </div>
          </div>
        )}
        <div
          className={cn(
            "group relative flex w-full flex-col rounded-[12px] border border-[#DEDEDE] bg-[#FAFAFA] transition-colors hover:border-[#C8C8C8] focus-within:border-[#E58F67]/70 focus-within:shadow-[0_0_0_3px_rgba(229,143,103,0.08)] dark:border-[#333333] dark:bg-[#1A1A1A]/65 dark:backdrop-blur-md dark:hover:border-[#4A4A4A] dark:focus-within:border-[#E58F67]/70 dark:focus-within:shadow-[0_0_0_3px_rgba(229,143,103,0.10),0_0_28px_rgba(229,143,103,0.14)]",
            isEmpty && "pointer-events-auto max-w-3xl",
          )}
        >
          {/* 附件 chips（命令框上方） */}
          {attachments.length > 0 && (
            <div className="absolute bottom-full left-0 mb-2 flex max-w-full flex-wrap gap-1.5">
              {attachments.map((a) => (
                <span
                  key={a.path}
                  className="flex max-w-[180px] items-center gap-1.5 rounded-lg border border-[#DEDEDE] bg-white px-2 py-1 text-[length:var(--font-size-ui-sm)] text-[#383838] dark:border-[#333333] dark:bg-[#161616] dark:text-zinc-200"
                  title={a.fileId ? `已上传 Files API: ${a.fileId}` : a.isImage ? "将以内联 base64 发送" : "写入工作区，AI 可读取"}
                >
                  {a.isImage ? (
                    a.dataUrl ? (
                      <img src={a.dataUrl} alt="" className="h-4 w-4 shrink-0 rounded object-cover" />
                    ) : (
                      <FileText className="h-3 w-3 shrink-0 text-[#C08A5F] dark:text-[#E8A87C]" />
                    )
                  ) : (
                    <FileText className="h-3 w-3 shrink-0 text-[#C08A5F] dark:text-[#E8A87C]" />
                  )}
                  <span className="truncate">{a.name}</span>
                  {a.isImage && a.fileId ? (
                    <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                  ) : null}
                  <button
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== a.path))}
                    className="shrink-0 rounded p-0.5 text-[#A6A6A6] hover:bg-[#F0F0F0] hover:text-[#E54D2E] dark:hover:bg-[#2A2A2A]"
                    title="移除"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {/* 输入区（两层命令框：输入区 + 底栏，占位随内容增高，垂直居中） */}
          <div className="flex min-h-[56px] items-center px-4 py-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={
                isStreaming
                  ? "agent is working…"
                  : isEmpty
                    ? isMobile
                      ? "问 Open Code 任何事 — @ 文件 / / 命令"
                      : "向 Open Code 提问、使用 @ 添加上下文、使用 / 选择命令或能力"
                    : "提出后续修改要求"
              }
              disabled={isStreaming || isCompacting}
              className="max-h-[200px] min-h-[24px] w-full min-w-0 resize-none bg-transparent py-1 text-[length:var(--font-size-base)] text-[#171717] placeholder:text-[#A6A6A6] focus:outline-none disabled:opacity-50 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
          </div>
          {/* /compact 进行中：一行状态 + 滑条（agentStatus 已挂上，这里让它可见） */}
          {isCompacting && (
            <div className="flex items-center gap-2 border-t border-[#DEDEDE] px-3 pt-1.5 pb-1 text-[11px] text-zinc-500 dark:border-[#2E2E2E]">
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#E58F67]" />
              <span className="shrink-0">正在压缩对话历史…</span>
              <span className="relative h-1 min-w-24 flex-1 overflow-hidden rounded-full bg-[#DEDEDE] dark:bg-[#2A2A2A]">
                <span className="absolute inset-y-0 w-1/3 animate-[slide-progress_1.4s_ease-in-out_infinite] rounded-full bg-[#E58F67]/70" />
              </span>
            </div>
          )}
          {/* 三明治 ③ 底部工具栏：附件 / 模式徽标 · 模型 / 思考 / 发送 */}
          <div className="flex items-center justify-between gap-2 border-t border-[#DEDEDE] px-2.5 py-1.5 dark:border-[#2E2E2E]">
            <div className="flex min-w-0 items-center gap-1">
              {/* 附件：+（上传文件） */}
              <button
                onClick={() => attachInputRef.current?.click()}
                disabled={isStreaming || isCompacting || uploading}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8C8C8C] transition-colors hover:bg-[#F0F0F0] hover:text-[#262626] disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-100"
                title={uploading ? "正在上传图片到 Files API…" : "上传文件（图片 / 文本，≤10MB）"}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </button>
              {/* 运行模式 + 执行模式 下拉：橙色盾牌（向上弹出） */}
              <div className="relative" ref={modeMenuRef}>
                <button
                  onClick={() => setModeMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[length:var(--font-size-ui-sm)] font-medium text-zinc-300 transition-colors hover:bg-[#F0F0F0] dark:text-zinc-300 dark:hover:bg-[#2A2A2A]"
                  title="运行模式（完整/精简/极简）+ 执行模式"
                >
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#E58F67] text-white">
                    <Shield className="h-2.5 w-2.5" />
                  </span>
                  <span className="hidden md:inline">{mode === "plan" ? "计划模式" : "完全访问"}</span>
                  <ChevronDown className="hidden h-3 w-3 text-[#8C8C8C] md:block" />
                </button>
                {modeMenuOpen && (
                  <div className="absolute bottom-full left-0 z-50 mb-1.5 w-56 overflow-hidden rounded-xl border border-[#DEDEDE] bg-white shadow-xl shadow-black/10 dark:border-[#333333] glass-surface dark:shadow-black/40">
                    <div className="px-3 py-2 text-[length:var(--font-size-ui-sm)] font-medium text-[#6B6B6B] dark:text-zinc-400">
                      运行模式
                    </div>
                    {([
                      { id: "full" as const, label: "完整", desc: "全部工具 + 完整提示词", icon: Shield },
                      { id: "light" as const, label: "精简", desc: "核心工具 + 精简提示词", icon: Sparkles },
                      { id: "minimal" as const, label: "极简", desc: "仅 4 工具 + 一句话", icon: Zap },
                    ]).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setAgentPreset(p.id);
                          setModeMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                          agentPreset === p.id
                            ? "bg-[#E58F67]/10 text-[#E58F67]"
                            : "text-[#383838] hover:bg-[#F5F5F5] dark:text-zinc-300 dark:hover:bg-[#262626]",
                        )}
                      >
                        <AppIcon icon={p.icon} size={14} className={cn(agentPreset === p.id && "text-[#E58F67]")} />
                        <span className="text-[length:var(--font-size-ui-sm)]">{p.label}</span>
                        <span className="text-[10px] text-[#A6A6A6] dark:text-zinc-500">{p.desc}</span>
                        {agentPreset === p.id && <Check className="ml-auto h-3 w-3 shrink-0" />}
                      </button>
                    ))}
                    <div className="border-t border-[#DEDEDE] px-3 py-2 text-[length:var(--font-size-ui-sm)] font-medium text-[#6B6B6B] dark:border-[#333333] dark:text-zinc-400">
                      执行模式
                    </div>
                    {([
                      { id: "bypass" as const, label: "完全访问", desc: "直接改文件" },
                      { id: "plan" as const, label: "计划模式", desc: "改前先出计划" },
                    ]).map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          if (mode !== m.id) toggleMode();
                          setModeMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                          mode === m.id
                            ? "bg-[#E58F67]/10 text-[#E58F67]"
                            : "text-[#383838] hover:bg-[#F5F5F5] dark:text-zinc-300 dark:hover:bg-[#262626]",
                        )}
                      >
                        <span className="text-[length:var(--font-size-ui-sm)]">{m.label}</span>
                        <span className="text-[10px] text-[#A6A6A6] dark:text-zinc-500">{m.desc}</span>
                        {mode === m.id && <Check className="ml-auto h-3 w-3 shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
              {/* 右侧控件组：模型 / 思考 / 发送 */}
              <div className="flex shrink-0 items-center gap-1">
              {/* 模型选择器：有 Key → 切换下拉；无 Key → 设置入口(红点提示，点击打开设置) */}
              {config.hasApiKey ? (
                <div className="relative" ref={modelMenuRef}>
                  <button
                    onClick={() => setModelMenuOpen((v) => !v)}
                    className="flex max-w-[200px] items-center gap-1.5 rounded-lg px-2 py-1 text-[length:var(--font-size-ui-sm)] text-zinc-300 transition-colors hover:bg-[#F0F0F0] dark:text-zinc-300 dark:hover:bg-[#2A2A2A]"
                    title="切换模型"
                  >
                    <Settings2 className="h-3.5 w-3.5 shrink-0 text-[#8C8C8C]" />
                    <span className="hidden truncate md:block">{config.model}</span>
                    <ChevronDown className="hidden h-3 w-3 shrink-0 text-[#8C8C8C] md:block" />
                  </button>
                  {modelMenuOpen && (
                    <div className="absolute bottom-full left-0 z-50 mb-1.5 max-h-72 w-72 overflow-y-auto rounded-xl border border-[#DEDEDE] bg-white shadow-xl shadow-black/10 dark:border-[#333333] glass-surface dark:shadow-black/40">
                      {headerModelChoices.length === 0 ? (
                        <div className="px-3 py-2 text-[length:var(--font-size-ui-sm)] text-[#A6A6A6] dark:text-zinc-500">
                          暂无模型列表——在设置里点 Test 拉取
                        </div>
                      ) : (
                        <>
                          <div className="border-b border-[#DEDEDE] px-3 py-2 text-[length:var(--font-size-ui-sm)] font-medium text-[#6B6B6B] dark:border-[#333333] dark:text-zinc-400">
                            模型
                          </div>
                          {groupModels(headerModelChoices).map((g) => (
                            <div key={g.provider}>
                              <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[#A6A6A6] dark:text-zinc-500">
                                {g.provider}
                              </div>
                              {g.models.map((m) => (
                                <button
                                  key={m}
                                  onClick={() => {
                                    const visionLike = /vision|gpt-4o|gemini|claude/i.test(m);
                                    setConfig(visionLike ? { model: m, supportVision: true } : { model: m });
                                    setModelMenuOpen(false);
                                    toast.success(`模型已切换为 ${m}`);
                                  }}
                                  className={`flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[length:var(--font-size-ui-sm)] transition-colors ${
                                    m === config.model
                                      ? "bg-[#E58F67]/10 text-[#E58F67]"
                                      : "text-[#383838] hover:bg-[#F5F5F5] dark:text-zinc-300 dark:hover:bg-[#262626]"
                                  }`}
                                >
                                  <span className="min-w-0 flex-1 truncate">{m}</span>
                                  {m === config.model && <Check className="h-3 w-3 shrink-0" />}
                                </button>
                              ))}
                            </div>
                          ))}
                          <button
                            onClick={() => {
                              setModelMenuOpen(false);
                              toast.info("请到设置面板管理模型与 API Key");
                            }}
                            className="flex w-full items-center gap-2 border-t border-[#DEDEDE] px-3 py-2 text-left text-[length:var(--font-size-ui-sm)] text-[#C08A5F] transition-colors hover:bg-[#F5F5F5] dark:border-[#333333] dark:text-[#E8A87C] dark:hover:bg-[#262626]"
                          >
                            <AppIcon icon={Wrench} size={14} />
                            <span>管理模型</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent("open-settings"))}
                  className="relative flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg px-2 text-[length:var(--font-size-ui-sm)] text-[#C08A5F] transition-colors hover:bg-[#F0F0F0] dark:text-[#E8A87C] dark:hover:bg-[#2A2A2A] md:h-auto md:justify-start"
                  title="未配置 API Key — 点此打开设置"
                >
                  <Settings2 className="h-3.5 w-3.5 shrink-0 text-[#C08A5F] dark:text-[#E8A87C]" />
                  <span className="hidden md:inline">设置模型</span>
                  <span aria-hidden className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-[#E54D2E]" />
                </button>
              )}
              {/* 思考强度 下拉：关闭 / 低 / 高 / 超高 */}
              <div className="relative" ref={effortMenuRef}>
                <button
                  onClick={() => setEffortMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[length:var(--font-size-ui-sm)] text-zinc-300 transition-colors hover:bg-[#F0F0F0] dark:text-zinc-300 dark:hover:bg-[#2A2A2A]"
                  title="思考强度"
                >
                  <Zap className="h-3.5 w-3.5 text-[#8C8C8C]" />
                  <span className="hidden md:block">
                    {!config.thinkingEnabled
                      ? "关闭"
                      : config.reasoningEffort === "low"
                        ? "低"
                        : config.reasoningEffort === "max"
                          ? "超高"
                          : "高"}
                  </span>
                  <ChevronDown className="hidden h-3 w-3 text-[#8C8C8C] md:block" />
                </button>
                {effortMenuOpen && (
                  <div className="absolute bottom-full left-0 z-50 mb-1.5 w-44 overflow-hidden rounded-xl border border-[#DEDEDE] bg-white shadow-xl shadow-black/10 dark:border-[#333333] glass-surface dark:shadow-black/40">
                    {([
                      { id: "off" as const, label: "关闭", desc: "不启用思考" },
                      { id: "low" as const, label: "低", desc: "更快，更省 token" },
                      { id: "high" as const, label: "高", desc: "均衡" },
                      { id: "max" as const, label: "超高", desc: "最强推理" },
                    ]).map((e) => {
                      const selected =
                        e.id === "off"
                          ? !config.thinkingEnabled
                          : config.thinkingEnabled && config.reasoningEffort === e.id;
                      return (
                        <button
                          key={e.id}
                          onClick={() => {
                            if (e.id === "off") setConfig({ thinkingEnabled: false });
                            else setConfig({ thinkingEnabled: true, reasoningEffort: e.id });
                            setEffortMenuOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                            selected
                              ? "bg-[#E58F67]/10 text-[#E58F67]"
                              : "text-[#383838] hover:bg-[#F5F5F5] dark:text-zinc-300 dark:hover:bg-[#262626]",
                          )}
                        >
                          <span className="text-[length:var(--font-size-ui-sm)]">{e.label}</span>
                          <span className="text-[10px] text-[#A6A6A6] dark:text-zinc-500">{e.desc}</span>
                          {selected && <Check className="ml-auto h-3 w-3 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* 分词器 WASM 状态微标：把「后台加载」变成看得见的一次性状态。
                  手机：仅一个圆点(绿=就绪 / 红=失败 / 橙闪=加载中)，点击可重试；
                  桌面：圆点 + 文字标签。 */}
              <button
                onClick={() => {
                  if (tokStatus !== "ready") warmup();
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-[#F0F0F0] dark:hover:bg-[#2A2A2A] md:h-auto md:w-auto md:gap-1 md:rounded md:px-1.5 md:py-0.5 md:text-[10px] md:text-zinc-600 md:hover:text-zinc-400"
                title={
                  tokStatus === "ready"
                    ? "DeepSeek 真分词器已就绪（128k BPE）"
                    : tokStatus === "failed"
                      ? "分词器加载失败 · 点击重试（当前按字符估算）"
                      : "分词器预热中…（就绪后计数自动精确）"
                }
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    tokStatus === "ready"
                      ? "bg-emerald-500"
                      : tokStatus === "failed"
                        ? "bg-[#E54D2E]"
                        : "animate-pulse bg-[#E58F67]",
                  )}
                />
                <span className="hidden md:inline">
                  {tokStatus === "ready"
                    ? "分词器就绪"
                    : tokStatus === "failed"
                      ? "分词器失败"
                      : "分词器待命…"}
                </span>
              </button>
              {/* token 面板 Σ：手机底栏的统计入口（ZCode 同款位） */}
              {totalTokens > 0 && (
                <button
                  onClick={() => setTokenSheetOpen(true)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8C8C8C] transition-colors hover:bg-[#F0F0F0] hover:text-[#262626] disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-100"
                  title={`Token 面板（累计 ${totalTokens.toLocaleString()}）`}
                >
                  <Sigma className="h-4 w-4" />
                </button>
              )}
              {/* 文件袋：打开右侧工作区面板（箱包位） */}
              <button
                onClick={() => setRightPanelOpen(!rightPanelOpen)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8C8C8C] transition-colors hover:bg-[#F0F0F0] hover:text-[#262626] disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-100"
                title="文件袋（工作区）"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
              {/* 实时输入计数徽标（Hero 与对话态同框生效） */}
              {liveTokens > 0 && (
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-500"
                  title="输入 + 附件 token 估算（真分词器就绪时精确计数）"
                >
                  ≈{liveTokens.toLocaleString()}
                </span>
              )}
              {/* 发送 */}
              <button
                onClick={submit}
                disabled={(!input.trim() && attachments.length === 0) || isStreaming || isCompacting}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2E2E2E] text-zinc-200 transition-colors hover:bg-[#3A3A3A] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#2E2E2E] dark:hover:bg-[#3A3A3A] dark:text-zinc-200"
                title="Send (Enter)"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              </div>
          </div>
          <input
            ref={attachInputRef}
            type="file"
            multiple
            accept="*/*"
            className="hidden"
            onChange={(e) => {
              void handleAttach(e.target.files);
              e.target.value = "";
            }}
          />
          {/* @mention autocomplete dropdown */}
          {mentionQuery !== null && mentionFiles.length > 0 && (
            <div className="absolute bottom-full left-0 mb-2 w-72 overflow-hidden rounded-xl border border-[#DEDEDE] bg-white shadow-xl shadow-black/10 dark:border-[#333333] glass-surface dark:shadow-black/40">
              {mentionFiles.map((f, i) => (
                <button
                  key={f.path}
                  onClick={() => insertMention(f.path)}
                  onMouseEnter={() => setMentionIndex(i)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
                    i === mentionIndex ? "bg-[#E58F67]/10 text-[#E58F67]" : "text-[#383838] hover:bg-[#F5F5F5] dark:text-zinc-300 dark:hover:bg-[#262626]",
                  )}
                >
                  <FileTypeIcon path={f.path} className="h-3 w-3 shrink-0 text-[#C08A5F] dark:text-[#E8A87C]" />
                  <span className="truncate">{f.path}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {isEmpty && (
          <div className="pointer-events-auto mt-5 flex w-full flex-col items-center">
            {/* 手机：快捷任务纵向条目（图标 + 文案，可两行不截断；ZCode 式建议区） */}
            <div className="flex w-full flex-col gap-1.5 px-0 md:hidden">
              {HOME_SUGGESTIONS.map((s) => (
                <button
                  key={s.text}
                  onClick={() => fillPrompt(s.text)}
                  className="flex w-full items-center gap-2 rounded-lg border border-[#DEDEDE] bg-[#161616]/30 px-3 py-2 text-left text-[12px] leading-snug text-zinc-400 transition-colors hover:border-[#4A4A4A] hover:text-zinc-200 dark:border-[#333333]"
                >
                  <s.icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <span className="min-w-0">{s.text}</span>
                </button>
              ))}
            </div>
            {/* 建议区：三条可点击快捷任务（与输入框同宽对齐，ZCode 式） */}
            <div className="hidden w-full max-w-3xl space-y-1 md:block">
              {HOME_SUGGESTIONS.map((s) => (
                <button
                  key={s.text}
                  onClick={() => fillPrompt(s.text)}
                  className="flex w-full items-start gap-2.5 rounded-lg px-3 py-1.5 text-left text-[13px] text-zinc-300 transition-colors hover:bg-white/5 hover:text-zinc-100"
                >
                  <s.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
            {/* 订阅提示 */}
            <div className="mt-10 hidden items-center justify-center gap-1.5 text-[13px] text-zinc-500 md:flex">
              <Bell className="h-3.5 w-3.5 shrink-0" />
              <span>订阅用户新功能体验：创建“闲时任务”，我们将免费在算力富余时段为你完成指派任务。</span>
            </div>
            {/* 功能卡片：Git 站会摘要 / CI 报告 / 自定义（ZCode 式，桌面） */}
            <div className="mt-6 hidden w-full max-w-[1080px] grid-cols-3 gap-4 md:grid">
              {HOME_CARDS.map((c) => (
                <button
                  key={c.title}
                  onClick={() => (c.prompt ? fillPrompt(c.prompt) : textareaRef.current?.focus())}
                  className="rounded-[10px] border border-[#DEDEDE] bg-[#FAFAFA] px-4 py-3.5 text-left transition-colors hover:border-[#C8C8C8] dark:border-[#333333] dark:bg-[#161616] dark:hover:border-[#4A4A4A]"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#DEDEDE] dark:border-[#3A3A3A]">
                    <c.icon className="h-3.5 w-3.5 text-zinc-300" />
                  </span>
                  <div className="mt-2.5 text-sm text-zinc-200">{c.title}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">{c.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        {!isEmpty && (
        <div className="mt-2 hidden items-center justify-between px-1 text-[length:var(--font-size-ui-sm)] text-[#A6A6A6] dark:text-zinc-500 md:flex">
          <span className="flex items-center gap-3">
            {totalTokens > 0 && (
              <button
                onClick={() => setTokenSheetOpen(true)}
                title={`本会话累计 ${totalTokens.toLocaleString()} tokens · 点击查看 Token 面板`}
                className="cursor-pointer rounded px-1 py-0.5 transition-colors hover:bg-[#F0F0F0] hover:text-[#262626] dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200"
              >
                累计 {totalTokens.toLocaleString()}
              </button>
            )}
            {lastUsage && (
              <button
                onClick={() => setTokenSheetOpen(true)}
                title={`上次请求 ${lastUsage.prompt_tokens.toLocaleString()} prompt + ${lastUsage.completion_tokens.toLocaleString()} completion（账单口径）· 点击查看 Token 面板`}
                className="cursor-pointer rounded px-1 py-0.5 transition-colors hover:bg-[#F0F0F0] hover:text-[#262626] dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200"
              >
                本轮 {lastUsage.total_tokens.toLocaleString()}
              </button>
            )}
            {isStreaming && (
              <span className="flex items-center gap-1.5">
                <span>step</span>
                <span className="font-mono text-[#6B6B6B] dark:text-zinc-500">{agentIteration}</span>
                <span className="inline-block h-1 w-16 overflow-hidden rounded-full bg-zinc-800">
                  <span
                    className="block h-full w-1/3 animate-pulse rounded-full bg-[#E58F67]"
                    style={{
                      animation: "slide-progress 1.5s ease-in-out infinite",
                    }}
                  />
                </span>
              </span>
            )}
          </span>
          <span className="opacity-80">Enter 发送 · Shift+Tab 切换模式 · /help</span>
        </div>
        )}
      </div>

      {/* 弹窗/浮层 — 挂在根级，不随布局状态移动 */}
      {/* Question modal — fixed overlay, appears as soon as AI calls ask_user_input */}
      {pendingQuestions && (
        <QuestionModal
          panel={pendingQuestions}
          onCancel={() => {
            setPendingQuestions(null);
            void send("[用户跳过了这些提问，未作答。请基于已有信息继续，或换一种方式推进。]");
          }}
          onSubmit={(answers) => {
            const answersText =
              `[用户回答 (${pendingQuestions.request_id})]:\n` +
              Object.entries(answers)
                .map(([qId, val]) => {
                  const q = pendingQuestions.questions.find((q) => q.id === qId);
                  const label = q ? q.question : qId;
                  // 选项 id → label：让 AI 看到用户选的真实选项内容，而非随机 opt_xxx id。
                  const resolve = (oid: string): string => {
                    if (!q) return oid;
                    return q.options.find((o) => o.id === oid)?.label ?? oid;
                  };
                  const value = Array.isArray(val)
                    ? val.map(resolve).join(", ")
                    : resolve(val);
                  return `- ${label}: ${value}`;
                })
                .join("\n");
            setPendingQuestions(null);
            send(answersText);
          }}
        />
      )}

      {/* Zip tool bridges — download (zip_archive) + file picker (unzip_archive) */}
      <ZipDownloadBridge />
      <ZipPickerModal />

      {/* Payload inspector — 查看/编辑上次发送给 AI 的完整上下文（/inspect 打开） */}
      <PayloadInspector open={payloadOpen} onClose={() => setPayloadOpen(false)} />

      {/* Token 用量面板 — 右侧滑出（输入区 token 计数 / /tokens 命令打开） */}
      <TokenSheet open={tokenSheetOpen} onClose={() => setTokenSheetOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event rows — one component per EventKind
// ---------------------------------------------------------------------------

function EventRow({
  ev,
  pairedResult,
  canRegenerate,
  fullText,
}: {
  ev: SessionEvent;
  pairedResult?: SessionEvent;
  canRegenerate?: boolean;
  fullText?: string;
}) {
  switch (ev.kind) {
    case "user":
      return <UserRow text={ev.text ?? ""} attachments={ev.attachments} eventId={ev.id} />;
    case "assistant-message":
      return (
        <AssistantRow
          text={ev.text ?? ""}
          reasoning={ev.reasoning}
          streaming={false}
          ts={ev.ts}
          canRegenerate={canRegenerate}
          fullText={fullText}
          durationMs={ev.durationMs}
        />
      );
    case "tool-call":
      // dispatch_subagent → 专用「子智能体」卡片（运行中 / 完成态都长这样），
      // 点击跳右侧栏子智能体面板查看委派提示词与最终回复。
      if (ev.toolName === "dispatch_subagent") {
        return (
          <SubagentCard
            eventId={ev.id}
            task={typeof ev.toolArgs?.task === "string" ? ev.toolArgs.task : ""}
            running={!pairedResult}
          />
        );
      }
      // Merged card: tool-call + its matching tool-result
      if (pairedResult) {
        return (
          <StepCard name={ev.toolName!} args={ev.toolArgs ?? {}} result={pairedResult} />
        );
      }
      // Standalone tool-call (result not yet available) → 运行中
      return <StepCard name={ev.toolName!} args={ev.toolArgs ?? {}} result={null} />;
    case "tool-result":
      return <StepCard name={ev.toolName!} args={ev.toolArgs ?? {}} result={ev} />;
    case "error":
      return <ErrorRow text={ev.text ?? ""} />;
    case "system":
      return <SystemRow text={ev.text ?? ""} />;
    default:
      return null;
  }
}

function groupModels(models: string[]): { provider: string; models: string[] }[] {
  const order: string[] = [];
  const map = new Map<string, string[]>();
  for (const m of models) {
    const provider = m.includes("/") ? m.split("/")[0].trim() : "其他";
    if (!map.has(provider)) {
      map.set(provider, []);
      order.push(provider);
    }
    map.get(provider)!.push(m);
  }
  return order.map((p) => ({ provider: p, models: map.get(p)! }));
}

