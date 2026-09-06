
"use client";

import {
} from "@/lib/ai-client";
import {
} from "@/lib/tools/index";
import {
  saveSession,
  getActiveSessionId,
  type PersistedSession
} from "@/lib/session-storage";

// ---------------------------------------------------------------------------
// Idle auto-lock — wipes API keys from memory after N minutes of inactivity.
// ---------------------------------------------------------------------------
import type {
  SessionState
} from "./session";

let eventCounter = 0;
export function nextId(): string {
  eventCounter += 1;
  return `e${Date.now()}_${eventCounter}`;
}

/** IndexedDB 持久化失败只提示一次——静默丢持久化比崩溃更糟（用户会以为
 *  会话已保存），但每次都弹 toast 也会刷屏。 */
let persistFailureNotified = false;
function notifyPersistFailure(e: unknown): void {
  if (persistFailureNotified) return;
  persistFailureNotified = true;
  void import("sonner").then(({ toast }) => {
    toast.error("会话持久化失败（IndexedDB 不可用或已满），刷新后本会话可能丢失。", {
      description: e instanceof Error ? e.message : String(e),
      duration: 10000,
    });
  });
}

/** Debounced session persistence — avoids writing to IndexedDB on every token. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Immediately persist the current session, bypassing the debounce. */
export async function flushPersist(get: () => SessionState): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const s = get();
  if (s.messages.length === 0) return;
  const session: PersistedSession = {
    id: s.sessionId || getActiveSessionId(),
    title: s.title || "新会话",
    messages: s.messages,
    events: s.events,
    totalTokens: s.totalTokens,
    lastUsage: s.lastUsage,
    compactedReleases: s.compactedReleases ?? 0,
    compactCount: s.compactCount ?? 0,
    usageHistory: s.usageHistory ?? [],
    vfsChangeLog: s.vfsChangeLog ?? [],
    agentPreset: s.agentPreset ?? "full",
    createdAt: s.events[0]?.ts ?? Date.now(),
    updatedAt: Date.now(),
  };
  await saveSession(session).catch((e: unknown) => notifyPersistFailure(e));
}

export function schedulePersist(get: () => SessionState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushPersist(get).catch((e: unknown) => notifyPersistFailure(e));
  }, 500);
}
