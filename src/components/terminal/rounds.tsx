"use client";

import { useRef, useEffect, useDeferredValue, useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { lineDiff } from "@/lib/diff";
import { Dots } from "@/components/ui/dots";
import { AppIcon } from "@/components/ui/app-icon";
import { fadeUp, reveal, springPop } from "@/lib/motion";
import { useSession } from "@/store/session";
import { useVfsView } from "@/store/vfs-view";
import { toast } from "sonner";
import { getFileIcon } from "@/lib/file-icon";
import { DiffView } from "./diff-view";
import { MarkdownRenderer, CopyButton } from "./markdown";
import { CheckCircle2, X, ChevronRight, Wrench, Hammer,
  Sparkles, RefreshCw, Brain, FilePen,
  FilePlus, FolderSearch, ThumbsUp, ThumbsDown, Terminal as TerminalIcon} from "lucide-react";
import type { SessionEvent } from "@/store/session";

// ---------------------------------------------------------------------------
// Group tool-call + tool-result into pairs for merged rendering.
// Each tool-call claims the first unclaimed tool-result after it with the
// same toolName, handling both single and concurrent same-name tools.
// ---------------------------------------------------------------------------

export function groupToolEvents(
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

export interface TurnGroup {
  kind: "turn";
  id: string;
  analysis: string;
  reasoning?: string;
  durationMs?: number;
  tools: (SessionEvent & { pairedResult?: SessionEvent })[];
}

export type GroupedEvent = (SessionEvent & { pairedResult?: SessionEvent }) | TurnGroup;

export function groupAssistantTurns(
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
      open = {
        kind: "turn",
        id: ev.id,
        analysis: ev.text ?? "",
        reasoning: ev.reasoning,
        durationMs: ev.durationMs,
        tools: [],
      };
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
// 整轮分组：用户消息之后、下一用户消息之前的所有内容 = 一个「轮次」。
// 轮次 = 执行轨迹（turn 序列，可折叠隐藏）+ 收尾总结（无后续工具的最后一条
// assistant-message，始终可见）。ZCode 式对话折叠的基础。
// ---------------------------------------------------------------------------
export interface RoundGroup {
  kind: "round";
  id: string;
  turns: TurnGroup[];
  summary: (SessionEvent & { pairedResult?: SessionEvent }) | null;
}

export type RenderedEvent = (SessionEvent & { pairedResult?: SessionEvent }) | RoundGroup;

export function groupRounds(events: GroupedEvent[]): RenderedEvent[] {
  const result: RenderedEvent[] = [];
  let open: RoundGroup | null = null;

  const close = (): void => {
    if (!open) return;
    result.push(open);
    open = null;
  };

  for (const ev of events) {
    if (ev.kind === "turn") {
      if (!open || open.summary) {
        close();
        open = { kind: "round", id: ev.id, turns: [], summary: null };
      }
      open.turns.push(ev);
      continue;
    }
    if (ev.kind === "assistant-message") {
      if (!open) {
        open = { kind: "round", id: ev.id, turns: [], summary: ev };
        continue;
      }
      if (open.summary) {
        // 连续两条纯文本消息 → 各自成轮（ZCode 里每条消息一个头部）
        close();
        open = { kind: "round", id: ev.id, turns: [], summary: ev };
        continue;
      }
      open.summary = ev;
      continue;
    }
    // user / error / system / 游离工具事件 → 关轮，独立渲染
    close();
    result.push(ev);
  }
  close();
  return result;
}

// ---------------------------------------------------------------------------
// TurnBlock — a collapsed "process" card: one assistant analysis message plus
// the tool calls that followed it. Default collapsed: the English analysis
// between tool calls stops being the main event; click to expand.
// ---------------------------------------------------------------------------

// 轮次级汇总：工具调用次数 / 改动文件数 / 真实 +/- 行数（供收起态显示总结行）
function turnStats(turn: TurnGroup): { calls: number; fileSet: Set<string>; add: number; rem: number } | null {
  let calls = 0;
  const fileSet = new Set<string>();
  let add = 0;
  let rem = 0;
  for (const ev of turn.tools) {
    if (ev.kind !== "tool-call") continue;
    calls++;
    const diff = ev.pairedResult?.diff ?? null;
    if (!diff) continue;
    fileSet.add(diff.path);
    const rows = lineDiff(
      diff.before.length === 0 ? [] : diff.before.split("\n"),
      diff.after.split("\n"),
    );
    add += rows.filter((r) => r.type === "add").length;
    rem += rows.filter((r) => r.type === "del").length;
  }
  return calls > 0 ? { calls, fileSet, add, rem } : null;
}

// 单段执行内容（叙述 + 思考过程 + 工具步骤卡）——不自带头部，由 RoundBlock 统一折叠
export function TurnBlock({ turn }: { turn: TurnGroup }) {
  return (
    <div className="space-y-1.5">
      {/* 叙述文字：AI 的输出内容，在其应有的位置展示（不并入思考） */}
      {turn.analysis && (
        <div className="px-1 text-[#262626] dark:text-zinc-100">
          <MarkdownRenderer text={turn.analysis} />
        </div>
      )}
      {/* 思考过程：独立步骤，默认收起 */}
      {turn.reasoning && turn.reasoning.trim().length > 0 && (
        <ThinkingStep text={turn.reasoning} streaming={false} durationMs={turn.durationMs} />
      )}
      {/* 工具：每个动作一行可折叠步骤卡（运行中显示 xx中） */}
      {turn.tools.map((ev) =>
        ev.toolName === "dispatch_subagent" ? (
          <SubagentCard
            key={ev.id}
            eventId={ev.id}
            task={typeof ev.toolArgs?.task === "string" ? ev.toolArgs.task : ""}
            running={!ev.pairedResult}
          />
        ) : (
          <StepCard
            key={ev.id}
            name={ev.toolName!}
            args={ev.toolArgs ?? {}}
            result={ev.pairedResult}
          />
        ),
      )}
    </div>
  );
}

/**
 * 整轮渲染（ZCode 式对话折叠）：
 * 收起态 = 「已工作 X 秒 ⌄」+ 一行统计 + 最终总结（始终可见）；
 * 展开态 = 向下滑出完整执行轨迹（全部叙述 / 思考 / 工具步骤卡）。
 */
export function RoundBlock({
  round,
  canRegenerate,
  fullText,
  streaming,
  ctxPct,
}: {
  round: RoundGroup;
  canRegenerate?: boolean;
  fullText?: string;
  streaming: boolean;
  ctxPct?: number | null;
}) {
  const running = round.turns.some((t) => t.tools.some((ev) => !ev.pairedResult));
  // 整轮完成的判据：流已结束 && 所有工具都有结果 && 总结已落地。
  // 未完成（流式输出中 / 步与步之间）一律保持展开正常显示，结束才收起。
  const done = !streaming && !running && !!round.summary;
  const [expanded, setExpanded] = useState(() => !done);
  const wasDone = useRef(done);
  useEffect(() => {
    if (!wasDone.current && done) {
      // 微任务内收起（避免 effect 中同步 setState 的级联渲染；行为等价）
      queueMicrotask(() => setExpanded(false));
    }
    wasDone.current = done;
  }, [done]);
  const stats = useMemo(() => {
    let calls = 0;
    const fileSet = new Set<string>();
    let add = 0;
    let rem = 0;
    for (const t of round.turns) {
      const s = turnStats(t);
      if (!s) continue;
      calls += s.calls;
      s.fileSet.forEach((f) => fileSet.add(f));
      add += s.add;
      rem += s.rem;
    }
    return calls > 0 ? { calls, files: fileSet.size, add, rem } : null;
  }, [round]);
  // 该轮合计耗时（各片段 + 收尾总结的 duration 相加）
  const totalMs = useMemo(() => {
    let ms = 0;
    let n = 0;
    for (const t of round.turns) {
      if (t.durationMs != null) {
        ms += t.durationMs;
        n++;
      }
    }
    if (round.summary?.durationMs != null) {
      ms += round.summary.durationMs;
      n++;
    }
    return n > 0 ? ms : null;
  }, [round]);
  const summarize = round.summary?.text?.trim() ? round.summary.text : null;
  const regenerate = useSession((s) => s.regenerate);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="space-y-1.5"
    >
      {/* 「已工作 X 秒」整轮折叠头：收起=只看总结；展开=向下弹出完整执行详情 */}
      {(totalMs != null || running) && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 pl-1 text-[12px] text-zinc-500 transition-colors hover:text-zinc-300"
          title={expanded ? "收起执行详情" : "展开执行详情"}
        >
          <span className="tabular-nums">已工作 {running && totalMs == null ? "…" : formatDuration(totalMs ?? 0)}</span>
          <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
          {ctxPct != null && (
            <span className="ml-1 flex items-center gap-1" title={`上下文占用约 ${ctxPct}%`}>
              <span className="h-[3px] w-16 overflow-hidden rounded-full bg-[#2A2A2A]">
                <span
                  className={cn(
                    "block h-full rounded-full transition-[width] duration-700",
                    ctxPct >= 90 ? "bg-[#E54D2E]" : ctxPct >= 70 ? "bg-[#E8A87C]" : "bg-[#E58F67]/80",
                  )}
                  style={{ width: `${ctxPct}%` }}
                />
              </span>
              <span className="text-[10px] tabular-nums text-zinc-600">{ctxPct}%</span>
            </span>
          )}
        </button>
      )}
      <AnimatePresence initial={false}>
        {expanded && (
          /* 展开态：完整执行轨迹（左侧时间线描边）——点「已工作 X 秒」向下弹出 */
          <motion.div
            key="trace"
            initial={reveal.initial}
            animate={reveal.animate}
            exit={reveal.exit}
            transition={reveal.transition}
            className="overflow-hidden"
          >
            <div className="ml-0.5 space-y-2.5 border-l border-[#333333] pl-2.5">
              {round.turns.map((t) => (
                <TurnBlock key={t.id} turn={t} />
              ))}
              {round.summary?.reasoning && round.summary.reasoning.trim().length > 0 && (
                <ThinkingStep
                  text={round.summary.reasoning}
                  streaming={false}
                  durationMs={round.summary.durationMs}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!expanded && stats && (
        /* 收起态：一行统计（改动文件数 / +N -M） */
        <div className="flex items-center gap-1.5 pl-1 text-[12px] text-zinc-500">
          <span>
            {stats.files > 0 ? `${stats.files} 个文件已更改` : `${stats.calls} 次工具调用`}
          </span>
          {(stats.add > 0 || stats.rem > 0) && (
            <span className="font-mono text-[10px]">
              <span className="text-emerald-400">+{stats.add}</span>{" "}
              <span className="text-red-400">-{stats.rem}</span>
            </span>
          )}
        </div>
      )}
      {/* 最终总结：始终可见（折叠时即唯一主体） */}
      {summarize && (
        <div className="min-w-0 break-words text-[#262626] dark:text-zinc-100">
          <MarkdownRenderer text={summarize} />
        </div>
      )}
      {!running && round.summary && (
        <div className="flex items-center gap-0.5 pl-1 text-[#A6A6A6] dark:text-zinc-500">
          <CopyButton text={fullText || round.summary.text || ""} />
          <button
            onClick={() => toast.info("感谢反馈，这对我们很有帮助")}
            className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-[#F0F0F0] hover:text-[#383838] dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-300"
            title="有帮助"
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => toast.info("已记录反馈")}
            className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-[#F0F0F0] hover:text-[#383838] dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-300"
            title="没帮助"
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
          {canRegenerate && (
            <button
              onClick={() => void regenerate()}
              className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-[#F0F0F0] hover:text-[#383838] dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-300"
              title="重新生成"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          {round.summary.ts && (
            <span className="pl-1 text-[10px]">
              {new Date(round.summary.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}

/** 把模型列表按 provider（"/" 前的部分）分组，用于模型选择菜单。 */

// ---------------------------------------------------------------------------
// ZCode 式逐步卡片：每个工具/思考动作一行，默认收起，点开看细节；
// 运行中显示「xx中」并强制展开 + 呼吸动画，完成后显示「已xx」并收起。
// ---------------------------------------------------------------------------
function stepMeta(name: string): {
  icon: typeof Wrench;
  running: string;
  done: string;
  kind: "terminal" | "edit" | "write" | "explore" | "tool";
} {
  switch (name) {
    case "bash":
      return { icon: TerminalIcon, running: "执行中", done: "已执行", kind: "terminal" };
    case "edit_file":
    case "multi_edit":
    case "apply_patch":
    case "insert_at":
    case "undo_edit":
      return { icon: FilePen, running: "编辑中", done: "已编辑", kind: "edit" };
    case "write_file":
    case "append_file":
      return { icon: FilePlus, running: "写入中", done: "已写入", kind: "write" };
    case "read_file":
    case "glob":
    case "search_files":
    case "search_symbols":
    case "list_files":
    case "list_dirs":
    case "view_outline":
    case "read_multiple_files":
      return { icon: FolderSearch, running: "探索中", done: "探索", kind: "explore" };
    case "list_skills":
    case "load_skill":
    case "read_skill_file":
      return { icon: Sparkles, running: "读取中", done: "已加载", kind: "explore" };
    case "create_skill":
    case "delete_skill":
      return { icon: Sparkles, running: "整理中", done: "已整理", kind: "write" };
    default:
      return { icon: Hammer, running: "执行中", done: name, kind: "tool" };
  }
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

/**
 * Semantic tone for a tool result — Codex-style color grammar so the eye
 * reads success/failure/warning at a glance without reading a word.
 * "err": `ok:false` events or output that obviously failed (exit code,
 * "Error:" prefix, exception). "warn": exit code/`warning` mentions that
 * still succeeded. null: neutral (default gray).
 */
function resultTone(output: string, ok: boolean): "err" | "warn" | null {
  if (!ok) return "err";
  const s = output.toLowerCase();
  if (/\(exit code \d+\)/i.test(output) && !/\(exit code 0\)/i.test(output)) return "err";
  if (/^error|error:|exception|failed|失败/.test(s)) return "err";
  if (/warning|警告|提示/.test(s)) return "warn";
  return null;
}

/** Tailwind text class for a result tone (dark-first). */
function toneText(tone: "err" | "warn" | null): string {
  if (tone === "err") return "text-[#E54D2E] dark:text-[#E56A50]";
  if (tone === "warn") return "text-amber-600 dark:text-amber-400";
  return "text-[#A6A6A6]";
}

export function ThinkingStep({ text, streaming, durationMs }: { text: string; streaming: boolean; durationMs?: number }) {
  const deferredText = useDeferredValue(text);
  const isStale = deferredText !== text;
  const [collapsed, setCollapsed] = useState(true);
  const preview = text.split("\n").find((l) => l.trim()) ?? text;
  const shown = streaming ? deferredText : text;
  return (
    <motion.div
      initial={{ opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
    >
      <button
        onClick={() => !streaming && setCollapsed((c) => !c)}
        disabled={streaming}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/5 disabled:cursor-default dark:hover:bg-white/5"
      >
        <ChevronRight className={cn("h-3 w-3 shrink-0 text-[#8C8C8C] transition-transform", !collapsed && "rotate-90")} />
        <AppIcon icon={Brain} size={14} className={streaming ? "text-[#E58F67]" : "text-[#A6A6A6]"} />
        <span className={cn("shrink-0 font-medium", streaming ? "text-shimmer" : "text-[#8C8C8C]")}>
          {streaming ? "思考中" : `思考过程${durationMs != null ? ` 持续了 ${formatDuration(durationMs)}` : ""}`}
        </span>
        {streaming && <Dots className="pl-1" />}
        {!streaming && collapsed && <span className="min-w-0 truncate pl-1 text-[#A6A6A6]">{preview}</span>}
        {!streaming && <span className="ml-auto text-[#8C8C8C]">{collapsed ? "展开" : "收起"}</span>}
      </button>
      {(!collapsed || streaming) && (
        <pre
          className="ml-6 mb-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[#333333] bg-[#0A0A0A] px-3 py-2.5 font-mono text-xs leading-relaxed text-[#A6A6A6] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#333333]"
          style={{ opacity: isStale ? 0.9 : 1 }}
        >
          {shown}
        </pre>
      )}
    </motion.div>
  );
}

export function StepCard({
  name,
  args,
  result,
}: {
  name: string;
  args: Record<string, unknown>;
  result?: SessionEvent | null;
}) {
  const meta = stepMeta(name);
  const running = !result;
  const [collapsed, setCollapsed] = useState(true);
  const expanded = running || !collapsed;
  const ok = result?.ok ?? false;
  const output = result?.toolOutput ?? "";
  const tone = resultTone(output, ok);
  const diff = result?.diff ?? null;
  const path = diff?.path ?? (typeof args.path === "string" ? args.path : null);
  const command = typeof args.command === "string" ? args.command : null;
  // 有文件路径时用按扩展名区分的专业文件图标（如 .tsx→FileCode2）
  const Icon = path ? getFileIcon(path) : meta.icon;

  let metaText = "";
  let statAdd = 0;
  let statRem = 0;
  if (meta.kind === "terminal") {
    // 摘要不显示命令——命令只在点开后出现
    metaText = "";
  } else if ((meta.kind === "edit" || meta.kind === "write") && path) {
    // 已编辑：先文件，再目录，再真实 +/-行数（+N 绿 / -M 红）
    const base = path.split("/").pop() ?? path;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    metaText = [base, dir].filter(Boolean).join(" ");
    if (diff) {
      const rows = lineDiff(
        diff.before.length === 0 ? [] : diff.before.split("\n"),
        diff.after.split("\n"),
      );
      statAdd = rows.filter((r) => r.type === "add").length;
      statRem = rows.filter((r) => r.type === "del").length;
    }
  } else if (meta.kind === "explore") {
    // 探索收敛：N 文件（读文件）/ N 搜索（搜索类命令）
    const isSearch = name === "search_files" || name === "search_symbols";
    const matches = output.split("\n").filter((l) => l.trim()).length;
    const count =
      name === "read_file" || name === "view_outline" ? 1 : matches;
    metaText = count > 0 ? `${count} ${isSearch ? "搜索" : "文件"}` : "";
  } else if (path) {
    metaText = path;
  }

  return (
    <motion.div
      initial={fadeUp.initial}
      animate={fadeUp.animate}
      transition={fadeUp.transition}
      className="group/step"
    >
      <button
        onClick={() => !running && setCollapsed((c) => !c)}
        disabled={running}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-[transform,color,background-color] duration-150 hover:bg-white/5 disabled:cursor-default group-hover/step:-translate-y-px dark:hover:bg-white/5"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-[#8C8C8C] transition-transform", expanded && "rotate-90")} />
        <AppIcon icon={Icon} size={14} className={running ? "text-[#E58F67]" : "text-[#A6A6A6]"} />
        <span className={cn("shrink-0", running ? "text-shimmer font-medium" : "text-[#8C8C8C] font-medium")}>
          {running ? meta.running : meta.done}
        </span>
        {!running && ok === false && (
          <motion.span
            key="fail"
            initial={springPop.initial}
            animate={springPop.animate}
            transition={springPop.transition}
            className="shrink-0 text-[#E54D2E]"
            title="失败"
          >
            <X className="h-3 w-3" />
          </motion.span>
        )}
        {metaText && <span className="min-w-0 truncate font-mono text-[#A6A6A6]">{metaText}</span>}
        {(statAdd > 0 || statRem > 0) && (
          <span className="shrink-0 font-mono text-[10px]">
            <span className="text-emerald-400">+{statAdd}</span>{" "}
            <span className="text-red-400">-{statRem}</span>
          </span>
        )}
        {running && <Dots className="ml-auto" />}
        {!running && <span className="ml-auto text-[#8C8C8C]">{expanded ? "收起" : "展开"}</span>}
      </button>
      {expanded && (
        <div className="ml-6 mb-1 overflow-hidden rounded-lg border border-[#333333] bg-[#0A0A0A]">
          {running ? (
            <div className="space-y-0.5 px-3 py-2 text-xs">
              {Object.entries(args).slice(0, 6).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="shrink-0 text-[#8C8C8C]">{k}:</span>
                  <span className="break-all text-[#A6A6A6]">{formatArgValue(v)}</span>
                </div>
              ))}
            </div>
          ) : result?.plan ? (
            <div className="px-3 py-2 text-xs text-[#A6A6A6]">计划已更新 · 可在右侧 Plan 面板查看</div>
          ) : diff ? (
            <DiffView before={diff.before} after={diff.after} />
          ) : output ? (
            <div className="px-3 py-2">
              {meta.kind === "terminal" && command && (
                <div className="mb-1.5 font-mono text-xs text-[#8C8C8C]">$ {command}</div>
              )}
              <pre className={cn("max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#333333]", toneText(tone))}>
                {output}
              </pre>
            </div>
          ) : (
            <div className={cn("px-3 py-2 text-xs", ok ? "text-emerald-500 dark:text-[#34d399]" : "text-[#E54D2E]")}>
              {ok ? "完成" : "失败"}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
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

export function SubagentCard({
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
      className="flex w-full items-center gap-2 rounded-md border border-[#E58F67]/25 bg-[#E58F67]/5 px-3 py-2 text-left text-xs transition-colors hover:bg-[#E58F67]/10"
      title="查看子智能体详情"
    >
      {running ? (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E58F67] opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E58F67]" />
        </span>
      ) : (
        <AppIcon icon={CheckCircle2} size={14} className="text-[#34d399]" />
      )}
      <span className="shrink-0 font-semibold text-[#383838]">子智能体</span>
      <span className="shrink-0 rounded bg-[#0D9488]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0F766E]">
        Explore
      </span>
      <span className="shrink-0 text-[#A6A6A6] dark:text-zinc-600">·</span>
      <span className="min-w-0 flex-1 truncate text-[#6B6B6B] dark:text-zinc-400">
        {title || "探索任务"}
      </span>
      {running ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[#E58F67]">
          <span className="flex gap-0.5">
            <span className="h-1 w-1 animate-bounce rounded-full bg-[#E58F67]" style={{ animationDelay: "0ms" }} />
            <span className="h-1 w-1 animate-bounce rounded-full bg-[#E58F67]" style={{ animationDelay: "120ms" }} />
            <span className="h-1 w-1 animate-bounce rounded-full bg-[#E58F67]" style={{ animationDelay: "240ms" }} />
          </span>
          <span className="hidden sm:inline">运行中…</span>
        </span>
      ) : (
        <span className="shrink-0 text-[#A6A6A6]">查看详情 →</span>
      )}
    </motion.button>
  );
}
