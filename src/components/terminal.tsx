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

import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowUp,
  Copy,
  Download,
  Loader2,
  Square,
  Trash2,
  ChevronRight,
  FileText,
  Terminal as TerminalIcon,
  Check,
  CheckCircle2,
  XCircle,
  Wrench,
  Sparkles,
  Gauge,
  ScrollText,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import mermaid from "mermaid";

// 项目强制深色模式（<html className="dark">），用 dark 主题否则浅色线条
// 在深色背景上看不清。themeVariables 微调让文字/线条对比更清晰。
mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  themeVariables: {
    // 与整体 #D97757 主色呼应的强调色；其余用 dark 主题默认值。
    primaryColor: "#2a2723",
    primaryTextColor: "#e4e4e7",
    lineColor: "#a1a1aa",
  },
});
import type { Components } from "react-markdown";
import Prism from "prismjs";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-css";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-python";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";
import { useSession, type SessionEvent, type QuestionPanelData } from "@/store/session";
import { buildHelpText } from "@/lib/help-content";
import { useVfsView } from "@/store/vfs-view";
import { vfs } from "@/lib/vfs";
import { toast } from "sonner";
import { ZipDownloadBridge, ZipPickerModal } from "./zip-picker";
import { PayloadInspector } from "./payload-inspector";
import { TokenSheet } from "./token-sheet";
import { cn } from "@/lib/utils";
import { planStats } from "@/lib/plan-utils";
import { CollapsibleText } from "./collapsible-text";

export function Terminal() {
  const events = useSession((s) => s.events);
  const isStreaming = useSession((s) => s.isStreaming);
  const isCompacting = useSession((s) => s.isCompacting);
  const agentStatus = useSession((s) => s.agentStatus);
  const agentIteration = useSession((s) => s.agentIteration);
  const agentMaxIterations = useSession((s) => s.agentMaxIterations);
  const totalTokens = useSession((s) => s.totalTokens);
  const compactedReleases = useSession((s) => s.compactedReleases ?? 0);
  const compactCount = useSession((s) => s.compactCount ?? 0);
  const lastUsage = useSession((s) => s.lastUsage);
  const config = useSession((s) => s.config);
  const setConfig = useSession((s) => s.setConfig);
  const mode = useSession((s) => s.mode);
  const toggleMode = useSession((s) => s.toggleMode);
  const streamingText = useSession((s) => s.streamingText);
  const streamingReasoning = useSession((s) => s.streamingReasoning);
  const send = useSession((s) => s.send);
  const abort = useSession((s) => s.abort);
  const reset = useSession((s) => s.reset);
  const pendingQuestions = useSession((s) => s.pendingQuestions);
  const setPendingQuestions = useSession((s) => s.setPendingQuestions);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  // @mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  // Payload inspector modal (查看/编辑上次发送给 AI 的完整上下文)
  const [payloadOpen, setPayloadOpen] = useState(false);
  // Token usage sheet (右侧滑出)
  const [tokenSheetOpen, setTokenSheetOpen] = useState(false);

  // Auto-scroll to bottom on new events when user is near the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (autoScroll) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events, streamingText, streamingReasoning, autoScroll]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  };

  const submit = () => {
    if (!input.trim() || isStreaming) return;
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

    void send(text);
  };

  /** Replace @path/to/file mentions with inline file content. */
  const processMentions = (text: string): string => {
    return text.replace(/@([\w./_-]+[\w.-]+)/g, (match, filePath) => {
      const content = vfs.readFileSync(filePath);
      if (content === null) return match; // leave as-is if not found
      const ext = filePath.split(".").pop() ?? "";
      const lineCount = content.split("\n").length;
      // Truncate very large files to first 200 lines
      const truncated = lineCount > 200
        ? content.split("\n").slice(0, 200).join("\n") + `\n... (${lineCount - 200} more lines, use read_file to see full content)`
        : content;
      return `\n\n<file path="${filePath}">\n\`\`\`${ext}\n${truncated}\n\`\`\`\n</file>\n\n`;
    });
  };

  /** Detect @mention in the current input and return matching files. */
  const mentionFiles = mentionQuery
    ? vfs.listAllFilesSync("").filter((f) =>
        f.path.toLowerCase().includes(mentionQuery.toLowerCase()),
      ).slice(0, 8)
    : [];

  const onInputChange = (val: string) => {
    setInput(val);
    // Detect @mention: look for @ followed by non-space chars at cursor position
    const cursorPos = textareaRef.current?.selectionStart ?? val.length;
    const beforeCursor = val.substring(0, cursorPos);
    const atMatch = beforeCursor.match(/@([\w./_-]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  const insertMention = (filePath: string) => {
    const cursorPos = textareaRef.current?.selectionStart ?? input.length;
    const beforeCursor = input.substring(0, cursorPos);
    const afterCursor = input.substring(cursorPos);
    // Replace @query with @filePath
    const newBefore = beforeCursor.replace(/@[\w./_-]*$/, `@${filePath} `);
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

      case "tokens":
        pushSystem(
          lastUsage
            ? [
                `Tokens used this session: ${totalTokens.toLocaleString()} total (real API usage)`,
                `  • Last request: ${lastUsage.prompt_tokens.toLocaleString()} prompt + ${lastUsage.completion_tokens.toLocaleString()} completion = ${lastUsage.total_tokens.toLocaleString()} total`,
                `  • Compaction: ${compactCount} time(s), cumulatively released ~${(compactedReleases / 1000).toFixed(1)}K token`,
                `  • Context budget: ~60,000 tokens (auto-truncates when exceeded)`,
              ].join("\n")
            : [
                `Tokens used this session: ${totalTokens.toLocaleString()} total (real API usage)`,
                `  • No usage data yet — send a message to the AI.`,
                compactCount > 0
                  ? `  • Compaction: ${compactCount} time(s), cumulatively released ~${(compactedReleases / 1000).toFixed(1)}K token`
                  : `  • No compaction yet — type /compact to collapse old context into a summary`,
                `  • Context budget: ~60,000 tokens (auto-truncates when exceeded)`,
              ].join("\n"),
        );
        break;

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
        // Rough cost estimates per 1M tokens (USD). User can adjust mentally.
        const RATES: Record<string, { in: number; out: number }> = {
          "gpt-4o": { in: 2.5, out: 10 },
          "gpt-4o-mini": { in: 0.15, out: 0.6 },
          "gpt-4.1": { in: 2, out: 8 },
          "gpt-4.1-mini": { in: 0.4, out: 1.6 },
          "deepseek-v4-flash": { in: 0.27, out: 1.1 },
          "deepseek-v4-pro": { in: 0.55, out: 2.19 },
          "claude-3-5-sonnet": { in: 3, out: 15 },
          "claude-3-5-haiku": { in: 0.8, out: 4 },
        };
        // Sort by length descending so "gpt-4o-mini" matches before "gpt-4o".
        const modelKey = Object.keys(RATES)
          .sort((a, b) => b.length - a.length)
          .find((k) => config.model.toLowerCase().includes(k.toLowerCase()));
        if (!modelKey) {
          pushSystem(
            `Session tokens: ${totalTokens.toLocaleString()} total.\n` +
              `No cost estimate available for model "${config.model}".\n` +
              `Add its pricing to the /cost rate table in terminal.tsx if needed.`,
          );
          break;
        }
        const rate = RATES[modelKey];
        // Approximate split: assume 80% prompt, 20% completion (rough).
        const promptTok = Math.round(totalTokens * 0.8);
        const completionTok = totalTokens - promptTok;
        const costIn = (promptTok / 1_000_000) * rate.in;
        const costOut = (completionTok / 1_000_000) * rate.out;
        const costTotal = costIn + costOut;
        pushSystem(
          `Estimated cost for "${config.model}":\n` +
            `  • Tokens: ${totalTokens.toLocaleString()} total (~${promptTok.toLocaleString()} prompt + ~${completionTok.toLocaleString()} completion)\n` +
            `  • Rate: $${rate.in}/M input, $${rate.out}/M output\n` +
            `  • Cost: $${costTotal.toFixed(4)} (≈ $${(costTotal * 100).toFixed(2)} cents)\n` +
            `Note: split is estimated 80/20. Real split from lastUsage: ` +
            (lastUsage
              ? `${lastUsage.prompt_tokens.toLocaleString()} prompt + ${lastUsage.completion_tokens.toLocaleString()} completion`
              : "n/a"),
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
      toggleMode();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground font-mono text-[length:var(--font-size-base)] leading-relaxed">
      {/* Header bar — model name centered, mode toggle right */}
      <div className="flex items-center justify-between border-b border-[#E5E2D9] px-4 py-2.5 text-xs dark:border-[#3a3731]">
        <div className="flex items-center gap-2 text-[#6B6862] dark:text-zinc-400">
          {config.hasApiKey && (
            <span className="flex items-center gap-1.5 rounded-md bg-[#F5F3EE] px-3 py-1.5 text-[length:var(--font-size-ui-sm)] font-medium text-[#8B7355] dark:bg-[#262320] dark:text-[#E8A87C]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#D97757]" />
              {config.model}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Mode toggle — Claude Code style */}
          <button
            onClick={toggleMode}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[length:var(--font-size-ui-sm)] font-medium transition-colors",
              mode === "plan"
                ? "border-[#D97757]/30 bg-[#D97757]/10 text-[#D97757]"
                : "border-[#E5E2D9] bg-[#F5F3EE] text-[#8B8884] hover:text-[#2D2B27] dark:border-[#3a3731] dark:bg-[#262320] dark:text-zinc-500 dark:hover:text-zinc-200",
            )}
            title="Shift+Tab to toggle"
          >
            {mode === "plan" ? "📋 Plan" : "⚡ Bypass"}
          </button>
              {/* Plan progress indicator — click opens the Plan tab in the right panel */}
          <PlanHeaderBadge />
          <button
            onClick={() => handleSlashCommand("/export json")}
            className="touch-target rounded px-2.5 py-1.5 text-[#8B8884] hover:bg-[#F0EDE5] hover:text-[#2D2B27] dark:text-zinc-500 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
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
            className="touch-target rounded px-2.5 py-1.5 text-[#8B8884] hover:bg-[#F0EDE5] hover:text-[#2D2B27] dark:text-zinc-500 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
            title="查看/编辑发送给 AI 的上下文"
          >
            <ScrollText className="h-3.5 w-3.5" />
          </button>
          {/* Token 用量面板 — 图形入口（命令 /tokens 仍可用） */}
          <button
            onClick={() => setTokenSheetOpen(true)}
            className="touch-target rounded px-2.5 py-1.5 text-[#8B8884] hover:bg-[#F0EDE5] hover:text-[#2D2B27] dark:text-zinc-500 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
            title="Token 用量面板"
          >
            <Gauge className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={reset}
            className="touch-target rounded px-2.5 py-1.5 text-[#8B8884] hover:bg-[#F0EDE5] hover:text-[#2D2B27] dark:text-zinc-500 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
            title="Clear session"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {isStreaming && (
            <button
              onClick={abort}
              className="touch-target flex items-center gap-1 rounded bg-[#E54D2E]/10 px-3 py-1.5 text-[#E54D2E] hover:bg-[#E54D2E]/10"
              title="Stop"
            >
              <Square className="h-3 w-3 fill-current" />
              <span>Stop</span>
            </button>
          )}
        </div>
      </div>

      {/* Events stream */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE] [&::-webkit-scrollbar-track]:bg-transparent"
      >
        {events.length === 0 && !streamingText && !streamingReasoning && <EmptyState />}
        <div className="space-y-4">
          {useMemo(() => groupAssistantTurns(groupToolEvents(events)), [events]).map((ev) =>
            ev.kind === "turn" ? (
              <TurnBlock key={ev.id} turn={ev} />
            ) : (
              <EventRow key={ev.id} ev={ev} pairedResult={ev.pairedResult} />
            ),
          )}
          {/* Live streaming bubble — collapsed "analyzing" card with a single
              preview line. The full text stops scrolling in front of the user;
              once done, events take over and it becomes either a TurnBlock
              (process) or a full assistant message (the answer). */}
          {(streamingText?.text || streamingReasoning?.text) && (
            <StreamingBubble
              text={streamingText?.text ?? ""}
              reasoning={streamingReasoning?.text ?? ""}
            />
          )}
          {(isStreaming || isCompacting) && (
            <AgentStatusRow status={agentStatus} />
          )}
        </div>

          {/* Question modal — fixed overlay, appears as soon as AI calls ask_user_input */}
          {pendingQuestions && (
            <QuestionModal
              panel={pendingQuestions}
              onSubmit={(answers) => {
                const answersText =
                  `[用户回答 (${pendingQuestions.request_id})]:\n` +
                  Object.entries(answers)
                    .map(([qId, val]) => {
                      const q = pendingQuestions.questions.find((q) => q.id === qId);
                      const label = q ? q.question : qId;
                      const value = Array.isArray(val) ? val.join(", ") : val;
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

          {/* Token 用量面板 — 右侧滑出（header Gauge 按钮 / 输入区 token 计数打开） */}
          <TokenSheet open={tokenSheetOpen} onClose={() => setTokenSheetOpen(false)} />
      </div>

      {/* Input */}
      {/* Input area — clean, minimal */}
      <div className="border-t border-[#E5E2D9] bg-[#FFFFFF] px-4 py-3 dark:border-[#3a3731] dark:bg-[#161512]">
        <div className="relative flex items-end gap-2.5 rounded-xl border border-[#E5E2D9] bg-[#FAF9F7] px-4 py-3 transition-colors focus-within:border-[#D97757]/40 dark:border-[#3a3731] dark:bg-[#1c1a17]">
          {/* @mention autocomplete dropdown */}
          {mentionQuery !== null && mentionFiles.length > 0 && (
            <div className="absolute bottom-full left-0 mb-2 w-72 overflow-hidden rounded-lg border border-[#E5E2D9] bg-white shadow-lg dark:border-[#3a3731] dark:bg-[#1c1a17]">
              {mentionFiles.map((f, i) => (
                <button
                  key={f.path}
                  onClick={() => insertMention(f.path)}
                  onMouseEnter={() => setMentionIndex(i)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs",
                    i === mentionIndex ? "bg-[#D97757]/8 text-[#D97757]" : "text-[#3D3B37] hover:bg-[#F5F3EE] dark:text-zinc-300 dark:hover:bg-[#262320]",
                  )}
                >
                  <FileText className="h-3 w-3 shrink-0 text-[#8B7355] dark:text-[#E8A87C]" />
                  <span className="truncate">{f.path}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              isStreaming
                ? "agent is working…"
                : "输入消息…  (@ 提及文件)"
            }
            disabled={isStreaming || isCompacting}
            className="max-h-[200px] flex-1 resize-none bg-transparent text-[length:var(--font-size-base)] text-[#1A1815] placeholder:text-[#A8A29E] focus:outline-none disabled:opacity-50 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <button
            onClick={submit}
            disabled={!input.trim() || isStreaming || isCompacting}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#D97757] text-white transition-colors hover:bg-[#C66B4A] disabled:cursor-not-allowed disabled:bg-[#D6D3CE] disabled:text-[#A8A29E]"
            title="Send (Enter)"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between px-1 text-[length:var(--font-size-ui-sm)] text-[#A8A29E]">
          <span className="flex items-center gap-3">
            {totalTokens > 0 && (
              <button
                onClick={() => setTokenSheetOpen(true)}
                title={
                  lastUsage
                    ? `Last: ${lastUsage.prompt_tokens} prompt + ${lastUsage.completion_tokens} completion · 点击查看 Token 面板`
                    : "Total tokens used this session · 点击查看 Token 面板"
                }
                className="cursor-pointer rounded px-1 py-0.5 transition-colors hover:bg-[#F0EDE5] hover:text-[#2D2B27] dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
              >
                {totalTokens.toLocaleString()} tokens
              </button>
            )}
            {isStreaming && (
              <span className="flex items-center gap-1.5">
                <span>step</span>
                <span className="font-mono text-[#6B6862]">{agentIteration}</span>
                <span className="inline-block h-1 w-16 overflow-hidden rounded-full bg-zinc-800">
                  <span
                    className="block h-full w-1/3 animate-pulse rounded-full bg-[#D97757]"
                    style={{
                      animation: "slide-progress 1.5s ease-in-out infinite",
                    }}
                  />
                </span>
              </span>
            )}
          </span>
          <span>Enter 发送 · Shift+Tab 切换模式 · /help</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// QuestionModal — modal overlay that wraps QuestionPanel
// Appears as a centered card with backdrop when AI calls ask_user_input.
// ---------------------------------------------------------------------------

function QuestionModal({
  panel,
  onSubmit,
}: {
  panel: QuestionPanelData;
  onSubmit: (answers: Record<string, string | string[]>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#E5E2D9] bg-[#FFFFFF] shadow-2xl dark:border-[#3a3731] dark:bg-[#1c1a17]">
        <QuestionPanel panel={panel} onSubmit={onSubmit} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuestionPanel — structured question form for ask_user_input tool
// ---------------------------------------------------------------------------

function QuestionPanel({
  panel,
  onSubmit,
}: {
  panel: QuestionPanelData;
  onSubmit: (answers: Record<string, string | string[]>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [otherInputs, setOtherInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setAnswer = (qId: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [qId]: value }));
    // Clear error on change
    if (errors[qId]) setErrors((prev) => ({ ...prev, [qId]: "" }));
  };

  const toggleOption = (qId: string, optId: string) => {
    const current = (answers[qId] as string[]) ?? [];
    const next = current.includes(optId)
      ? current.filter((id) => id !== optId)
      : [...current, optId];
    setAnswer(qId, next);
  };

  const setOther = (qId: string, val: string) => {
    setOtherInputs((prev) => ({ ...prev, [qId]: val }));
  };

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    const finalAnswers: Record<string, string | string[]> = { ...answers };

    for (const q of panel.questions) {
      const val = finalAnswers[q.id];
      const hasOther = q.allow_other && (Array.isArray(val) ? val.includes("__other__") : val === "__other__");
      // Collect "other" text into answer
      if (hasOther && otherInputs[q.id]?.trim()) {
        if (Array.isArray(val)) {
          finalAnswers[q.id] = [
            ...val.filter((v) => v !== "__other__"),
            otherInputs[q.id].trim(),
          ];
        } else {
          finalAnswers[q.id] = otherInputs[q.id].trim();
        }
      }
      // Required validation
      if (q.required) {
        const answer = finalAnswers[q.id];
        if (!answer || (Array.isArray(answer) && answer.length === 0)) {
          newErrors[q.id] = "请回答此问题";
        }
      }
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    onSubmit(finalAnswers);
  };

  return (
    <div className="rounded-lg border border-[#D97757]/30 bg-[#FFFFFF] shadow-sm dark:bg-[#1c1a17]">
      {/* Header */}
      {panel.title && (
        <div className="border-b border-[#E5E2D9] px-5 py-3 dark:border-[#3a3731]">
          <h3 className="text-sm font-semibold text-[#2D2B27] dark:text-zinc-100">{panel.title}</h3>
          {panel.description && (
            <p className="mt-0.5 text-xs text-[#8B8884] dark:text-zinc-400">{panel.description}</p>
          )}
        </div>
      )}

      {/* Questions */}
      <div className="space-y-4 px-5 py-4">
        {panel.questions.map((q, qi) => (
          <div key={q.id}>
            <div className="mb-2 text-sm font-medium text-[#2D2B27] dark:text-zinc-200">
              <span>{qi + 1}. {q.question}</span>
              {q.required && <span className="ml-1 text-[#E54D2E]">*</span>}
            </div>

            {q.type === "single_select" ? (
              <div className="space-y-1.5">
                {q.options.map((opt) => {
                  const selected = answers[q.id] === opt.id;
                  return (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors ${
                        selected
                          ? "border-[#D97757] bg-[#D97757]/8"
                          : "border-[#E5E2D9] bg-[#FAF9F7] hover:border-[#D6D3CE] dark:border-[#3a3731] dark:bg-[#161512] dark:hover:border-[#52504b]"
                      }`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        value={opt.id}
                        checked={selected}
                        onChange={() => setAnswer(q.id, opt.id)}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#D97757]"
                      />
                      <div>
                        <div className="text-[#2D2B27] dark:text-zinc-200">{opt.label}</div>
                        {opt.description && (
                          <div className="mt-0.5 text-[length:var(--font-size-ui-sm)] text-[#8B8884] dark:text-zinc-400">{opt.description}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
                {q.allow_other && (
                  <div>
                    <label
                      className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors ${
                        answers[q.id] === "__other__"
                          ? "border-[#D97757] bg-[#D97757]/8"
                          : "border-[#E5E2D9] bg-[#FAF9F7] hover:border-[#D6D3CE] dark:border-[#3a3731] dark:bg-[#161512] dark:hover:border-[#52504b]"
                      }`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        value="__other__"
                        checked={answers[q.id] === "__other__"}
                        onChange={() => setAnswer(q.id, "__other__")}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#D97757]"
                      />
                      <span className="text-[#2D2B27] dark:text-zinc-200">其他</span>
                    </label>
                    {answers[q.id] === "__other__" && (
                      <input
                        type="text"
                        value={otherInputs[q.id] ?? ""}
                        onChange={(e) => setOther(q.id, e.target.value)}
                        placeholder="请输入…"
                        className="mt-1.5 ml-7 w-full rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-1.5 text-sm focus:border-[#D97757] focus:outline-none dark:border-[#3a3731] dark:bg-[#161512] dark:text-zinc-100"
                        autoFocus
                      />
                    )}
                  </div>
                )}
              </div>
            ) : q.type === "multi_select" ? (
              // multi_select
              <div className="space-y-1.5">
                {q.options.map((opt) => {
                  const selected = ((answers[q.id] as string[]) ?? []).includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors ${
                        selected
                          ? "border-[#D97757] bg-[#D97757]/8"
                          : "border-[#E5E2D9] bg-[#FAF9F7] hover:border-[#D6D3CE] dark:border-[#3a3731] dark:bg-[#161512] dark:hover:border-[#52504b]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleOption(q.id, opt.id)}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#D97757]"
                      />
                      <div>
                        <div className="text-[#2D2B27] dark:text-zinc-200">{opt.label}</div>
                        {opt.description && (
                          <div className="mt-0.5 text-[length:var(--font-size-ui-sm)] text-[#8B8884] dark:text-zinc-400">{opt.description}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
                {q.allow_other && (
                  <div>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-2 text-sm hover:border-[#D6D3CE] dark:border-[#3a3731] dark:bg-[#161512] dark:hover:border-[#52504b]">
                      <input
                        type="checkbox"
                        checked={((answers[q.id] as string[]) ?? []).includes("__other__")}
                        onChange={() => toggleOption(q.id, "__other__")}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#D97757]"
                      />
                      <span className="text-[#2D2B27] dark:text-zinc-200">其他</span>
                    </label>
                    {((answers[q.id] as string[]) ?? []).includes("__other__") && (
                      <input
                        type="text"
                        value={otherInputs[q.id] ?? ""}
                        onChange={(e) => setOther(q.id, e.target.value)}
                        placeholder="请输入…"
                        className="mt-1.5 ml-7 w-full rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-1.5 text-sm focus:border-[#D97757] focus:outline-none dark:border-[#3a3731] dark:bg-[#161512] dark:text-zinc-100"
                        autoFocus
                      />
                    )}
                  </div>
                )}
              </div>
            ) : (
              // text_input
              <div>
                <textarea
                  value={(answers[q.id] as string) ?? ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  placeholder="请输入…"
                  rows={3}
                  className="w-full resize-none rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-2 text-sm focus:border-[#D97757] focus:outline-none dark:border-[#3a3731] dark:bg-[#161512] dark:text-zinc-100"
                />
              </div>
            )}

            {/* Error message */}
            {errors[q.id] && (
              <div className="mt-1 text-xs text-[#E54D2E]">{errors[q.id]}</div>
            )}
          </div>
        ))}
      </div>

      {/* Submit */}
      <div className="border-t border-[#E5E2D9] px-5 py-3 dark:border-[#3a3731]">
        <button
          onClick={handleSubmit}
          className="rounded-lg bg-[#D97757] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#C66B4A]"
        >
          {panel.submit_label}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center text-[#8B8884]">
      <div className="rounded-full border border-[#E5E2D9] bg-zinc-900/50 p-4 dark:border-[#3a3731] dark:bg-[#262320]">
        <TerminalIcon className="h-7 w-7 text-[#D97757]" />
      </div>
      <div>
        <div className="text-[#3D3B37]">Welcome to Open Code Web</div>
        <div className="mt-1 text-xs">
          A browser-based, near 1:1 replica of the Open Code CLI.
        </div>
        <div className="mt-1 text-xs">
          The <span className="text-[#D97757]">文件袋</span> on the right is your virtual workspace.
        </div>
      </div>
      <div className="mt-2 grid gap-1 text-[length:var(--font-size-ui-sm)] text-[#A8A29E]">
        <div>• Upload files → they appear in the 文件袋</div>
        <div>• Ask the AI to build, edit, or refactor your project</div>
        <div>• Download the result as a zip when done</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent status row — shows what the agent is currently doing
// ---------------------------------------------------------------------------

function AgentStatusRow({ status }: { status: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2.5 rounded-md border border-[#D97757]/20 bg-gradient-to-r from-emerald-950/20 to-zinc-900/40 px-3 py-2 text-xs dark:border-[#D97757]/25 dark:from-emerald-950/40 dark:to-zinc-900/60"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 dark:bg-[#34d399]" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#D97757]" />
      </span>
      <Sparkles className="h-3 w-3 text-[#D97757]/70" />
      <Loader2 className="h-3 w-3 animate-spin text-[#D97757]/70" />
      <span className="text-[#2D2B27] dark:text-zinc-200">{status || "agent is working…"}</span>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Group tool-call + tool-result into pairs for merged rendering.
// Each tool-call claims the first unclaimed tool-result after it with the
// same toolName, handling both single and concurrent same-name tools.
// ---------------------------------------------------------------------------

function groupToolEvents(
  events: SessionEvent[],
): (SessionEvent & { pairedResult?: SessionEvent })[] {
  const claimed = new Set<string>();
  const result: (SessionEvent & { pairedResult?: SessionEvent })[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];

    if (ev.kind === "tool-call") {
      // Find first unclaimed tool-result after this tool-call with same name
      const match = events.slice(i + 1).find(
        (e) =>
          e.kind === "tool-result" &&
          e.toolName === ev.toolName &&
          !claimed.has(e.id),
      );
      if (match) {
        claimed.add(match.id);
        result.push({ ...ev, pairedResult: match });
        continue;
      }
    }

    // Skip tool-results that were already claimed by a tool-call
    if (ev.kind === "tool-result" && claimed.has(ev.id)) continue;

    result.push(ev);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Group assistant message + its tool calls into a "turn" for collapsed rendering.
// Rule: an assistant message FOLLOWED BY tool calls = process (analysis) →
// rendered as a collapsible turn block. An assistant message with NO tool
// calls = the final answer → rendered in full. This is the key to a calm UI:
// the English analysis between tool calls stops being the main event.
// ---------------------------------------------------------------------------

interface TurnGroup {
  kind: "turn";
  id: string;
  analysis: string;
  reasoning?: string;
  tools: (SessionEvent & { pairedResult?: SessionEvent })[];
}

type GroupedEvent = (SessionEvent & { pairedResult?: SessionEvent }) | TurnGroup;

function groupAssistantTurns(
  events: (SessionEvent & { pairedResult?: SessionEvent })[],
): GroupedEvent[] {
  const result: GroupedEvent[] = [];
  let open: TurnGroup | null = null;

  const close = (): void => {
    if (!open) return;
    if (open.tools.length === 0) {
      // 无工具调用 → 总结/纯文本消息 → 独立全文渲染（现状路径）
      result.push({
        kind: "assistant-message",
        id: open.id,
        text: open.analysis,
        reasoning: open.reasoning,
      } as SessionEvent & { pairedResult?: SessionEvent });
    } else {
      result.push(open);
    }
    open = null;
  };

  for (const ev of events) {
    if (ev.kind === "assistant-message") {
      close();
      open = { kind: "turn", id: ev.id, analysis: ev.text ?? "", reasoning: ev.reasoning, tools: [] };
      continue;
    }
    if (ev.kind === "tool-call" || ev.kind === "tool-result") {
      if (open) {
        open.tools.push(ev);
        continue;
      }
      result.push(ev); // 无 assistant 前导的工具事件（异常）→ 独立渲染
      continue;
    }
    // user / error / system → 关回合，独立渲染
    close();
    result.push(ev);
  }
  close();
  return result;
}

// ---------------------------------------------------------------------------
// Event rows — one component per EventKind
// ---------------------------------------------------------------------------

function EventRow({
  ev,
  pairedResult,
}: {
  ev: SessionEvent;
  pairedResult?: SessionEvent;
}) {
  switch (ev.kind) {
    case "user":
      return <UserRow text={ev.text ?? ""} />;
    case "assistant-message":
      return (
        <AssistantRow text={ev.text ?? ""} reasoning={ev.reasoning} streaming={false} />
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
          <ToolGroupRow
            name={ev.toolName!}
            args={ev.toolArgs!}
            result={pairedResult}
          />
        );
      }
      // Standalone tool-call (result not yet available)
      return <ToolCallRow name={ev.toolName!} args={ev.toolArgs!} />;
    case "tool-result":
      return (
        <ToolResultRow
          name={ev.toolName!}
          args={ev.toolArgs!}
          output={ev.toolOutput ?? ""}
          diff={ev.diff}
          plan={ev.plan}
          ok={!!ev.ok}
        />
      );
    case "error":
      return <ErrorRow text={ev.text ?? ""} />;
    case "system":
      return <SystemRow text={ev.text ?? ""} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// StreamingBubble — collapsed live indicator while the model is producing a
// turn. Shows "正在分析…" + animation + a single preview line, instead of
// scrolling the raw text. When the stream finishes, events take over.
// ---------------------------------------------------------------------------

function StreamingBubble({ text, reasoning }: { text: string; reasoning: string }) {
  const deferred = useDeferredValue(text || reasoning);
  const preview = deferred.split("\n").find((l) => l.trim()) ?? "";
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="overflow-hidden rounded-md border border-[#D97757]/20 bg-[#D97757]/5 px-2.5 py-1.5 text-xs dark:border-[#D97757]/25"
    >
      <div className="flex items-center gap-1.5 text-[#8B7355] dark:text-[#E8A87C]">
        <Sparkles className="h-3 w-3 text-[#D97757]/70" />
        <span className="font-medium">正在分析…</span>
        <span className="flex gap-0.5 pl-1">
          <span className="h-1 w-1 animate-bounce rounded-full bg-[#D97757]/70" style={{ animationDelay: "0ms" }} />
          <span className="h-1 w-1 animate-bounce rounded-full bg-[#D97757]/70" style={{ animationDelay: "120ms" }} />
          <span className="h-1 w-1 animate-bounce rounded-full bg-[#D97757]/70" style={{ animationDelay: "240ms" }} />
        </span>
      </div>
      {preview && <div className="mt-1 truncate text-[#A8A29E]">{preview}</div>}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// TurnBlock — a collapsed "process" card: one assistant analysis message plus
// the tool calls that followed it. Default collapsed: the English analysis
// between tool calls stops being the main event; click to expand.
// ---------------------------------------------------------------------------

function TurnBlock({ turn }: { turn: TurnGroup }) {
  // 含 dispatch_subagent 的回合默认展开——委派发生时「子智能体」卡片必须
  // 立即可见，不能藏在折叠的「思考与操作」里。
  const hasSubagent = turn.tools.some(
    (ev) => ev.kind === "tool-call" && ev.toolName === "dispatch_subagent",
  );
  const [collapsed, setCollapsed] = useState(!hasSubagent);
  const preview = turn.analysis.split("\n").find((l) => l.trim()) ?? "";
  const toolCount = turn.tools.length;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="overflow-hidden rounded-md border border-[#E5E2D9] bg-[#FAF9F7]/60 dark:border-[#3a3731] dark:bg-[#1c1a17]/60"
    >
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs"
      >
        <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", !collapsed && "rotate-90")} />
        <Wrench className="h-3 w-3 shrink-0 text-[#B87B5A] dark:text-[#E8A87C]" />
        <span className="shrink-0 font-medium text-[#6B6862] dark:text-zinc-400">思考与操作</span>
        <span className="shrink-0 text-[#A8A29E] dark:text-zinc-500">· {toolCount} 个工具调用</span>
        {collapsed && preview && (
          <span className="ml-1 min-w-0 flex-1 truncate text-[#A8A29E] dark:text-zinc-500">{preview}</span>
        )}
      </button>
      {!collapsed && (
        <div className="space-y-2 px-3 pb-3 pt-1">
          {turn.analysis && <MarkdownRenderer text={turn.analysis} />}
          {turn.reasoning && turn.reasoning.trim().length > 0 && (
            <ThinkingBlock text={turn.reasoning} streaming={false} />
          )}
          {turn.tools.map((ev) => (
            <EventRow key={ev.id} ev={ev} pairedResult={ev.pairedResult} />
          ))}
        </div>
      )}
    </motion.div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts (e.g. plain http)
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      onClick={copy}
      className="shrink-0 self-start pt-0.5 text-[#A8A29E] transition-opacity hover:text-[#3D3B37] dark:text-zinc-500 dark:hover:text-zinc-300"
      title={copied ? "Copied" : "Copy message"}
    >
      {copied ? <Check size={14} className="text-emerald-500 dark:text-[#34d399]" /> : <Copy size={14} />}
    </button>
  );
}

function UserRow({ text }: { text: string }) {
  return (
    <div className="group flex gap-2">
      <span className="shrink-0 pt-0.5 text-[#D97757]">&gt;</span>
      <div className="flex-1 min-w-0 text-[#1A1815] dark:text-zinc-100">
        <CollapsibleText text={text} render={(t) => <MarkdownRenderer text={t} />} />
      </div>
      <CopyButton text={text} />
    </div>
  );
}

/**
 * Thinking block — shows the model's reasoning_content (real thinking) as a
 * collapsible plain-text panel. Live (streaming) and final states share this
 * component, distinguished by the `streaming` prop.
 */
function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const deferredText = useDeferredValue(text);
  const isStale = deferredText !== text;
  // Live always stays open (the thinking must be visible); final long blocks
  // default collapsed. Evaluated once on mount — no cross-instance state.
  const [collapsed, setCollapsed] = useState(() => !streaming && text.length > 400);
  const preview = text.split("\n").find((l) => l.trim()) ?? text;
  const shown = streaming ? deferredText : text;

  return (
    <motion.div
      initial={{ opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="mb-1.5 overflow-hidden rounded-md border border-[#D97757]/20 bg-[#D97757]/5 dark:border-[#D97757]/25"
    >
      <button
        onClick={() => setCollapsed((c) => !c)}
        disabled={streaming}
        className="flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-xs text-[#8B7355] disabled:cursor-default dark:text-[#E8A87C]"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", !collapsed && "rotate-90")} />
        <Sparkles className="h-3 w-3 text-[#D97757]/70" />
        <span className="font-medium">thinking</span>
        {streaming && (
          <span className="flex gap-0.5 pl-1">
            <span className="h-1 w-1 animate-bounce rounded-full bg-[#D97757]/70" style={{ animationDelay: "0ms" }} />
            <span className="h-1 w-1 animate-bounce rounded-full bg-[#D97757]/70" style={{ animationDelay: "120ms" }} />
            <span className="h-1 w-1 animate-bounce rounded-full bg-[#D97757]/70" style={{ animationDelay: "240ms" }} />
          </span>
        )}
        {!streaming && collapsed && <span className="ml-2 truncate text-[#A8A29E]">{preview}</span>}
        {!streaming && <span className="ml-auto text-[#A8A29E]">{collapsed ? "show" : "hide"}</span>}
      </button>
      {!collapsed && (
        <pre
          className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 pb-2.5 pt-0.5 font-mono text-xs leading-relaxed text-[#6B6862] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE]"
          style={{ opacity: isStale ? 0.9 : 1 }}
        >
          {shown}
        </pre>
      )}
    </motion.div>
  );
}

function AssistantRow({
  text,
  reasoning,
  streaming,
}: {
  text: string;
  reasoning?: string;
  streaming: boolean;
}) {
  const deferredText = useDeferredValue(text);
  const isStale = deferredText !== text;
  const showReasoning = !!reasoning && reasoning.trim().length > 0;
  if (!text && !showReasoning) return null;
  return (
    <div className="group flex gap-2">
      <span className="shrink-0 pt-0.5 text-[#8B7355] dark:text-[#E8A87C]">⟫</span>
      <div className="flex-1 min-w-0 break-words text-[#2D2B27] dark:text-zinc-100" style={{ opacity: isStale ? 0.95 : 1 }}>
        {showReasoning && <ThinkingBlock text={reasoning!} streaming={streaming} />}
        {text && <MarkdownRenderer text={streaming ? deferredText : text} />}
        {streaming && (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-emerald-400 align-middle dark:bg-[#34d399]" />
        )}
      </div>
      <CopyButton text={text || reasoning || ""} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SubagentCard — the dedicated「子智能体」card in the main conversation flow.
// Shows a teal dot + "子智能体" + cyan "Explore" tag + "·" + a short task
// title (first line of the delegation prompt). Running state shows animated
// dots; clicking the card opens the 子智能体 panel in the right sidebar.
// ---------------------------------------------------------------------------

function SubagentCard({
  eventId,
  task,
  running,
}: {
  eventId: string;
  task: string;
  running: boolean;
}) {
  const setRightPanelTab = useVfsView((s) => s.setRightPanelTab);
  const setSubagentFocus = useVfsView((s) => s.setSubagentFocus);
  const title = useMemo(() => {
    const firstLine = task.split("\n").map((l) => l.trim()).find((l) => l) ?? "";
    return firstLine.length > 42 ? firstLine.slice(0, 42) + "…" : firstLine;
  }, [task]);

  const openPanel = () => {
    setSubagentFocus(eventId);
    setRightPanelTab("subagents");
  };

  return (
    <motion.button
      onClick={openPanel}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="flex w-full items-center gap-2 rounded-md border border-[#0D9488]/25 bg-[#0D9488]/5 px-3 py-2 text-left text-xs transition-colors hover:bg-[#0D9488]/10"
      title="查看子智能体详情"
    >
      {running ? (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#14B8A6] opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#14B8A6]" />
        </span>
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#14B8A6]" />
      )}
      <span className="shrink-0 font-semibold text-[#3D3B37]">子智能体</span>
      <span className="shrink-0 rounded bg-[#0D9488]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0F766E]">
        Explore
      </span>
      <span className="shrink-0 text-[#A8A29E]">·</span>
      <span className="min-w-0 flex-1 truncate text-[#6B6862]">
        {title || "探索任务"}
      </span>
      {running ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[#0F766E]">
          <span className="flex gap-0.5">
            <span className="h-1 w-1 animate-bounce rounded-full bg-[#14B8A6]" style={{ animationDelay: "0ms" }} />
            <span className="h-1 w-1 animate-bounce rounded-full bg-[#14B8A6]" style={{ animationDelay: "120ms" }} />
            <span className="h-1 w-1 animate-bounce rounded-full bg-[#14B8A6]" style={{ animationDelay: "240ms" }} />
          </span>
          <span className="hidden sm:inline">运行中…</span>
        </span>
      ) : (
        <span className="shrink-0 text-[#A8A29E]">查看详情 →</span>
      )}
    </motion.button>
  );
}

function ToolCallRow({
  name,
  args,
}: {
  name: string;
  args: Record<string, unknown>;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="rounded-md border border-[#E5E2D9] bg-gradient-to-r from-amber-950/15 to-zinc-900/30 px-3 py-2 text-xs dark:border-[#3a3731] dark:from-amber-950/25 dark:to-zinc-900/50"
      style={{ borderLeft: "3px solid rgba(217, 119, 6, 0.5)" }}
    >
      <div className="flex items-center gap-2 text-[#B87B5A] dark:text-[#E8A87C]">
        <Wrench className="h-3.5 w-3.5" />
        <span className="font-semibold tracking-wide">tool · {name}</span>
      </div>
      <div className="mt-1.5 space-y-0.5 pl-5 text-[#6B6862] dark:text-zinc-400">
        {Object.entries(args).slice(0, 6).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="text-[#8B8884] dark:text-zinc-500">{k}:</span>
            <span className="flex-1 break-all text-[#3D3B37] dark:text-zinc-300">
              {formatArgValue(v)}
            </span>
          </div>
        ))}
        {Object.keys(args).length > 6 && (
          <div className="text-[#A8A29E] dark:text-zinc-500">… {Object.keys(args).length - 6} more</div>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// ToolGroupRow — merged tool-call + tool-result card
// Shows the tool name + args at top, and the result (collapsible) below.
// ---------------------------------------------------------------------------

function ToolGroupRow({
  name,
  args,
  result,
}: {
  name: string;
  args: Record<string, unknown>;
  result: SessionEvent;
}) {
  const isPlan = !!result.plan;
  const [collapsed, setCollapsed] = useState(!isPlan);
  const showPath =
    result.diff?.path ??
    (typeof args.path === "string" ? args.path : null);
  const select = useVfsView((s) => s.select);
  const bump = useVfsView((s) => s.bump);
  const output = result.toolOutput ?? "";
  const ok = !!result.ok;

  useEffect(() => {
    if (result.diff || isPlan) bump();
  }, [result.diff, isPlan, bump]);

  const outputLineCount = output ? output.split("\n").length : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="overflow-hidden rounded-md border border-[#E5E2D9] bg-[#FFFFFF] text-xs shadow-sm dark:border-[#3a3731] dark:bg-[#1c1a17]"
    >
      {/* Header — tool name + status */}
      <div className="flex items-center gap-2 bg-gradient-to-r from-amber-950/15 to-zinc-900/30 px-3 py-2 dark:from-amber-950/25 dark:to-zinc-900/50">
        <Wrench className="h-3.5 w-3.5 text-[#B87B5A] dark:text-[#E8A87C]" />
        <span className="font-semibold tracking-wide text-[#B87B5A] dark:text-[#E8A87C]">
          tool · {name}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {ok ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-[#D97757]" />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-[#E54D2E]" />
          )}
        </span>
      </div>

      {/* Args — compact key-value pairs */}
      {Object.keys(args).length > 0 && (
        <div className="border-b border-[#E5E2D9] px-3 py-1.5 text-[#6B6862] dark:border-[#3a3731] dark:text-zinc-400">
          {Object.entries(args).slice(0, 6).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="shrink-0 text-[#8B8884] dark:text-zinc-500">{k}:</span>
              <span className="break-all text-[#3D3B37] dark:text-zinc-300">
                {formatArgValue(v)}
              </span>
            </div>
          ))}
          {Object.keys(args).length > 6 && (
            <div className="text-[#A8A29E] dark:text-zinc-500">
              … {Object.keys(args).length - 6} more
            </div>
          )}
        </div>
      )}

      {/* Result section — collapsible */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-2">
          {showPath && !isPlan && (
            <button
              onClick={() => select(showPath)}
              className="flex items-center gap-1 truncate rounded px-1 text-[#8B7355] hover:bg-[#F0EDE5] dark:text-[#E8A87C] dark:hover:bg-[#2a2723]"
              title="Open in editor"
            >
              <FileText className="h-3 w-3" />
              <span className="truncate">{showPath}</span>
            </button>
          )}
          {!result.diff && !isPlan && output && (
            <span className="text-[length:var(--font-size-ui-sm)] text-[#A8A29E] dark:text-zinc-500">
              {outputLineCount} line{outputLineCount !== 1 ? "s" : ""}
            </span>
          )}
          {!isPlan && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="ml-auto text-[#8B8884] hover:text-[#3D3B37] dark:text-zinc-500 dark:hover:text-zinc-200"
            >
              {collapsed ? "show" : "hide"}
            </button>
          )}
        </div>

        {isPlan ? (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-[#D97757]">📋</span>
            <span className="text-[#6B6862] dark:text-zinc-400">Plan updated. </span>
            <button
              onClick={() => useVfsView.getState().setRightPanelTab("plan")}
              className="text-[#D97757] underline hover:no-underline"
            >
              Open Plan panel →
            </button>
          </div>
        ) : !collapsed && result.diff ? (
          <div className="mt-2">
            <DiffView
              before={result.diff.before}
              after={result.diff.after}
            />
          </div>
        ) : (
          !collapsed && output && (
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-[#6B6862] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE] dark:text-zinc-400 dark:[&::-webkit-scrollbar-thumb]:bg-[#3a3731]">
              {output}
            </pre>
          )
        )}
      </div>
    </motion.div>
  );
}

function ToolResultRow({
  name,
  args,
  output,
  diff,
  plan,
  ok,
}: {
  name: string;
  args: Record<string, unknown>;
  output: string;
  diff?: { path: string; before: string; after: string };
  plan?: string;
  ok: boolean;
}) {
  // update_plan uses a dedicated PlanView (checkbox list), never collapsed.
  // All other tool results default to collapsed — diffs and long outputs can
  // flood the terminal and push context out of view. User clicks "show" to
  // expand any result they want to inspect.
  const isPlan = !!plan;
  const [collapsed, setCollapsed] = useState(!isPlan);
  const showPath = diff?.path ?? (typeof args.path === "string" ? args.path : null);
  const isMutation = !!diff;
  const select = useVfsView((s) => s.select);
  const bump = useVfsView((s) => s.bump);

  useEffect(() => {
    if (isMutation || isPlan) bump();
  }, [isMutation, isPlan, bump]);

  const outputLineCount = output ? output.split("\n").length : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "rounded-md border px-3 py-2 text-xs",
        ok
          ? "border-[#E5E2D9] bg-[#F5F3EE] dark:border-[#3a3731] dark:bg-[#1c1a17]"
          : "border-[#E54D2E]/20 bg-[#E54D2E]/5",
      )}
    >
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#D97757]" />
        ) : (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-[#E54D2E]" />
        )}
        <span className="font-semibold text-[#3D3B37] dark:text-zinc-200">
          {ok ? "result" : "failed"} · {name}
        </span>
        {showPath && !isPlan && (
          <button
            onClick={() => select(showPath)}
            className="ml-1 flex items-center gap-1 truncate rounded px-1 text-[#8B7355] hover:bg-[#F0EDE5] dark:text-[#E8A87C] dark:hover:bg-[#2a2723]"
            title="Open in editor"
          >
            <FileText className="h-3 w-3" />
            <span className="truncate">{showPath}</span>
          </button>
        )}
        {!diff && !isPlan && output && (
          <span className="text-[10px] text-[#A8A29E] dark:text-zinc-500">
            {outputLineCount} line{outputLineCount !== 1 ? "s" : ""}
          </span>
        )}
        {!isPlan && (
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="ml-auto text-[#8B8884] hover:text-[#3D3B37] dark:text-zinc-500 dark:hover:text-zinc-200"
          >
            {collapsed ? "show" : "hide"}
          </button>
        )}
      </div>

      {isPlan ? (
        <div className="mt-2 flex items-center gap-2 pl-5 text-xs">
          <span className="text-[#D97757]">📋</span>
          <span className="text-[#6B6862] dark:text-zinc-400">Plan updated. </span>
          <button
            onClick={() => useVfsView.getState().setRightPanelTab("plan")}
            className="text-[#D97757] underline hover:no-underline"
          >
            Open Plan panel →
          </button>
        </div>
      ) : !collapsed && diff ? (
        <div className="mt-2 pl-5">
          <DiffView before={diff.before} after={diff.after} />
        </div>
      ) : (
        !collapsed && output && (
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words pl-5 text-[#6B6862] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE] dark:text-zinc-400 dark:[&::-webkit-scrollbar-thumb]:bg-[#3a3731]">
            {output}
          </pre>
        )
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// PlanHeaderBadge — tiny plan progress pill for the header bar
// Subscribes to VFS version so it updates in real-time whenever the plan
// file changes (same reactivity as the full PlanPanel).
// ---------------------------------------------------------------------------

function PlanHeaderBadge() {
  const vfsVersion = useVfsView((s) => s.version);
  const stats = useMemo(() => {
    const content = vfs.readFileSync("PLAN.md");
    return content ? planStats(content) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vfsVersion]);

  if (!stats) return null;

  return (
    <button
      onClick={() => useVfsView.getState().setRightPanelTab("plan")}
      className="flex items-center gap-1.5 rounded-full border border-[#D97757]/20 bg-[#D97757]/8 px-3 py-1.5 text-[length:var(--font-size-ui-sm)] font-medium text-[#B87B5A] hover:bg-[#D97757]/15"
      title={`Plan: ${stats.done}/${stats.total} steps done`}
    >
      <span>📋</span>
      <span className="tabular-nums">{stats.done}/{stats.total}</span>
      <div className="h-1.5 w-10 overflow-hidden rounded-full bg-zinc-700">
        <div
          className="h-full rounded-full bg-[#D97757] transition-all duration-300"
          style={{ width: `${stats.pct}%` }}
        />
      </div>
    </button>
  );
}

function ErrorRow({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-[#E54D2E]/20 bg-[#E54D2E]/5 px-3 py-2 text-xs text-[#E54D2E]">
      <div className="flex items-center gap-2 font-semibold">
        <XCircle className="h-3.5 w-3.5" />
        <span>error</span>
      </div>
      <pre className="mt-1 whitespace-pre-wrap break-words pl-5 text-[#E54D2E]">
        {text}
      </pre>
    </div>
  );
}

function SystemRow({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-[#E5E2D9] bg-[#F5F3EE] px-3 py-2 text-xs text-[#6B6862] dark:border-[#3a3731] dark:bg-[#1c1a17] dark:text-zinc-400">
      <span className="text-[#8B8884] dark:text-zinc-500">[system]</span> {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff view — line based, like Open Code
// ---------------------------------------------------------------------------

function DiffView({ before, after }: { before: string; after: string }) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const diff = lineDiff(beforeLines, afterLines);

  return (
    <div className="overflow-x-auto rounded border border-[#E5E2D9] bg-[#FFFFFF] text-[length:var(--font-size-code)] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE] dark:border-[#3a3731] dark:bg-[#0d0d0b] dark:[&::-webkit-scrollbar-thumb]:bg-[#3a3731]">
      <table className="min-w-full border-collapse font-mono">
        <tbody>
          {diff.map((row, i) => (
            <tr
              key={i}
              className={cn(
                row.type === "add" && "bg-[#D97757]/10",
                row.type === "del" && "bg-red-950/30",
              )}
            >
              <td className="w-8 select-none border-r border-[#E5E2D9] px-1 text-right text-[#A8A29E] dark:border-[#3a3731] dark:text-zinc-500">
                {row.leftNum ?? ""}
              </td>
              <td className="w-8 select-none border-r border-[#E5E2D9] px-1 text-right text-[#A8A29E] dark:border-[#3a3731] dark:text-zinc-500">
                {row.rightNum ?? ""}
              </td>
              <td
                className={cn(
                  "whitespace-pre-wrap break-all px-2",
                  row.type === "add" && "text-emerald-300 dark:text-[#6ee7b7]",
                  row.type === "del" && "text-[#E54D2E]",
                  row.type === "ctx" && "text-[#6B6862] dark:text-zinc-400",
                )}
              >
                <span className="select-none mr-1">
                  {row.type === "add" ? "+" : row.type === "del" ? "-" : " "}
                </span>
                {row.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type DiffRow =
  | { type: "ctx"; text: string; leftNum: number; rightNum: number }
  | { type: "add"; text: string; leftNum: null; rightNum: number }
  | { type: "del"; text: string; leftNum: number; rightNum: null };

function lineDiff(a: string[], b: string[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0, j = 0;
  let leftNum = 1, rightNum = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: "ctx", text: a[i], leftNum: leftNum++, rightNum: rightNum++ });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: a[i], leftNum: leftNum++, rightNum: null });
      i++;
    } else {
      rows.push({ type: "add", text: b[j], leftNum: null, rightNum: rightNum++ });
      j++;
    }
  }
  while (i < n) {
    rows.push({ type: "del", text: a[i], leftNum: leftNum++, rightNum: null });
    i++;
  }
  while (j < m) {
    rows.push({ type: "add", text: b[j], leftNum: null, rightNum: rightNum++ });
    j++;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatArgValue(v: unknown): string {
  if (typeof v === "string") {
    const oneline = v.replace(/\n/g, "\\n");
    if (oneline.length > 120) return oneline.slice(0, 120) + "…";
    return oneline;
  }
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Markdown renderer — react-markdown + remark-gfm with Prism highlighting
// ---------------------------------------------------------------------------

const PRISM_LANG_MAP: Record<string, string> = {
  javascript: "javascript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  typescript: "typescript",
  ts: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  css: "css",
  scss: "css",
  less: "css",
  json: "json",
  jsonc: "json",
  html: "markup",
  xml: "markup",
  svg: "markup",
  markdown: "markdown",
  md: "markdown",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  python: "python",
  py: "python",
  yaml: "yaml",
  yml: "yaml",
  go: "go",
  rust: "rust",
  rs: "rust",
  sql: "sql",
  toml: "yaml",
  diff: "bash",
  text: "markup",
  plaintext: "markup",
};

function highlightCode(code: string, lang: string): string {
  const grammarName = PRISM_LANG_MAP[lang?.toLowerCase()] || "clike";
  const grammar = Prism.languages[grammarName];
  if (!grammar) {
    try {
      return Prism.highlight(code, Prism.languages.clike, "clike");
    } catch {
      return escapeHtml(code);
    }
  }
  try {
    return Prism.highlight(code, grammar, grammarName);
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

let mermaidId = 0;
function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const isComplete = code.trim().length > 10 && code.includes('\n');
  useEffect(() => {
    if (done.current || !ref.current || !isComplete) return;
    done.current = true;
    const id = ++mermaidId;
    (async () => {
      try {
        const { svg } = await mermaid.render('mermaid-' + id, code);
        if (ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [code, isComplete]);
  if (error) {
    return <pre className="my-2 rounded border border-red-300/40 bg-red-50/50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-950/20 dark:text-red-400">[mermaid 渲染失败] {error}</pre>;
  }
  if (!isComplete) {
    return <pre className="text-xs text-[#8B8884] italic">[diagram]</pre>;
  }
  return <div ref={ref} className="my-2 flex justify-center" />;
}

let graphvizId = 0;
// Graphviz.load() 返回的实例类型签名复杂（Format 枚举等），动态 import +
// 已 Node 冒烟验证 dot() 用法，此处用 any 保持轻量。
let graphvizPromise: Promise<any> | null = null;
async function getGraphviz() {
  if (!graphvizPromise) {
    graphvizPromise = import("@hpcc-js/wasm-graphviz").then(({ Graphviz }) => Graphviz.load());
  }
  return graphvizPromise;
}

/** Graphviz / DOT — fenced code block with language "dot".
 *  Renders DOT source (digraph G { a -> b }) as an SVG via the official
 *  Graphviz WASM. Handles complex DAGs / dependency graphs / architecture
 *  diagrams where mermaid's flowchart layout falls short. */
function GraphvizBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const isComplete = code.trim().length > 5;
  useEffect(() => {
    if (done.current || !ref.current || !isComplete) return;
    done.current = true;
    const id = ++graphvizId;
    (async () => {
      try {
        const graphviz = await getGraphviz();
        let svg = graphviz.dot(code);
        // 深色模式适配：Graphviz 默认 fill/stroke 为纯黑，在深色背景看不清。
        // 只替换显式纯黑（用户自定义颜色不受影响）；保留用户指定的其他颜色。
        svg = svg
          .replace(/fill="black"/g, 'fill="#e4e4e7"')
          .replace(/stroke="black"/g, 'stroke="#a1a1aa"')
          .replace(/fontcolor="black"/g, 'fontcolor="#e4e4e7"');
        if (ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [code, isComplete]);
  if (error) {
    return <pre className="my-2 rounded border border-red-300/40 bg-red-50/50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-950/20 dark:text-red-400">[dot 渲染失败] {error}</pre>;
  }
  if (!isComplete) {
    return <pre className="text-xs text-[#8B8884] italic">[graph]</pre>;
  }
  return <div ref={ref} className="my-2 flex justify-center" />;
}

let chartId = 0;
/** Chart.js — fenced code block with language "chart".
 *  Body is a JSON config: { type, data, options }. Renders a responsive
 *  line/bar/pie/scatter chart from data (e.g. parsed by parse_csv/query_json). */
function ChartBlock({ code }: { code: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const done = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const isComplete = code.trim().length > 5;
  useEffect(() => {
    if (done.current || !canvasRef.current || !isComplete) return;
    done.current = true;
    const id = ++chartId;
    (async () => {
      try {
        const config = JSON.parse(code);
        if (!config || typeof config !== "object" || !config.type || !config.data) {
          throw new Error('chart 配置需为 {type, data, options?}，如 {"type":"bar","data":{"labels":["a","b"],"datasets":[{...}]}}');
        }
        const { Chart } = await import("chart.js/auto");
        const canvas = canvasRef.current;
        if (!canvas) return;
        new Chart(canvas, {
          ...config,
          options: {
            responsive: true,
            maintainAspectRatio: false,
            // 深色模式默认配色：浅色文字 + 半透明网格，用户 options 可覆盖
            color: "#e4e4e7",
            scales: {
              x: { ticks: { color: "#e4e4e7" }, grid: { color: "rgba(255,255,255,0.08)" } },
              y: { ticks: { color: "#e4e4e7" }, grid: { color: "rgba(255,255,255,0.08)" } },
            },
            ...(config.options ?? {}),
          },
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [code, isComplete]);
  if (error) {
    return <pre className="my-2 rounded border border-red-300/40 bg-red-50/50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-950/20 dark:text-red-400">[chart 渲染失败] {error}</pre>;
  }
  if (!isComplete) {
    return <pre className="text-xs text-[#8B8884] italic">[chart]</pre>;
  }
  return (
    <div className="my-2 flex h-64 items-center justify-center rounded border border-[#E5E2D9] bg-[#FFFFFF] p-3 dark:border-[#3a3731] dark:bg-[#0f0e0b]">
      <canvas ref={canvasRef} className="max-h-full max-w-full" />
    </div>
  );
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-3 mb-2 text-xl font-extrabold tracking-tight text-[#1A1815] dark:text-white">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-2 text-lg font-bold tracking-tight text-[#1A1815] dark:text-white">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2 mb-1 text-base font-semibold text-[#2D2B27] dark:text-zinc-100">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-2 mb-1 text-sm font-semibold text-[#3D3B37] dark:text-zinc-200">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="my-1.5 leading-relaxed text-[#2D2B27] dark:text-zinc-300">{children}</p>
  ),
  ul: ({ children, ...props }) => {
    // task list?
    const items = Array.isArray(children) ? children : [children];
    return (
      <ul className="my-1.5 ml-4 list-disc space-y-0.5 text-[#2D2B27] dark:text-zinc-300" {...props}>
        {children}
      </ul>
    );
  },
  ol: ({ children, ...props }) => (
    <ol className="my-1.5 ml-4 list-decimal space-y-0.5 text-[#2D2B27] dark:text-zinc-300" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => {
    // GFM task list items: <li><input type="checkbox" ...> text
    return <li className="pl-1" {...props}>{children}</li>;
  },
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#8B7355] underline decoration-sky-700 hover:decoration-sky-400 dark:text-[#7dd3fc] dark:decoration-[#0369a1] dark:hover:decoration-[#38bdf8]"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-bold text-[#1A1815] dark:text-white">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-[#3D3B37] dark:text-zinc-200">{children}</em>,
  del: ({ children }) => (
    <del className="text-[#8B8884] line-through dark:text-zinc-500">{children}</del>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[#E5E2D9] pl-3 text-[#6B6862] italic dark:border-[#52504b] dark:text-zinc-400">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-[#E5E2D9] dark:border-[#3a3731]" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-[#E5E2D9] dark:border-[#3a3731]">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-2 py-1 text-left font-semibold text-[#2D2B27] dark:text-zinc-100">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1 border-t border-[#E5E2D9] text-[#3D3B37] dark:border-[#3a3731] dark:text-zinc-300">{children}</td>
  ),
  // Inline code — the "微白框" look: soft light box with readable text,
  // never the harsh emerald. In dark mode: brighter box, near-white text.
  code: ({ className, children, ...props }) => {
    const langMatch = className ? className.match(/language-(\w+)/) : null;
    const isInline = !langMatch && !String(children).includes("\n");
    if (isInline) {
      return (
        <code
          className="rounded-md border border-[#E5E2D9] bg-[#F5F3EE] px-1.5 py-0.5 text-[length:var(--font-size-code)] font-medium text-[#3D3B37] dark:border-[#52504b] dark:bg-[#262320] dark:text-zinc-100"
          {...props}
        >
          {children}
        </code>
      );
    }
    // Fenced code block — render with Prism
    const lang = langMatch?.[1] ?? "text";
    const codeText = String(children).replace(/\n$/, "");
    const highlighted = highlightCode(codeText, lang);
    return (
      <code
        className={`language-${lang} font-mono`}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    );
  },
  // Wrap fenced code blocks in a styled <pre>
  pre: ({ children }) => {
    // Extract language + raw code for the header label
    let lang = "text";
    let codeText = "";
    // children is typically a single <code> element
    const child = Array.isArray(children) ? children[0] : children;
    if (child && typeof child === "object" && "props" in child) {
      const childProps = (child as { props: { className?: string; children?: unknown } }).props;
      const match = /language-(\w+)/.exec(childProps.className || "");
      if (match) lang = match[1];
      codeText = String(childProps.children ?? "").replace(/\n$/, "");
    }
    // Mermaid flowchart — render with mermaid.js
    if (lang === "mermaid") {
      return <MermaidBlock code={codeText} />;
    }
    // Graphviz / DOT — official Graphviz WASM (complex DAGs, dependency graphs)
    if (lang === "dot" || lang === "graphviz") {
      return <GraphvizBlock code={codeText} />;
    }
    // Chart.js — data charts from JSON config
    if (lang === "chart") {
      return <ChartBlock code={codeText} />;
    }
    return (
      <div className="my-2 overflow-hidden rounded-md border border-[#E5E2D9] bg-[#FFFFFF] dark:border-[#3a3731] dark:bg-[#0f0e0b]">
        <div className="flex items-center justify-between border-b border-[#E5E2D9] px-3 py-1 text-[length:var(--font-size-ui-sm)] uppercase tracking-wider text-[#8B8884] dark:border-[#3a3731] dark:text-zinc-500">
          <span>{lang}</span>
          <button
            onClick={() => {
              if (codeText) navigator.clipboard?.writeText(codeText);
            }}
            className="text-[#A8A29E] hover:text-[#3D3B37] dark:text-zinc-500 dark:hover:text-zinc-200"
            title="Copy"
          >
            copy
          </button>
        </div>
        <pre className="overflow-x-auto px-4 py-3 text-[length:var(--font-size-code)] leading-relaxed [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE] dark:[&::-webkit-scrollbar-thumb]:bg-[#3a3731]">
          {children}
        </pre>
      </div>
    );
  },
};

export const MarkdownRenderer = memo(function MarkdownRenderer({
  text,
}: {
  text: string;
}) {
  return (
    <div className="prose-invert max-w-none break-words text-[length:var(--font-size-base)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
