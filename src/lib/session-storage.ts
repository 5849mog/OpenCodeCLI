/**
 * Session persistence — save/restore chat sessions to IndexedDB so that
 * a page refresh (or accidental tab close) doesn't lose the conversation.
 *
 * Multi-session storage:
 *   - `sessions` store: full records keyed by session id. Tool results can make
 *     a single session several MB, so the list view NEVER reads this store.
 *   - `session-meta` store: lightweight { id, title, createdAt, updatedAt,
 *     totalTokens, messageCount } — the only thing `listSessions()` touches.
 *   - The active session id lives in localStorage (`opencode-web.activeSessionId`).
 *
 * Migration from v1: the single `__active__` record is converted into a named
 * session entry inside the same upgrade transaction.
 */

import { openDB, type IDBPDatabase, type IDBPTransaction } from "idb";
import type { ChatMessage } from "./ai-client";
import type { SessionEvent } from "@/store/session";
import { uuid } from "./utils";

const DB_NAME = "opencode-web-sessions";
const DB_VERSION = 2;
const STORE = "sessions";
const META_STORE = "session-meta";
const LEGACY_ACTIVE_KEY = "__active__";
export const ACTIVE_SESSION_KEY = "opencode-web.activeSessionId";

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  totalTokens: number;
  messageCount: number;
}

export interface PersistedSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  events: SessionEvent[];
  totalTokens: number;
  lastUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  /** 运行模式（full/light/minimal）——会话创建时锁定，切换需新建会话。 */
  agentPreset?: "full" | "light" | "minimal";
  /** Cumulative tokens released by compaction (for the compression-aware panel). */
  compactedReleases?: number;
  /** Number of successful /compact runs. */
  compactCount?: number;
  /** Per-request API usage (audit panel). */
  usageHistory?: {
    ts: number;
    source: "main" | "subagent" | "orchestrator";
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }[];
  /** VFS change log (audit panel; covers delete/move/bash writes that lack diffs). */
  vfsChangeLog?: {
    ts: number;
    type: "write" | "delete" | "rename" | "clear";
    path?: string;
    toPath?: string;
  }[];
  createdAt: number;
  updatedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Sessions DB only available in browser"));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "id" });
        }
        // v1 → v2: migrate the single "__active__" record into a named session.
        if (oldVersion < 2) {
          return migrateLegacyActive(tx);
        }
      },
    }).catch(() => null as unknown as IDBPDatabase);
  }
  return dbPromise;
}

/**
 * Move the v1 `__active__` record into a named session + meta entry, then remove
 * the legacy key. Runs inside the same upgrade transaction (atomic).
 */
async function migrateLegacyActive(tx: IDBPTransaction<unknown, string[], "versionchange">) {
  try {
    const store = tx.objectStore(STORE);
    const metaStore = tx.objectStore(META_STORE);
    const oldRec = (await store.get(LEGACY_ACTIVE_KEY)) as
      | (Partial<PersistedSession> & { messages?: ChatMessage[] })
      | undefined;
    if (oldRec && oldRec.messages?.length) {
      const newId = uuid();
      const now = Date.now();
      const title = deriveTitleFromMessages(oldRec.messages) || "历史会话";
      const record: PersistedSession = {
        id: newId,
        title,
        messages: oldRec.messages,
        events: oldRec.events ?? [],
        totalTokens: oldRec.totalTokens ?? 0,
        lastUsage: oldRec.lastUsage ?? null,
        createdAt: oldRec.createdAt ?? now,
        updatedAt: now,
      };
      await store.put(record, newId);
      await metaStore.put(metaOf(record));
      await store.delete(LEGACY_ACTIVE_KEY);
      try {
        localStorage.setItem(ACTIVE_SESSION_KEY, newId);
      } catch {
        /* localStorage unavailable — ignore */
      }
    }
  } catch {
    // Migration failure: leave legacy record in place; session list will be empty.
  }
}

function metaOf(s: PersistedSession): SessionMeta {
  return {
    id: s.id,
    title: s.title || "新会话",
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    totalTokens: s.totalTokens,
    messageCount: s.messages.length,
  };
}

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

/** Drop the oldest sessions (beyond the newest 50) to free quota. */
async function pruneOldestSessions(): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const all = await listSessions();
  for (const m of all.slice(50)) {
    await db.delete(STORE, m.id);
    await db.delete(META_STORE, m.id);
  }
}

/** Create a fresh (empty) persisted session. preset 创建时锁定。 */
export async function createSession(
  title = "新会话",
  agentPreset: "full" | "light" | "minimal" = "full",
): Promise<PersistedSession> {
  const now = Date.now();
  return {
    id: uuid(),
    title,
    messages: [],
    events: [],
    totalTokens: 0,
    lastUsage: null,
    agentPreset,
    usageHistory: [],
    vfsChangeLog: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Persist a session record + upsert its meta entry. */
export async function saveSession(session: PersistedSession): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const rec: PersistedSession = { ...session, updatedAt: Date.now() };
  try {
    await db.put(STORE, rec, rec.id);
    await db.put(META_STORE, metaOf(rec));
  } catch (err) {
    if (!isQuotaError(err)) return;
    // Storage full — prune oldest sessions, then retry once.
    try {
      await pruneOldestSessions();
      await db.put(STORE, rec, rec.id);
      await db.put(META_STORE, metaOf(rec));
    } catch {
      // give up silently — the conversation continues in memory
    }
  }
}

/** Load a full session record by id (falls back to meta title for renames). */
export async function loadSession(id: string): Promise<PersistedSession | null> {
  const db = await getDB();
  if (!db) return null;
  try {
    const result = (await db.get(STORE, id)) as PersistedSession | undefined;
    if (!result) return null;
    const meta = (await db.get(META_STORE, id)) as SessionMeta | undefined;
    if (meta) result.title = meta.title;
    return result;
  } catch {
    return null;
  }
}

/**
 * Load ALL full session records (for full export). Tool results can make a
 * single session several MB — only use when the user explicitly exports.
 */
export async function loadAllSessions(): Promise<PersistedSession[]> {
  const db = await getDB();
  if (!db) return [];
  try {
    const all = (await db.getAll(STORE)) as PersistedSession[];
    // Merge meta titles (rename live in meta only, never in the full record).
    const metas = (await db.getAll(META_STORE)) as SessionMeta[];
    const metaById = new Map(metas.map((m) => [m.id, m]));
    for (const rec of all) {
      const meta = metaById.get(rec.id);
      if (meta?.title) rec.title = meta.title;
    }
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/**
 * Wipe ALL sessions (records + meta). Used by full-overwrite import — the
 * user opted into replacing the entire local history, so this is intentional.
 */
export async function wipeAllSessions(): Promise<void> {
  const db = await getDB();
  if (!db) return;
  try {
    const recs = (await db.getAllKeys(STORE)) as IDBValidKey[];
    const metas = (await db.getAllKeys(META_STORE)) as IDBValidKey[];
    for (const k of recs) await db.delete(STORE, k);
    for (const k of metas) await db.delete(META_STORE, k);
  } catch {
    /* ignore */
  }
}

/** Delete a session (record + meta). */
export async function deleteSession(id: string): Promise<void> {
  const db = await getDB();
  if (!db) return;
  try {
    await db.delete(STORE, id);
    await db.delete(META_STORE, id);
  } catch {
    /* ignore */
  }
}

/** Rename a session — updates meta only (O(1), avoids loading the MB-level record). */
export async function renameSession(id: string, title: string): Promise<void> {
  const db = await getDB();
  if (!db) return;
  try {
    const meta = (await db.get(META_STORE, id)) as SessionMeta | undefined;
    if (!meta) return;
    await db.put(META_STORE, { ...meta, title, updatedAt: Date.now() });
  } catch {
    /* ignore */
  }
}

/** List lightweight session metadata, newest first. */
export async function listSessions(): Promise<SessionMeta[]> {
  const db = await getDB();
  if (!db) return [];
  try {
    const all = (await db.getAll(META_STORE)) as SessionMeta[];
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/** Active session id from localStorage; creates one if missing. */
export function getActiveSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (existing) return existing;
  } catch {
    /* ignore */
  }
  const id = uuid();
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

export function setActiveSessionId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
  } catch {
    /* ignore */
  }
}

/** Derive a session title from the first user message. */
export function deriveTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 40) || "新会话";
}

function deriveTitleFromMessages(messages: ChatMessage[]): string {
  const firstUser = messages.find(
    (m): m is ChatMessage & { content: string } =>
      m.role === "user" && typeof m.content === "string" && m.content.length > 0,
  );
  if (!firstUser) return "";
  return deriveTitle(firstUser.content);
}
