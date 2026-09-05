"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * AppIcon — the one place icons get their stroke weight and size.
 *
 * lucide's default is a 2px stroke on a 24px grid; at UI sizes (12-16px) that
 * reads mushy. Every icon we render goes through this wrapper or the global
 * `svg.lucide { stroke-width: 1.75 }` rule; if we ever swap the icon library,
 * swapping this one file is the whole migration.
 *
 * Sizes map to the existing token scale: 12 / 14 / 16 / 18 / 20 / 24.
 */
export function AppIcon({
  icon: Icon,
  size = 16,
  strokeWidth = 1.75,
  className,
}: {
  icon: LucideIcon;
  /** pixel size; default 16 (=h-4) */
  size?: number;
  /** SVG stroke width; default 1.75 instead of lucide's 2 */
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <Icon
      size={size}
      strokeWidth={strokeWidth}
      className={cn("shrink-0", className)}
      aria-hidden
    />
  );
}
