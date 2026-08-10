"use client";

/**
 * CollapsibleText — long text that defaults to collapsed with a down-arrow
 * toggle. Used by user messages, assistant messages, and the 子智能体 panel
 * so long content never floods the view. Under the threshold it renders
 * inline with no chrome.
 *
 * `render` is invoked for the EXPANDED full content only (e.g. Markdown).
 * The collapsed preview is always plain text — no partial markdown rendering.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const PREVIEW_CHARS = 260;

export function CollapsibleText({
  text,
  render,
  threshold = 600,
  className,
  previewClassName,
}: {
  text: string;
  /** Optional full-content renderer (Markdown etc.). Fallback: plain pre-wrap. */
  render?: (text: string) => ReactNode;
  /** Collapse when text is longer than this. */
  threshold?: number;
  className?: string;
  previewClassName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > threshold;

  if (!isLong) {
    return <>{render ? render(text) : <div className="whitespace-pre-wrap break-words">{text}</div>}</>;
  }

  return (
    <div className={cn("min-w-0", className)}>
      {expanded ? (
        <div className="min-w-0">
          {render ? (
            render(text)
          ) : (
            <div className="whitespace-pre-wrap break-words">{text}</div>
          )}
          <ToggleArrow expanded onToggle={() => setExpanded(false)} />
        </div>
      ) : (
        <div className="min-w-0">
          <div
            className={cn("whitespace-pre-wrap break-words", previewClassName)}
          >
            {text.slice(0, PREVIEW_CHARS)}
            {text.length > PREVIEW_CHARS ? "…" : ""}
          </div>
          <ToggleArrow expanded={false} onToggle={() => setExpanded(true)} />
        </div>
      )}
    </div>
  );
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
      className="mt-1 flex items-center gap-1 rounded px-1 py-0.5 text-[length:var(--font-size-ui-sm)] text-[#8B8884] transition-colors hover:bg-[#F0EDE5] hover:text-[#3D3B37]"
      title={expanded ? "收起" : "展开完整内容"}
    >
      <ChevronDown
        className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")}
      />
      <span>{expanded ? "收起" : "展开"}</span>
    </button>
  );
}
