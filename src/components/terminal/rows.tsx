"use client";

import { useDeferredValue, useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { AppIcon } from "@/components/ui/app-icon";
import { fadeUpSmall } from "@/lib/motion";
import { useSession } from "@/store/session";
import { useVfsView } from "@/store/vfs-view";
import { getPlan, getPlanVersion, onPlanChange } from "@/lib/plan-store";
import { planStats } from "@/lib/plan-utils";
import { toast } from "sonner";
import { MarkdownRenderer, CopyButton } from "./markdown";
import { CollapsibleText } from "../collapsible-text";
import { ThinkingStep, formatDuration } from "./rounds";
import {
  ArrowUp, X, ChevronRight, XCircle, RefreshCw, ClipboardList, Pencil, ThumbsUp, ThumbsDown} from "lucide-react";

export function UserRow({
  text,
  attachments,
  eventId,
}: {
  text: string;
  attachments?: Array<{ name: string; path: string; dataUrl?: string; fileId?: string }>;
  eventId: string;
}) {
  const imgs = (attachments ?? []).filter((a) => a.dataUrl);
  const rewriteFromMessage = useSession((s) => s.rewriteFromMessage);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const submitEdit = () => {
    if (!draft.trim()) return;
    setEditing(false);
    void rewriteFromMessage(eventId, draft);
  };
  return (
    <div className="flex flex-col items-end gap-1">
      {imgs.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {imgs.map((a) => (
            <img
              key={a.path}
              src={a.dataUrl}
              alt={a.name}
              className="max-h-40 max-w-[240px] rounded-lg border border-[#DEDEDE] object-contain shadow dark:border-[#333333]"
            />
          ))}
        </div>
      )}
      {editing ? (
        <div className="w-full max-w-[80%] rounded-2xl rounded-br-md border border-[#E58F67]/40 bg-[#262626] px-4 py-2.5">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitEdit();
            }}
            rows={Math.min(8, Math.max(1, draft.split("\n").length))}
            className="w-full resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            placeholder="输入修改后的消息…"
          />
          <div className="mt-1.5 flex items-center justify-end gap-1.5">
            <button
              onClick={() => setEditing(false)}
              className="flex h-7 w-7 items-center justify-center rounded text-[#A6A6A6] transition-colors hover:bg-white/10"
              title="取消"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={submitEdit}
              disabled={!draft.trim()}
              className="flex h-7 w-7 items-center justify-center rounded bg-[#333333] text-zinc-200 transition-colors hover:bg-[#4a4740] disabled:opacity-40"
              title="发送并重新开始"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="max-w-[75%] rounded-[10px] bg-[#F5F5F5] px-4 py-2.5 text-[#262626] dark:bg-[#2A2A2A] dark:text-zinc-100">
            <CollapsibleText text={text} render={(t) => <MarkdownRenderer text={t} />} />
          </div>
          <div className="flex items-center gap-0.5 pr-1 text-[#A6A6A6] dark:text-zinc-500">
            <CopyButton text={text} />
            <button
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
              className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-[#F0F0F0] hover:text-[#383838] dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-300"
              title="修改"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function AssistantRow({
  text,
  reasoning,
  streaming,
  ts,
  canRegenerate,
  fullText,
  durationMs,
}: {
  text: string;
  reasoning?: string;
  streaming: boolean;
  ts?: number;
  canRegenerate?: boolean;
  fullText?: string;
  durationMs?: number;
}) {
  const deferredText = useDeferredValue(text);
  const isStale = deferredText !== text;
  const showReasoning = !!reasoning && reasoning.trim().length > 0;
  const regenerate = useSession((s) => s.regenerate);
  if (!text && !showReasoning) return null;
  return (
    <div className="flex flex-col gap-1">
      {/* 本轮工作耗时（ZCode 式「已工作 X 秒」） */}
      {!streaming && durationMs != null && durationMs > 0 && (
        <div className="flex items-center gap-1 pl-1 text-[12px] text-zinc-500" title="本轮工作耗时">
          <span>已工作 {formatDuration(durationMs)}</span>
          <ChevronRight className="h-3 w-3" />
        </div>
      )}
      <motion.div
        key={text ? "has-text" : "empty"}
        initial={text ? fadeUpSmall.initial : false}
        animate={fadeUpSmall.animate}
        transition={fadeUpSmall.transition}
        className="min-w-0 break-words text-[#262626] dark:text-zinc-100"
        style={{ opacity: isStale ? 0.95 : 1 }}
      >
        {showReasoning && <ThinkingStep text={reasoning!} streaming={streaming} durationMs={durationMs} />}
        {text && <MarkdownRenderer text={streaming ? deferredText : text} />}
        {streaming && (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-emerald-400 align-middle dark:bg-[#34d399]" />
        )}
      </motion.div>
      {!streaming && (
        <div className="flex items-center gap-0.5 pl-1 text-[#A6A6A6] dark:text-zinc-500">
          <CopyButton text={fullText || text || reasoning || ""} />
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
          {ts && (
            <span className="pl-1 text-[10px]">
              {new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SubagentCard — the dedicated「子智能体」card in the main conversation flow.
// Shows a teal dot + "子智能体" + cyan "Explore" tag + "·" + a short task
// title (first line of the delegation prompt). Running state shows animated
// dots; clicking the card opens the 子智能体 panel in the right sidebar.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PlanHeaderBadge — tiny plan progress pill for the header bar
// Subscribes to the plan store version so it updates in real-time whenever
// the plan changes (same reactivity as the full PlanPanel).
// ---------------------------------------------------------------------------

export function PlanHeaderBadge() {
  // 计划存于独立 plan store（不在 VFS）——订阅 planVersion 实时刷新。
  const [planVersion, setPlanVersion] = useState(getPlanVersion());
  useEffect(() => onPlanChange(() => setPlanVersion(getPlanVersion())), []);
  const stats = useMemo(() => {
    const content = getPlan();
    return content ? planStats(content) : null;
  }, [planVersion]);

  if (!stats) return null;

  return (
    <button
      onClick={() => useVfsView.getState().setRightPanelTab("plan")}
      className="flex items-center gap-1.5 rounded-full border border-[#E58F67]/20 bg-[#E58F67]/8 px-3 py-1.5 text-[length:var(--font-size-ui-sm)] font-medium text-[#B87B5A] hover:bg-[#E58F67]/15"
      title={`计划进度，点击查看计划面板 · ${stats.done}/${stats.total} 步完成`}
    >
      <ClipboardList className="h-3.5 w-3.5" />
      <span className="tabular-nums">{stats.done}/{stats.total}</span>
      <div className="h-1.5 w-10 overflow-hidden rounded-full bg-zinc-700">
        <div
          className="h-full rounded-full bg-[#E58F67] transition-all duration-300"
          style={{ width: `${stats.pct}%` }}
        />
      </div>
    </button>
  );
}

export function ErrorRow({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-[#E54D2E]/20 bg-[#E54D2E]/5 px-3 py-2 text-xs text-[#E54D2E]">
      <div className="flex items-center gap-2 font-semibold">
        <AppIcon icon={XCircle} size={14} />
        <span>error</span>
      </div>
      <pre className="mt-1 whitespace-pre-wrap break-words pl-5 text-[#E54D2E]">
        {text}
      </pre>
    </div>
  );
}

export function SystemRow({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-[#DEDEDE] bg-[#F5F5F5] px-3 py-2 text-xs text-[#6B6B6B] dark:border-[#333333] dark:bg-[#161616] dark:text-zinc-400">
      <span className="text-[#8C8C8C] dark:text-zinc-500">[system]</span> {text}
    </div>
  );
}
