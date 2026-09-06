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
/** AbortSignal.any 的手动降级实现（Safari <17.4 无 AbortSignal.any）。
 *  组合多个 signal：任一 abort → 返回的 signal 立即 abort。 */
export function anySignal(...signals: Array<AbortSignal | undefined | null>): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const rand = Math.random().toString(36).slice(2, 12); // ~10 random base36 chars
  const ts = Date.now().toString(36);
  return `${rand}${ts}`;
}
