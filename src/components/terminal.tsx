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
  Download,
  Loader2,
  Square,
  Trash2,
  ChevronRight,
  FileText,
  Terminal as TerminalIcon,
  CheckCircle2,
  XCircle,
  Wrench,
  Sparkles,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
import { useVfsView } from "@/store/vfs-view";
import { vfs } from "@/lib/vfs";
import { cn } from "@/lib/utils";
import { planStats } from "@/lib/plan-utils";

export function Terminal() {
  const events = useSession((s) => s.events);
  const isStreaming = useSession((s) => s.isStreaming);
  const agentStatus = useSession((s) => s.agentStatus);
  const agentIteration = useSession((s) => s.agentIteration);
  const agentMaxIterations = useSession((s) => s.agentMaxIterations);
  const totalTokens = useSession((s) => s.totalTokens);
  const lastUsage = useSession((s) => s.lastUsage);
  const config = useSession((s) => s.config);
  const setConfig = useSession((s) => s.setConfig);
  const mode = useSession((s) => s.mode);
  const toggleMode = useSession((s) => s.toggleMode);
  const streamingText = useSession((s) => s.streamingText);
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

  // Auto-scroll to bottom on new events when user is near the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (autoScroll) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events, streamingText, autoScroll]);

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
        pushSystem([
          "Slash commands:",
          "  /clear            Clear the session (keep workspace)",
          "  /reset            Same as /clear",
          "  /model <name>     Switch AI model without opening Settings",
          "  /compact          Compress conversation history to save tokens",
          "  /export           Download the conversation as a Markdown file",
          "  /cost             Estimate cumulative API cost",
          "  /tokens           Show real token usage from the API",
          "  /undo             Undo the last AI file edit (restore snapshot)",
          "  /diff             Show all file changes made this session",
          "  /help             Show this help",
          "",
          "Tips:",
          "  • Press Enter to send, Shift+Enter for newline",
          "  • Click any file path in tool results to open it in the editor",
          "  • Use Ctrl+S in the editor to save the active file",
          "  • The AI can call undo_edit itself to revert its own mistakes",
        ].join("\n"));
        break;

      case "tokens":
        pushSystem(
          lastUsage
            ? `Tokens used this session: ${totalTokens.toLocaleString()} total\n  • Last request: ${lastUsage.prompt_tokens.toLocaleString()} prompt + ${lastUsage.completion_tokens.toLocaleString()} completion = ${lastUsage.total_tokens.toLocaleString()} total\n  • Context budget: ~60,000 tokens (auto-truncates when exceeded)`
            : `Tokens used this session: ${totalTokens.toLocaleString()} total\n  • No usage data yet — send a message to the AI.\n  • Context budget: ~60,000 tokens (auto-truncates when exceeded)`,
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
          pushSystem("Not enough conversation to compact (need at least 4 messages).");
          break;
        }
        // Force truncation by setting a tiny budget temporarily, then restore.
        // The truncateConversation function keeps system + last 10 messages,
        // compresses tool results, drops oldest. We just trigger it via the
        // normal send path, but since we're not sending, we do it inline.
        pushSystem(
          `Compacting conversation (${beforeMsgs} messages, ~${totalTokens.toLocaleString()} tokens). ` +
            `Older messages and tool results will be summarized on the next AI request. ` +
            `This happens automatically when you exceed 60K tokens — /compact just forces it now.`,
        );
        // Mark truncated so the next send knows to surface the notice.
        useSession.setState({ truncated: true });
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
    <div className="flex h-full flex-col bg-[#FAF9F7] text-[#2D2B27] font-mono text-[13px] leading-relaxed">
      {/* Header bar — model name centered, mode toggle right */}
      <div className="flex items-center justify-between border-b border-[#E5E2D9] px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2 text-[#6B6862]">
          {config.hasApiKey && (
            <span className="flex items-center gap-1.5 rounded-md bg-[#F5F3EE] px-2.5 py-1 text-[11px] font-medium text-[#8B7355]">
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
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
              mode === "plan"
                ? "border-[#D97757]/30 bg-[#D97757]/10 text-[#D97757]"
                : "border-[#E5E2D9] bg-[#F5F3EE] text-[#8B8884] hover:text-[#2D2B27]",
            )}
            title="Shift+Tab to toggle"
          >
            {mode === "plan" ? "📋 Plan" : "⚡ Bypass"}
          </button>
              {/* Plan progress indicator — click opens the Plan tab in the right panel */}
          <PlanHeaderBadge />
          <button
            onClick={() => handleSlashCommand("/export json")}
            className="rounded px-2 py-1 text-[#8B8884] hover:bg-[#F0EDE5] hover:text-[#2D2B27]"
            title="Export session as JSON"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={reset}
            className="rounded px-2 py-1 text-[#8B8884] hover:bg-[#F0EDE5] hover:text-[#2D2B27]"
            title="Clear session"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {isStreaming && (
            <button
              onClick={abort}
              className="flex items-center gap-1 rounded bg-[#E54D2E]/10 px-2 py-1 text-[#E54D2E] hover:bg-[#E54D2E]/10"
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
        {events.length === 0 && !streamingText && <EmptyState />}
        <div className="space-y-3">
          {useMemo(() => groupToolEvents(events), [events]).map((ev) => (
            <EventRow key={ev.id} ev={ev} pairedResult={ev.pairedResult} />
          ))}
          {/* Live streaming bubble — separate from events to avoid O(n) re-render */}
          {streamingText && streamingText.text && (
            <AssistantRow text={streamingText.text} streaming={true} />
          )}
          {isStreaming && (
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
      </div>

      {/* Input */}
      {/* Input area — clean, minimal */}
      <div className="border-t border-[#E5E2D9] bg-[#FFFFFF] px-4 py-3">
        <div className="relative flex items-end gap-2.5 rounded-xl border border-[#E5E2D9] bg-[#FAF9F7] px-4 py-3 transition-colors focus-within:border-[#D97757]/40">
          {/* @mention autocomplete dropdown */}
          {mentionQuery !== null && mentionFiles.length > 0 && (
            <div className="absolute bottom-full left-0 mb-2 w-72 overflow-hidden rounded-lg border border-[#E5E2D9] bg-white shadow-lg">
              {mentionFiles.map((f, i) => (
                <button
                  key={f.path}
                  onClick={() => insertMention(f.path)}
                  onMouseEnter={() => setMentionIndex(i)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs",
                    i === mentionIndex ? "bg-[#D97757]/8 text-[#D97757]" : "text-[#3D3B37] hover:bg-[#F5F3EE]",
                  )}
                >
                  <FileText className="h-3 w-3 shrink-0 text-[#8B7355]" />
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
            disabled={isStreaming}
            className="max-h-[200px] flex-1 resize-none bg-transparent text-[13px] text-[#1A1815] placeholder:text-[#A8A29E] focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={submit}
            disabled={!input.trim() || isStreaming}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#D97757] text-white transition-colors hover:bg-[#C66B4A] disabled:cursor-not-allowed disabled:bg-[#D6D3CE] disabled:text-[#A8A29E]"
            title="Send (Enter)"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-[#A8A29E]">
          <span className="flex items-center gap-3">
            {totalTokens > 0 && (
              <span
                title={
                  lastUsage
                    ? `Last: ${lastUsage.prompt_tokens} prompt + ${lastUsage.completion_tokens} completion`
                    : "Total tokens used this session"
                }
              >
                {totalTokens.toLocaleString()} tokens
              </span>
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
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#E5E2D9] bg-[#FFFFFF] shadow-2xl">
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
    <div className="rounded-lg border border-[#D97757]/30 bg-[#FFFFFF] shadow-sm">
      {/* Header */}
      {panel.title && (
        <div className="border-b border-[#E5E2D9] px-5 py-3">
          <h3 className="text-sm font-semibold text-[#2D2B27]">{panel.title}</h3>
          {panel.description && (
            <p className="mt-0.5 text-xs text-[#8B8884]">{panel.description}</p>
          )}
        </div>
      )}

      {/* Questions */}
      <div className="space-y-4 px-5 py-4">
        {panel.questions.map((q, qi) => (
          <div key={q.id}>
            <div className="mb-2 text-sm font-medium text-[#2D2B27]">
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
                          : "border-[#E5E2D9] bg-[#FAF9F7] hover:border-[#D6D3CE]"
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
                        <div className="text-[#2D2B27]">{opt.label}</div>
                        {opt.description && (
                          <div className="mt-0.5 text-[11px] text-[#8B8884]">{opt.description}</div>
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
                          : "border-[#E5E2D9] bg-[#FAF9F7] hover:border-[#D6D3CE]"
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
                      <span className="text-[#2D2B27]">其他</span>
                    </label>
                    {answers[q.id] === "__other__" && (
                      <input
                        type="text"
                        value={otherInputs[q.id] ?? ""}
                        onChange={(e) => setOther(q.id, e.target.value)}
                        placeholder="请输入…"
                        className="mt-1.5 ml-7 w-full rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-1.5 text-sm focus:border-[#D97757] focus:outline-none"
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
                          : "border-[#E5E2D9] bg-[#FAF9F7] hover:border-[#D6D3CE]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleOption(q.id, opt.id)}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#D97757]"
                      />
                      <div>
                        <div className="text-[#2D2B27]">{opt.label}</div>
                        {opt.description && (
                          <div className="mt-0.5 text-[11px] text-[#8B8884]">{opt.description}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
                {q.allow_other && (
                  <div>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-2 text-sm hover:border-[#D6D3CE]">
                      <input
                        type="checkbox"
                        checked={((answers[q.id] as string[]) ?? []).includes("__other__")}
                        onChange={() => toggleOption(q.id, "__other__")}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#D97757]"
                      />
                      <span className="text-[#2D2B27]">其他</span>
                    </label>
                    {((answers[q.id] as string[]) ?? []).includes("__other__") && (
                      <input
                        type="text"
                        value={otherInputs[q.id] ?? ""}
                        onChange={(e) => setOther(q.id, e.target.value)}
                        placeholder="请输入…"
                        className="mt-1.5 ml-7 w-full rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-1.5 text-sm focus:border-[#D97757] focus:outline-none"
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
                  className="w-full resize-none rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-2 text-sm focus:border-[#D97757] focus:outline-none"
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
      <div className="border-t border-[#E5E2D9] px-5 py-3">
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
      <div className="rounded-full border border-[#E5E2D9] bg-zinc-900/50 p-4">
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
      <div className="mt-2 grid gap-1 text-[11px] text-[#A8A29E]">
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
      className="flex items-center gap-2.5 rounded-md border border-[#D97757]/20 bg-gradient-to-r from-emerald-950/20 to-zinc-900/40 px-3 py-2 text-xs"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#D97757]" />
      </span>
      <Sparkles className="h-3 w-3 text-[#D97757]/70" />
      <span className="text-[#2D2B27]">{status || "agent is working…"}</span>
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
        <AssistantRow text={ev.text ?? ""} streaming={false} />
      );
    case "tool-call":
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

function UserRow({ text }: { text: string }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 pt-0.5 text-[#D97757]">&gt;</span>
      <div className="flex-1 whitespace-pre-wrap break-words text-[#1A1815]">
        {text}
      </div>
    </div>
  );
}

function AssistantRow({ text, streaming }: { text: string; streaming: boolean }) {
  // Always render Markdown (real-time), but defer the parse so streaming
  // tokens don't block the input. useDeferredValue lets React batch updates
  // and drop intermediate renders if the main thread is busy.
  const deferredText = useDeferredValue(text);
  const isStale = deferredText !== text;
  if (!text) return null;
  return (
    <div className="flex gap-2">
      <span className="shrink-0 pt-0.5 text-[#8B7355]">⟫</span>
      <div className="flex-1 min-w-0 break-words text-[#2D2B27]" style={{ opacity: isStale ? 0.95 : 1 }}>
        <MarkdownRenderer text={streaming ? deferredText : text} />
        {streaming && (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-emerald-400 align-middle" />
        )}
      </div>
    </div>
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
      className="rounded-md border border-[#E5E2D9] bg-gradient-to-r from-amber-950/15 to-zinc-900/30 px-3 py-2 text-xs"
      style={{ borderLeft: "3px solid rgba(217, 119, 6, 0.5)" }}
    >
      <div className="flex items-center gap-2 text-[#B87B5A]">
        <Wrench className="h-3.5 w-3.5" />
        <span className="font-semibold tracking-wide">tool · {name}</span>
      </div>
      <div className="mt-1.5 space-y-0.5 pl-5 text-[#6B6862]">
        {Object.entries(args).slice(0, 6).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="text-[#8B8884]">{k}:</span>
            <span className="flex-1 break-all text-[#3D3B37]">
              {formatArgValue(v)}
            </span>
          </div>
        ))}
        {Object.keys(args).length > 6 && (
          <div className="text-[#A8A29E]">… {Object.keys(args).length - 6} more</div>
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
      className="overflow-hidden rounded-md border border-[#E5E2D9] bg-[#FFFFFF] text-xs shadow-sm"
    >
      {/* Header — tool name + status */}
      <div className="flex items-center gap-2 bg-gradient-to-r from-amber-950/15 to-zinc-900/30 px-3 py-2">
        <Wrench className="h-3.5 w-3.5 text-[#B87B5A]" />
        <span className="font-semibold tracking-wide text-[#B87B5A]">
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
        <div className="border-b border-[#E5E2D9] px-3 py-1.5 text-[#6B6862]">
          {Object.entries(args).slice(0, 6).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="shrink-0 text-[#8B8884]">{k}:</span>
              <span className="break-all text-[#3D3B37]">
                {formatArgValue(v)}
              </span>
            </div>
          ))}
          {Object.keys(args).length > 6 && (
            <div className="text-[#A8A29E]">
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
              className="flex items-center gap-1 truncate rounded px-1 text-[#8B7355] hover:bg-[#F0EDE5]"
              title="Open in editor"
            >
              <FileText className="h-3 w-3" />
              <span className="truncate">{showPath}</span>
            </button>
          )}
          {!result.diff && !isPlan && output && (
            <span className="text-[10px] text-[#A8A29E]">
              {outputLineCount} line{outputLineCount !== 1 ? "s" : ""}
            </span>
          )}
          {!isPlan && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="ml-auto text-[#8B8884] hover:text-[#3D3B37]"
            >
              {collapsed ? "show" : "hide"}
            </button>
          )}
        </div>

        {isPlan ? (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-[#D97757]">📋</span>
            <span className="text-[#6B6862]">Plan updated. </span>
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
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-[#6B6862] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE]">
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
          ? "border-[#E5E2D9] bg-[#F5F3EE]"
          : "border-[#E54D2E]/20 bg-[#E54D2E]/5",
      )}
    >
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#D97757]" />
        ) : (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-[#E54D2E]" />
        )}
        <span className="font-semibold text-[#3D3B37]">
          {ok ? "result" : "failed"} · {name}
        </span>
        {showPath && !isPlan && (
          <button
            onClick={() => select(showPath)}
            className="ml-1 flex items-center gap-1 truncate rounded px-1 text-[#8B7355] hover:bg-[#F0EDE5]"
            title="Open in editor"
          >
            <FileText className="h-3 w-3" />
            <span className="truncate">{showPath}</span>
          </button>
        )}
        {!diff && !isPlan && output && (
          <span className="text-[10px] text-[#A8A29E]">
            {outputLineCount} line{outputLineCount !== 1 ? "s" : ""}
          </span>
        )}
        {!isPlan && (
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="ml-auto text-[#8B8884] hover:text-[#3D3B37]"
          >
            {collapsed ? "show" : "hide"}
          </button>
        )}
      </div>

      {isPlan ? (
        <div className="mt-2 flex items-center gap-2 pl-5 text-xs">
          <span className="text-[#D97757]">📋</span>
          <span className="text-[#6B6862]">Plan updated. </span>
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
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words pl-5 text-[#6B6862] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE]">
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
      className="flex items-center gap-1.5 rounded-full border border-[#D97757]/20 bg-[#D97757]/8 px-2.5 py-1 text-[11px] font-medium text-[#B87B5A] hover:bg-[#D97757]/15"
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
    <div className="rounded-md border border-[#E5E2D9] bg-[#F5F3EE] px-3 py-2 text-xs text-[#6B6862]">
      <span className="text-[#8B8884]">[system]</span> {text}
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
    <div className="overflow-x-auto rounded border border-[#E5E2D9] bg-[#FFFFFF] text-[11px] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE]">
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
              <td className="w-8 select-none border-r border-[#E5E2D9] px-1 text-right text-[#A8A29E]">
                {row.leftNum ?? ""}
              </td>
              <td className="w-8 select-none border-r border-[#E5E2D9] px-1 text-right text-[#A8A29E]">
                {row.rightNum ?? ""}
              </td>
              <td
                className={cn(
                  "whitespace-pre-wrap break-all px-2",
                  row.type === "add" && "text-emerald-300",
                  row.type === "del" && "text-[#E54D2E]",
                  row.type === "ctx" && "text-[#6B6862]",
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

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-3 mb-2 text-lg font-bold text-[#1A1815]">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-2 text-base font-semibold text-[#1A1815]">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2 mb-1 text-sm font-semibold text-[#2D2B27]">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-2 mb-1 text-sm font-semibold text-[#3D3B37]">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="my-1.5 leading-relaxed text-[#2D2B27]">{children}</p>
  ),
  ul: ({ children, ...props }) => {
    // task list?
    const items = Array.isArray(children) ? children : [children];
    return (
      <ul className="my-1.5 ml-4 list-disc space-y-0.5 text-[#2D2B27]" {...props}>
        {children}
      </ul>
    );
  },
  ol: ({ children, ...props }) => (
    <ol className="my-1.5 ml-4 list-decimal space-y-0.5 text-[#2D2B27]" {...props}>
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
      className="text-[#8B7355] underline decoration-sky-700 hover:decoration-sky-400"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[#1A1815]">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-[#3D3B37]">{children}</em>,
  del: ({ children }) => (
    <del className="text-[#8B8884] line-through">{children}</del>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[#E5E2D9] pl-3 text-[#6B6862] italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-[#E5E2D9]" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-[#E5E2D9]">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-2 py-1 text-left font-semibold text-[#2D2B27]">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1 border-t border-[#E5E2D9] text-[#3D3B37]">{children}</td>
  ),
  // Inline code
  code: ({ className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || "");
    const isInline = !match && !String(children).includes("\n");
    if (isInline) {
      return (
        <code
          className="rounded bg-[#F0EDE5] px-1 py-0.5 text-[12px] text-emerald-300 font-mono"
          {...props}
        >
          {children}
        </code>
      );
    }
    // Fenced code block — render with Prism
    const lang = match?.[1] ?? "text";
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
    return (
      <div className="my-2 overflow-hidden rounded-md border border-[#E5E2D9] bg-[#FFFFFF]">
        <div className="flex items-center justify-between border-b border-[#E5E2D9] px-3 py-1 text-[10px] uppercase tracking-wider text-[#8B8884]">
          <span>{lang}</span>
          <button
            onClick={() => {
              if (codeText) navigator.clipboard?.writeText(codeText);
            }}
            className="text-[#A8A29E] hover:text-[#3D3B37]"
            title="Copy"
          >
            copy
          </button>
        </div>
        <pre className="overflow-x-auto px-3 py-2 text-[12px] leading-relaxed [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE]">
          {children}
        </pre>
      </div>
    );
  },
};

const MarkdownRenderer = memo(function MarkdownRenderer({
  text,
}: {
  text: string;
}) {
  return (
    <div className="prose-invert max-w-none break-words text-[13px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
