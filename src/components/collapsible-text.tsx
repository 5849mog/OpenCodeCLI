"use client";

/**
 * CollapsibleText — long CONTENT that collapses with a "⌄ 展开" toggle.
 *
 * IMPORTANT design rule: it is only for "input"-style content the user wants
 * collapsed (delegation prompts, long user messages). It must NEVER wrap AI
 * outputs or subagent replies — those always render in full.
 *
 * Key UX: the collapsed preview ALSO renders the content via `render`
 * (e.g. Markdown). It is not a raw text truncation. Collapsed state shows the
 * same rendered content clamped to a max height with a soft fade-out mask,
 * signaling "there is more". Expanding shows the full height.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Renderer for the content — runs in BOTH collapsed preview and expanded. */
type ContentRenderer = (text: string) => ReactNode;

export function CollapsibleText({
  text,
  render,
  threshold = 600,
  className,
  previewClassName,
}: {
  text: string;
  /** Renders the content (Markdown etc.). Applied in both states. */
  render?: ContentRenderer;
  /** Collapse when the text is longer than this. */
  threshold?: number;
  className?: string;
  previewClassName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > threshold;

  if (!isLong) {
    return (
      <div className={cn("min-w-0", className)}>
        {render ? render(text) : <PlainText text={text} />}
      </div>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div className={cn("relative", !expanded && "max-h-52 overflow-hidden", previewClassName)}>
        {render ? render(text) : <PlainText text={text} />}
        {/* Soft fade-out mask at the bottom when collapsed shows "more content". */}
        {!expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#111110] to-transparent" />
        )}
      </div>
      <div className="mt-1">
        <ToggleArrow expanded={expanded} onToggle={() => setExpanded((e) => !e)} />
      </div>
    </div>
  );
}

function PlainText({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap break-words">{text}</div>;
}

/** Small "⌄ / ⌃" toggle button with a friendly label. */
function ToggleArrow({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1 rounded px-1 py-0.5 text-[length:var(--font-size-ui-sm)] text-[#8B8884] transition-colors hover:bg-[#F0EDE5] hover:text-[#3D3B37] dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
      title={expanded ? "收起" : "展开完整内容"}
    >
      <ChevronDown
        className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")}
      />
      <span>{expanded ? "收起" : "展开完整内容"}</span>
    </button>
  );
}
