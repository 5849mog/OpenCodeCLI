/**
 * Session persistence — save/restore chat sessions to IndexedDB so that
 * a page refresh (or accidental tab close) doesn't lose the conversation.
 *
 * We store sessions as a single record keyed by a stable id. Each session
 * includes: messages, events, totalTokens, lastUsage, createdAt, updatedAt.
 *
 * We deliberately use IndexedDB (not localStorage) because tool results can
 * make a single session several MB.
 */

import { openDB, type IDBPDatabase } from "idb";
import type { ChatMessage } from "./ai-client";
import type { SessionEvent } from "@/store/session";

const DB_NAME = "opencode-web-sessions";
const DB_VERSION = 1;
const STORE = "sessions";
const ACTIVE_KEY = "__active__";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Sessions DB only available in browser"));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    }).catch(() => null as unknown as IDBPDatabase);
  }
  return dbPromise;
}

export interface PersistedSession {
  id: string;
  messages: ChatMessage[];
  events: SessionEvent[];
  totalTokens: number;
  lastUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  createdAt: number;
  updatedAt: number;
}

/** Save the active session. Debounced by caller if needed. */
export async function saveSession(session: PersistedSession): Promise<void> {
  const db = await getDB();
  if (!db) return;
  try {
    await db.put(STORE, session, ACTIVE_KEY);
  } catch {
    // storage full or blocked — silently drop, the conversation continues in memory
  }
}

/** Load the active session, or null if none. */
export async function loadSession(): Promise<PersistedSession | null> {
  const db = await getDB();
  if (!db) return null;
  try {
    const result = (await db.get(STORE, ACTIVE_KEY)) as PersistedSession | undefined;
    return result ?? null;
  } catch {
    return null;
  }
}

/** Delete the active session (used by /clear). */
export async function clearSession(): Promise<void> {
  const db = await getDB();
  if (!db) return;
  try {
    await db.delete(STORE, ACTIVE_KEY);
  } catch {}
}
