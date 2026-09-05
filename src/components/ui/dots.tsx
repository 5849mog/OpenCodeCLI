"use client";

import { cn } from "@/lib/utils";

/**
 * Triple bouncing-dots indicator — the app's one loader motif.
 * Three 4px dots pulsing in sequence (0/120/240ms delay). Color is the
 * accent orange by default; pass className for size/color overrides.
 */
export function Dots({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-0.5", className)} aria-hidden>
      {[0, 120, 240].map((delay) => (
        <span
          key={delay}
          className="h-1 w-1 animate-bounce rounded-full bg-[#E58F67]/70"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
