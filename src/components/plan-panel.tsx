"use client";

/**
 * PlanPanel — a full-height persistent plan panel for the right sidebar.
 * Replaces the inline PlanView that used to live in the event stream.
 * Auto-updates when PLAN.md changes (via eventsLen trigger).
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { ClipboardList } from "lucide-react";
import { vfs } from "@/lib/vfs";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";
import {
  parsePlan,
  nodeStats,
  computeTotals,
  tagColor,
  type PlanNode,
} from "@/lib/plan-utils";

/** First in-progress node (fallback: first todo), depth-first. */
function findCurrentPath(nodes: PlanNode[]): string | null {
  for (const n of nodes) {
    if (n.status === "in-progress") return n.path;
  }
  for (const n of nodes) {
    if (n.status === "todo") return n.path;
  }
  for (const n of nodes) {
    const child = findCurrentPath(n.children);
    if (child) return child;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: PlanNode["status"] }) {
  if (status === "done") {
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[#E58F67] bg-[#E58F67] text-black">
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M2 6l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (status === "in-progress") {
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-amber-500/60 bg-amber-950/20 text-amber-400 text-[10px] font-bold">
        /
      </span>
    );
  }
  if (status === "blocked") {
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-zinc-600 bg-zinc-800 text-zinc-500 text-[10px] font-bold">
        –
      </span>
    );
  }
  // todo
  return (
    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[#E5E2D9] bg-transparent" />
  );
}

// ---------------------------------------------------------------------------
// Plan node row (recursive)
// ---------------------------------------------------------------------------

function PlanNodeRow({ node, depth, currentPath }: { node: PlanNode; depth: number; currentPath: string | null }) {
  const { total, done } = nodeStats(node);
  const hasChildren = node.children.length > 0;
  const padLeft = depth * 18;
  const isCurrent = currentPath !== null && node.path === currentPath;

  return (
    <>
      <li
        className={cn(
          "flex items-start gap-2.5 rounded-md border-l-2 border-transparent px-2 py-1.5 transition-colors hover:bg-[#F5F3EE] dark:hover:bg-[#262320]",
          node.status === "done" ? "text-[#8B8884] dark:text-zinc-500" : "text-[#2D2B27] dark:text-zinc-200",
          isCurrent && "border-l-[#E58F67] bg-[#E58F67]/5 dark:bg-[#E58F67]/10",
        )}
        style={{ paddingLeft: `${12 + padLeft}px` }}
      >
        {isCurrent && (
          <span className="relative mt-1.5 flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E58F67] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E58F67]" />
          </span>
        )}
        {/* key on status so the spring animation replays only when status changes */}
        <motion.span
          key={node.status}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
        >
          <StatusIcon status={node.status} />
        </motion.span>
        <span className={cn("flex-1 text-sm leading-relaxed", node.status === "done" && "line-through")}>
          {node.text}
        </span>
        {node.tags.length > 0 && (
          <span className="flex shrink-0 flex-wrap items-center gap-1">
            {node.tags.map((tag) => (
              <span
                key={tag}
                className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", tagColor(tag))}
              >
                {tag}
              </span>
            ))}
          </span>
        )}
        {hasChildren && (
          <span className="shrink-0 text-[11px] text-[#A8A29E] tabular-nums dark:text-zinc-500">
            {done}/{total}
          </span>
        )}
      </li>
      {node.children.map((child, i) => (
        <PlanNodeRow key={i} node={child} depth={depth + 1} currentPath={currentPath} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// PlanPanel
// ---------------------------------------------------------------------------

export function PlanPanel({ eventsLen }: { eventsLen: number }) {
  const mode = useSession((s) => s.mode);
  const parsed = useMemo(() => {
    const content = vfs.readFileSync("PLAN.md");
    if (!content) return null;
    return parsePlan(content);
  }, [eventsLen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!parsed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="rounded-full border border-[#E5E2D9] bg-[#FAF9F7] p-4 dark:border-[#3a3731] dark:bg-[#262320]">
          <ClipboardList className="h-8 w-8 text-[#E58F67]" />
        </div>
        <div className="text-sm text-[#3D3B37] dark:text-zinc-200">No plan yet</div>
        <div className="max-w-xs text-xs text-[#8B8884] dark:text-zinc-500">
          Ask the AI to create a plan. It will use <code className="text-[#E58F67]">update_plan</code> to build a structured checklist here.
        </div>
        {mode === "bypass" && (
          <div className="max-w-xs text-xs text-[#8B8884] dark:text-zinc-500">
            当前为 Bypass 模式，可直接让 AI 先用 <code className="text-[#E58F67]">update_plan</code> 规划再执行。
          </div>
        )}
      </div>
    );
  }

  const { sections, title } = parsed;
  const allNodes = sections.flatMap((s) => s.nodes);
  const { total, done } = computeTotals(allNodes);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const currentPath = findCurrentPath(allNodes);

  if (total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="rounded-full border border-[#E5E2D9] bg-[#FAF9F7] p-4 dark:border-[#3a3731] dark:bg-[#262320]">
          <ClipboardList className="h-8 w-8 text-[#E58F67]" />
        </div>
        <div className="text-sm text-[#3D3B37] dark:text-zinc-200">Plan is empty</div>
        <div className="max-w-xs text-xs text-[#8B8884] dark:text-zinc-500">
          PLAN.md exists but has no checklist items. Use <code className="text-[#E58F67]">- [ ]</code> syntax in Markdown.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sticky header */}
      <div className="border-b border-[#E5E2D9] bg-[#FFFFFF] px-5 py-4 dark:border-[#3a3731] dark:bg-[#161512]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-[#E58F67]" />
            <h2 className="text-sm font-semibold text-[#2D2B27] dark:text-zinc-100">{title}</h2>
          </div>
          <span className="font-mono text-xs text-[#8B8884] tabular-nums dark:text-zinc-500">
            {done}/{total} · {pct}%
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#F0EDE5] dark:bg-[#2a2723]">
          {/* key flips when plan completes → replays the emerald fade-in once */}
          <motion.div
            key={pct === 100 ? "done" : "running"}
            initial={pct === 100 ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            className={cn(
              "h-full rounded-full transition-all duration-500 ease-out",
              pct === 100
                ? "bg-gradient-to-r from-emerald-500 to-emerald-400 dark:from-[#34d399] dark:to-[#2dd4bf]"
                : "bg-gradient-to-r from-[#E58F67] to-[#C66B4A]",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE] dark:[&::-webkit-scrollbar-thumb]:bg-[#3a3731]">
        {sections.map((section, si) => {
          const st = computeTotals(section.nodes);
          const sectionPct = st.total > 0 ? Math.round((st.done / st.total) * 100) : 0;
          return (
            <div key={si} className="mb-4 last:mb-0">
              {section.title && (
                <div className="mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#6B6862] dark:text-zinc-400">
                      {section.title}
                    </span>
                    <span className="h-px flex-1 bg-[#E5E2D9] dark:bg-[#3a3731]" />
                    {st.total > 0 && (
                      <span className="text-[11px] text-[#A8A29E] tabular-nums dark:text-zinc-500">
                        {st.done}/{st.total}
                      </span>
                    )}
                  </div>
                  {st.total > 0 && (
                    <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[#F0EDE5] dark:bg-[#2a2723]">
                      <div
                        className="h-full rounded-full bg-[#E58F67]/60 transition-all duration-500"
                        style={{ width: `${sectionPct}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
              <ul className="space-y-0.5">
                {section.nodes
                  .filter((n) => n.depth === 0)
                  .map((node, ni) => (
                    <PlanNodeRow key={ni} node={node} depth={0} currentPath={currentPath} />
                  ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
