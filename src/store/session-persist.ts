
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
  await saveSession(session);
}

export function schedulePersist(get: () => SessionState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flushPersist(get);
  }, 500);
}
