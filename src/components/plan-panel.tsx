"use client";

/**
 * PlanPanel — a full-height persistent plan panel for the right sidebar.
 * Replaces the inline PlanView that used to live in the event stream.
 * Auto-updates when PLAN.md changes (via eventsLen trigger).
 */

import { useMemo } from "react";
import { ClipboardList } from "lucide-react";
import { vfs } from "@/lib/vfs";
import { cn } from "@/lib/utils";
import {
  parsePlan,
  nodeStats,
  computeTotals,
  tagColor,
  type PlanNode,
} from "@/lib/plan-utils";

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: PlanNode["status"] }) {
  if (status === "done") {
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[#D97757] bg-[#D97757] text-black">
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

function PlanNodeRow({ node, depth }: { node: PlanNode; depth: number }) {
  const { total, done } = nodeStats(node);
  const hasChildren = node.children.length > 0;
  const padLeft = depth * 18;

  return (
    <>
      <li
        className={cn(
          "flex items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[#F5F3EE]",
          node.status === "done" ? "text-[#8B8884]" : "text-[#2D2B27]",
        )}
        style={{ paddingLeft: `${12 + padLeft}px` }}
      >
        <StatusIcon status={node.status} />
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
          <span className="shrink-0 text-[11px] text-[#A8A29E] tabular-nums">
            {done}/{total}
          </span>
        )}
      </li>
      {node.children.map((child, i) => (
        <PlanNodeRow key={i} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// PlanPanel
// ---------------------------------------------------------------------------

export function PlanPanel({ eventsLen }: { eventsLen: number }) {
  const parsed = useMemo(() => {
    const content = vfs.readFileSync("PLAN.md");
    if (!content) return null;
    return parsePlan(content);
  }, [eventsLen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!parsed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="rounded-full border border-[#E5E2D9] bg-[#FAF9F7] p-4">
          <ClipboardList className="h-8 w-8 text-[#D97757]" />
        </div>
        <div className="text-sm text-[#3D3B37]">No plan yet</div>
        <div className="max-w-xs text-xs text-[#8B8884]">
          Ask the AI to create a plan. It will use <code className="text-[#D97757]">update_plan</code> to build a structured checklist here.
        </div>
      </div>
    );
  }

  const { sections, title } = parsed;
  const allNodes = sections.flatMap((s) => s.nodes);
  const { total, done } = computeTotals(allNodes);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if (total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="rounded-full border border-[#E5E2D9] bg-[#FAF9F7] p-4">
          <ClipboardList className="h-8 w-8 text-[#D97757]" />
        </div>
        <div className="text-sm text-[#3D3B37]">Plan is empty</div>
        <div className="max-w-xs text-xs text-[#8B8884]">
          PLAN.md exists but has no checklist items. Use <code className="text-[#D97757]">- [ ]</code> syntax in Markdown.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sticky header */}
      <div className="border-b border-[#E5E2D9] bg-[#FFFFFF] px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-[#D97757]" />
            <h2 className="text-sm font-semibold text-[#2D2B27]">{title}</h2>
          </div>
          <span className="font-mono text-xs text-[#8B8884] tabular-nums">
            {done}/{total} · {pct}%
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#F0EDE5]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#D97757] to-[#C66B4A] transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE]">
        {sections.map((section, si) => (
          <div key={si} className="mb-4 last:mb-0">
            {section.title && (
              <div className="mb-2 flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#6B6862]">
                  {section.title}
                </span>
                <span className="h-px flex-1 bg-[#E5E2D9]" />
                {(() => {
                  const st = computeTotals(section.nodes);
                  return st.total > 0 ? (
                    <span className="text-[11px] text-[#A8A29E] tabular-nums">
                      {st.done}/{st.total}
                    </span>
                  ) : null;
                })()}
              </div>
            )}
            <ul className="space-y-0.5">
              {section.nodes
                .filter((n) => n.depth === 0)
                .map((node, ni) => (
                  <PlanNodeRow key={ni} node={node} depth={0} />
                ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
