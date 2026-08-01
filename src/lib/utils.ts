import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Generate a unique id. `crypto.randomUUID()` only exists in secure contexts
 * (HTTPS or localhost) — over plain HTTP on a LAN IP it is undefined, so fall
 * back to a random-first id. Random must come BEFORE the timestamp: call sites
 * truncate with slice(0,6)/slice(0,12), and a timestamp-first format collapses
 * to duplicates for calls made within the same millisecond (ask_user_input
 * generates many ids in one tick). Always string-based and short-enough for
 * file paths / storage keys.
 */
export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const rand = Math.random().toString(36).slice(2, 12); // ~10 random base36 chars
  const ts = Date.now().toString(36);
  return `${rand}${ts}`;
}
