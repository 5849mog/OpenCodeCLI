"use client";

/**
 * SubagentPanel — right-sidebar「子智能体」tab.
 *
 * Shows every dispatch_subagent run in the session as a card:
 * - 委派提示词 (the delegation prompt, stored in the tool-call's `task` arg)
 *   rendered like a user message (">" prefix), long content default-collapsed.
 * - 子代理最终回复 (the final summary, parsed out of the tool-result output)
 *   rendered like an assistant message ("⟫" prefix, Markdown), long content
 *   default-collapsed.
 * Plus meta: iterations / tool calls / completed status. Clicking a subagent
 * card in the main conversation focuses the matching run here.
 */

import { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, Search } from "lucide-react";
import { useSession, type SessionEvent } from "@/store/session";
import { useVfsView } from "@/store/vfs-view";
import { cn } from "@/lib/utils";
import { CollapsibleText } from "./collapsible-text";
import { MarkdownRenderer } from "./terminal";

interface SubagentRun {
  /** tool-call event id — also the focus key. */
  id: string;
  task: string;
  running: boolean;
  completed: boolean;
  iterations: number;
  toolCalls: number;
  summary: string;
  ok: boolean;
  ts: number;
}

/** Parse a dispatch_subagent tool-result output into meta + summary text. */
function parseOutput(output: string): {
  completed: boolean;
  iterations: number;
  toolCalls: number;
  summary: string;
} {
  const summary = output.split("--- Subagent summary ---").pop()?.trim() ?? "";
  const completed = /Subagent completed/.test(output);
  const iterMatch = output.match(/after (?:(\d+) iterations?)/);
  const callsMatch = output.match(/(\d+) tool calls?/);
  return {
    completed,
    iterations: iterMatch ? parseInt(iterMatch[1], 10) : 0,
    toolCalls: callsMatch ? parseInt(callsMatch[1], 10) : 0,
    summary,
  };
}

/** Pair each dispatch_subagent tool-call with its first matching tool-result. */
function buildRuns(events: SessionEvent[]): SubagentRun[] {
  const claimed = new Set<string>();
  const runs: SubagentRun[] = [];
  for (const ev of events) {
    if (ev.kind !== "tool-call" || ev.toolName !== "dispatch_subagent") continue;
    const task = typeof ev.toolArgs?.task === "string" ? ev.toolArgs.task : "";
    const match = events.find(
      (e) =>
        e.kind === "tool-result" &&
        e.toolName === "dispatch_subagent" &&
        !claimed.has(e.id),
    );
    if (match) {
      claimed.add(match.id);
      const parsed = parseOutput(match.toolOutput ?? "");
      runs.push({
        id: ev.id,
        task,
        running: false,
        completed: parsed.completed,
        iterations: parsed.iterations,
        toolCalls: parsed.toolCalls,
        summary: parsed.summary,
        ok: !!match.ok,
        ts: ev.ts,
      });
    } else {
      runs.push({
        id: ev.id,
        task,
        running: true,
        completed: false,
        iterations: 0,
        toolCalls: 0,
        summary: "",
        ok: true,
        ts: ev.ts,
      });
    }
  }
  return runs.reverse(); // newest first
}

export function SubagentPanel() {
  const events = useSession((s) => s.events);
  const focusId = useVfsView((s) => s.subagentFocus);
  const runs = useMemo(() => buildRuns(events), [events]);
  const focusRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the focused run into view when the panel opens.
  useEffect(() => {
    if (focusId && focusRef.current) {
      focusRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [focusId]);

  return (
    <div className="flex h-full flex-col bg-[#FFFFFF]">
      {/* Sticky header */}
      <div className="flex items-center gap-2 border-b border-[#E5E2D9] px-5 py-3">
        <span className="relative flex h-2 w-2">
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#14B8A6]" />
        </span>
        <h2 className="text-sm font-semibold text-[#2D2B27]">子智能体</h2>
        <span className="ml-auto rounded bg-[#0D9488]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#0F766E]">
          Explore
        </span>
      </div>

      {/* Scrollable runs */}
      <div className="flex-1 overflow-y-auto px-4 py-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE]">
        {runs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="rounded-full border border-[#E5E2D9] bg-[#FAF9F7] p-4">
              <Search className="h-8 w-8 text-[#0D9488]" />
            </div>
            <div className="text-sm text-[#3D3B37]">还没有子智能体活动</div>
            <div className="max-w-xs text-xs text-[#8B8884]">
              让 AI 派一个 Explore 子智能体去做多文件研究——委派提示词和最终回复都会出现在这里。
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {runs.map((run) => (
              <RunCard key={run.id} run={run} focused={run.id === focusId} innerRef={run.id === focusId ? focusRef : undefined} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RunCard({
  run,
  focused,
  innerRef,
}: {
  run: SubagentRun;
  focused: boolean;
  innerRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <motion.div
      ref={innerRef}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "overflow-hidden rounded-lg border bg-[#FFFFFF]",
        focused
          ? "border-[#0D9488]/60 shadow-sm ring-1 ring-[#0D9488]/20"
          : "border-[#E5E2D9]",
      )}
    >
      {/* Card header */}
      <div className="flex items-center gap-2 border-b border-[#E5E2D9] bg-[#FAF9F7]/60 px-3 py-2 text-xs">
        {run.running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#14B8A6]" />
        ) : run.completed ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#14B8A6]" />
        ) : (
          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
            未完成
          </span>
        )}
        <span className="shrink-0 font-medium text-[#3D3B37]">
          {run.running ? "运行中" : run.completed ? "已完成" : "撞上限停止"}
        </span>
        <span className="ml-auto shrink-0 text-[#A8A29E] tabular-nums">
          {run.iterations > 0 && `${run.iterations} 迭代 · `}
          {run.toolCalls > 0 && `${run.toolCalls} 工具调用`}
        </span>
      </div>

      {/* Delegation prompt — rendered like a user message */}
      <div className="px-3 pt-2.5">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8B8884]">
            委派提示词
          </span>
        </div>
        <div className="group flex gap-2 rounded-md bg-[#F5F3EE]/70 px-2.5 py-2">
          <span className="shrink-0 pt-0.5 text-[#D97757]">&gt;</span>
          <div className="flex-1 min-w-0 text-[#1A1815]">
            <CollapsibleText text={run.task} threshold={280} />
          </div>
        </div>
      </div>

      {/* Final reply — rendered like an assistant message */}
      <div className="px-3 pb-3 pt-2.5">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8B8884]">
            子代理回复
          </span>
        </div>
        {run.summary ? (
          <div className="group flex gap-2">
            <span className="shrink-0 pt-0.5 text-[#8B7355]">⟫</span>
            <div className="flex-1 min-w-0 break-words text-[#2D2B27]">
              <CollapsibleText
                text={run.summary}
                threshold={280}
                render={(t) => <MarkdownRenderer text={t} />}
              />
            </div>
          </div>
        ) : run.running ? (
          <div className="flex items-center gap-2 pl-5 text-xs text-[#0F766E]">
            <span className="flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-[#14B8A6]" style={{ animationDelay: "0ms" }} />
              <span className="h-1 w-1 animate-bounce rounded-full bg-[#14B8A6]" style={{ animationDelay: "120ms" }} />
              <span className="h-1 w-1 animate-bounce rounded-full bg-[#14B8A6]" style={{ animationDelay: "240ms" }} />
            </span>
            子智能体正在工作中…
          </div>
        ) : (
          <div className="pl-5 text-xs text-[#A8A29E]">
            {run.ok ? "没有返回摘要。" : "子智能体失败，未返回摘要。"}
          </div>
        )}
        {!run.ok && !run.summary && !run.running && (
          <div className="mt-1 pl-5 text-xs text-[#A8A29E]">
            在事件流中找到 <code>tool · dispatch_subagent</code> 结果查看详情。
          </div>
        )}
      </div>
    </motion.div>
  );
}
