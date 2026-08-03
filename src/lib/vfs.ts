/**
 * Virtual File System (VFS) — "文件袋"
 *
 * Browser-side in-memory + IndexedDB persistent file system that emulates
 * a real project folder for the AI coding agent.
 *
 * Path conventions:
 *   - All paths are POSIX-style, relative to the VFS root.
 *   - No leading slash. e.g. "src/index.ts", "README.md".
 *   - Root is represented by "".
 */

import { openDB, type IDBPDatabase } from "idb";

export type VfsNodeType = "file" | "dir";

export interface VfsNode {
  path: string;
  type: VfsNodeType;
  content?: string; // for files
  updatedAt: number;
  createdAt: number;
}

const DB_NAME = "opencode-web";
const DB_VERSION = 1;
const STORE = "vfs";

let dbPromise: Promise<IDBPDatabase> | null = null;

// ---------------------------------------------------------------------------
// Mutation events — lets UI components (e.g. the editor) react when a file
// is modified externally (by the AI) so they can reload or warn the user.
// ---------------------------------------------------------------------------

export type VfsEventType = "write" | "delete" | "rename" | "clear";
export interface VfsEvent {
  type: VfsEventType;
  path?: string;
  toPath?: string;
}

type VfsListener = (e: VfsEvent) => void;
const listeners = new Set<VfsListener>();

/** Subscribe to VFS mutations. Returns an unsubscribe function. */
export function onVfsEvent(fn: VfsListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(e: VfsEvent) {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch {
      // listener errors must not break mutations
    }
  }
}

function getDB() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("VFS only available in browser"));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "path" });
          store.createIndex("type", "type");
        }
      },
    }).catch((e) => {
      // IndexedDB can be corrupted (e.g. user cleared storage mid-write,
      // browser quota exceeded, version conflict). Reset and retry once.
      console.warn("[vfs] IndexedDB open failed, attempting recovery:", e);
      dbPromise = null;
      // Try to wipe the DB and re-create
      return indexedDB.deleteDatabase(DB_NAME).then(
        () => openDB(DB_NAME, DB_VERSION, {
          upgrade(db) {
            if (!db.objectStoreNames.contains(STORE)) {
              const store = db.createObjectStore(STORE, { keyPath: "path" });
              store.createIndex("type", "type");
            }
          },
        }),
        () => {
          // If even delete fails, fall back to in-memory only (no persistence)
          console.warn("[vfs] IndexedDB recovery failed, running in memory-only mode");
          return null;
        },
      ).then((dbOrNull) => {
        if (!dbOrNull) {
          // Return a fake DB object that no-ops all operations
          return createInMemoryFallback();
        }
        return dbOrNull;
      });
    });
  }
  return dbPromise;
}

/** Fallback: a Map-based fake IDBPDatabase that never throws. */
function createInMemoryFallback(): IDBPDatabase {
  const store = new Map<string, VfsNode>();
  const fakeStore = {
    getAll: async () => Array.from(store.values()),
    get: async (key: string) => store.get(key) ?? null,
    put: async (node: VfsNode) => { store.set(node.path, node); },
    delete: async (key: string) => { store.delete(key); },
  };
  return {
    transaction: () => ({
      store: fakeStore,
      done: Promise.resolve(),
    }),
  } as unknown as IDBPDatabase;
}

/** Normalize a path: trim leading slash, collapse repeated slashes. */
export function normalizePath(p: string): string {
  if (!p) return "";
  let s = p.trim().replace(/\\/g, "/");
  s = s.replace(/^\.\/+/, "");
  s = s.replace(/^\/+/, "");
  s = s.replace(/\/+/g, "/");
  s = s.replace(/\/$/, "");
  return s;
}

/** Split a path into parent + name. */
export function splitPath(p: string): { parent: string; name: string } {
  const norm = normalizePath(p);
  if (!norm) return { parent: "", name: "" };
  const idx = norm.lastIndexOf("/");
  if (idx < 0) return { parent: "", name: norm };
  return { parent: norm.slice(0, idx), name: norm.slice(idx + 1) };
}

/** Get the parent path of a node. */
export function parentPath(p: string): string {
  return splitPath(p).parent;
}

/** Get the basename. */
export function basename(p: string): string {
  return splitPath(p).name;
}

/** Get the dirname. */
export function dirname(p: string): string {
  return parentPath(p);
}

/** Join path segments. */
export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

/** Determine if a path looks like a directory (ends with / or is empty). */
export function isDirPath(p: string): boolean {
  const norm = normalizePath(p);
  return norm === "" || p.endsWith("/");
}

// ---------------------------------------------------------------------------
// In-memory cache (kept in sync with IndexedDB).
// The cache is the single source of truth for synchronous reads; IndexedDB
// is the durable persistence layer.
// ---------------------------------------------------------------------------

const cache = new Map<string, VfsNode>();
let hydrated = false;
const hydrateListeners = new Set<() => void>();

async function hydrateFromIDB() {
  if (hydrated) return;
  try {
    const db = await getDB();
    const all = (await db.getAll(STORE)) as VfsNode[];
    cache.clear();
    for (const node of all) cache.set(node.path, node);
  } catch (e) {
    console.warn("[vfs] hydrate failed, starting empty:", e);
  }
  hydrated = true;
  for (const fn of hydrateListeners) fn();
}

export function onHydrate(fn: () => void): () => void {
  if (hydrated) {
    fn();
    return () => {};
  }
  hydrateListeners.add(fn);
  return () => hydrateListeners.delete(fn);
}

export function isHydrated() {
  return hydrated;
}

async function persist(node: VfsNode) {
  const db = await getDB();
  await db.put(STORE, node);
}

async function removePersisted(path: string) {
  const db = await getDB();
  await db.delete(STORE, path);
}

// Ensure all ancestor dirs exist for a given path.
function ensureAncestorsSync(path: string) {
  const norm = normalizePath(path);
  if (!norm) return;
  const parts = norm.split("/");
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join("/");
    if (!cache.has(ancestor)) {
      const now = Date.now();
      const dir: VfsNode = {
        path: ancestor,
        type: "dir",
        createdAt: now,
        updatedAt: now,
      };
      cache.set(ancestor, dir);
      persist(dir).catch((e) =>
        console.warn("[vfs] persist ancestor failed:", e),
      );
      emit({ type: "write", path: ancestor });
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Undo snapshots — shallow copies of the cache taken before each AI tool
// mutation. The session store pushes a snapshot before executing a mutating
// tool call, so /undo can restore the previous state.
// ---------------------------------------------------------------------------

interface Snapshot {
  // Map from path -> { content, createdAt, updatedAt }.
  files: Map<string, { content: string; createdAt: number; updatedAt: number }>;
  ts: number;
  label: string;
}

const snapshotStack: Snapshot[] = [];
const MAX_SNAPSHOTS = 30;

/** Take a snapshot of all current file contents. Returns nothing. */
function takeSnapshot(label: string): void {
  const files = new Map<string, { content: string; createdAt: number; updatedAt: number }>();
  for (const [path, node] of cache.entries()) {
    if (node.type === "file") files.set(path, { content: node.content ?? "", createdAt: node.createdAt, updatedAt: node.updatedAt });
  }
  snapshotStack.push({ files, ts: Date.now(), label });
  if (snapshotStack.length > MAX_SNAPSHOTS) snapshotStack.shift();
}

/** Restore the most recent snapshot. Returns the label, or null if none. */
function restoreLastSnapshot(): string | null {
  const snap = snapshotStack.pop();
  if (!snap) return null;
  // Wipe current cache and rebuild from snapshot
  const toDelete = Array.from(cache.keys());
  for (const p of toDelete) cache.delete(p);
  for (const [path, meta] of snap.files.entries()) {
    cache.set(path, {
      path,
      type: "file",
      content: meta.content,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    });
    // Re-create ancestor directory nodes (they were destroyed by the wipe)
    ensureAncestorsSync(path);
  }
  // Persist: clear IDB and re-write all (fire-and-forget to not block UX,
  // but with error logging)
  getDB()
    .then(async (db) => {
      if (!db) return;
      const tx = db.transaction(STORE, "readwrite");
      for (const p of toDelete) await tx.store.delete(p);
      for (const [path, meta] of snap.files.entries()) {
        await tx.store.put({
          path,
          type: "file",
          content: meta.content,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
        });
      }
      await tx.done;
    })
    .catch((e) => console.warn("[vfs] snapshot persist failed:", e));
  emit({ type: "clear" });
  return snap.label;
}

/** Peek at the most recent snapshot without popping. */
function peekSnapshot(): Snapshot | null {
  return snapshotStack[snapshotStack.length - 1] ?? null;
}

/** List all snapshots for display. */
function listSnapshots(): Array<{ label: string; ts: number; fileCount: number }> {
  return snapshotStack.map((s) => ({ label: s.label, ts: s.ts, fileCount: s.files.size }));
}

/** Clear all snapshots (e.g. after clearing workspace). */
function clearSnapshots(): void {
  snapshotStack.length = 0;
}

export const vfs = {
  async hydrate() {
    await hydrateFromIDB();
  },

  isHydrated() {
    return hydrated;
  },

  onHydrate,

  /** Read a file's content. Returns null if not found or it's a directory. */
  readFileSync(path: string): string | null {
    const norm = normalizePath(path);
    const node = cache.get(norm);
    if (!node || node.type !== "file") return null;
    return node.content ?? "";
  },

  async readFile(path: string): Promise<string | null> {
    await hydrateFromIDB();
    return vfs.readFileSync(path);
  },

  /** Get a node's metadata. */
  statSync(path: string): VfsNode | null {
    return cache.get(normalizePath(path)) ?? null;
  },

  /** Write a file (create or overwrite). Also creates ancestor dirs. */
  async writeFile(path: string, content: string): Promise<VfsNode> {
    await hydrateFromIDB();
    const norm = normalizePath(path);
    if (!norm) throw new Error("Cannot write to root");
    const now = Date.now();
    ensureAncestorsSync(norm);
    const existing = cache.get(norm);
    const node: VfsNode = {
      path: norm,
      type: "file",
      content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    cache.set(norm, node);
    void persist(node);
    emit({ type: "write", path: norm });
    return node;
  },

  /** Synchronous write — updates cache immediately, persists in background.
   *  Use this when you need the write to be visible to a subsequent
   *  synchronous read in the same tick (e.g. bash && chains with redirects). */
  writeFileSync(path: string, content: string): void {
    const norm = normalizePath(path);
    if (!norm) return;
    const now = Date.now();
    ensureAncestorsSync(norm);
    const existing = cache.get(norm);
    const node: VfsNode = {
      path: norm,
      type: "file",
      content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    cache.set(norm, node);
    void persist(node);
    emit({ type: "write", path: norm });
  },

  /** Create a directory (mkdir -p). */
  async mkdir(path: string): Promise<VfsNode | null> {
    await hydrateFromIDB();
    const norm = normalizePath(path);
    if (!norm) return null;
    ensureAncestorsSync(norm);
    if (cache.has(norm)) {
      const ex = cache.get(norm)!;
      if (ex.type === "dir") return ex;
      return null;
    }
    const now = Date.now();
    const node: VfsNode = {
      path: norm,
      type: "dir",
      createdAt: now,
      updatedAt: now,
    };
    cache.set(norm, node);
    await persist(node);
    emit({ type: "write", path: norm });
    return node;
  },

  /** Synchronous mkdir -p — updates cache immediately, persists in background.
   *  Throws if path exists as a file (like real mkdir -p). */
  mkdirSync(path: string): void {
    const norm = normalizePath(path);
    if (!norm) return;
    ensureAncestorsSync(norm);
    if (cache.has(norm)) {
      const ex = cache.get(norm)!;
      if (ex.type === "dir") return;
      throw new Error(`mkdir: ${norm}: File exists`);
    }
    const now = Date.now();
    const node: VfsNode = {
      path: norm,
      type: "dir",
      createdAt: now,
      updatedAt: now,
    };
    cache.set(norm, node);
    void persist(node);
    emit({ type: "write", path: norm });
  },

  /**
   * Edit a file by replacing the first occurrence of `oldString` with
   * `newString`. Throws if the file doesn't exist or `oldString` is not found.
   * If `oldString` is empty, behaves like writeFile (append-only is the
   * caller's responsibility).
   */
  async editFile(
    path: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ): Promise<{ before: string; after: string; replacements: number }> {
    await hydrateFromIDB();
    const norm = normalizePath(path);
    const node = cache.get(norm);
    if (!node || node.type !== "file") {
      throw new Error(`File not found: ${norm}`);
    }
    const before = node.content ?? "";
    let after: string;
    let replacements = 0;
    if (oldString === "") {
      // Treat as append
      after = before + newString;
      replacements = 1;
    } else if (replaceAll) {
      const parts = before.split(oldString);
      replacements = parts.length - 1;
      if (replacements === 0) {
        throw new Error(`oldString not found in ${norm}`);
      }
      after = parts.join(newString);
    } else {
      const idx = before.indexOf(oldString);
      if (idx < 0) {
        throw new Error(`oldString not found in ${norm}`);
      }
      // Detect duplicate occurrences — warn the caller via error so the AI
      // can disambiguate (matches OpenCode/Claude Code behavior).
      const nextIdx = before.indexOf(oldString, idx + 1);
      if (nextIdx >= 0) {
        throw new Error(
          `oldString is not unique in ${norm}; provide more context`,
        );
      }
      after =
        before.slice(0, idx) + newString + before.slice(idx + oldString.length);
      replacements = 1;
    }
    await vfs.writeFile(norm, after);
    return { before, after, replacements };
  },

  /** Delete a file or directory (recursively). */
  async delete(path: string): Promise<number> {
    await hydrateFromIDB();
    const norm = normalizePath(path);
    let count = 0;
    const targets: string[] = [];
    for (const p of cache.keys()) {
      if (p === norm || p.startsWith(norm + "/")) {
        targets.push(p);
      }
    }
    for (const p of targets) {
      cache.delete(p);
      await removePersisted(p);
      count++;
    }
    if (count > 0) emit({ type: "delete", path: norm });
    return count;
  },

  /** Rename/move a file or directory. */
  async rename(from: string, to: string): Promise<void> {
    await hydrateFromIDB();
    const fromNorm = normalizePath(from);
    const toNorm = normalizePath(to);
    if (!cache.has(fromNorm)) {
      throw new Error(`Source not found: ${fromNorm}`);
    }
    const moves: Array<[string, string]> = [];
    for (const p of cache.keys()) {
      if (p === fromNorm || p.startsWith(fromNorm + "/")) {
        moves.push([p, toNorm + p.slice(fromNorm.length)]);
      }
    }
    const now = Date.now();
    for (const [src, dst] of moves) {
      const node = cache.get(src)!;
      const newNode: VfsNode = { ...node, path: dst, updatedAt: now };
      cache.delete(src);
      cache.set(dst, newNode);
      await removePersisted(src);
      await persist(newNode);
    }
    if (moves.length > 0) emit({ type: "rename", path: fromNorm, toPath: toNorm });
  },

  /** Synchronous rename — updates cache immediately, persists in background. */
  renameSync(from: string, to: string): void {
    const fromNorm = normalizePath(from);
    const toNorm = normalizePath(to);
    if (!cache.has(fromNorm)) {
      throw new Error(`Source not found: ${fromNorm}`);
    }
    const moves: Array<[string, string]> = [];
    for (const p of cache.keys()) {
      if (p === fromNorm || p.startsWith(fromNorm + "/")) {
        moves.push([p, toNorm + p.slice(fromNorm.length)]);
      }
    }
    const now = Date.now();
    for (const [src, dst] of moves) {
      const node = cache.get(src)!;
      const newNode: VfsNode = { ...node, path: dst, updatedAt: now };
      cache.delete(src);
      cache.set(dst, newNode);
      void removePersisted(src);
      void persist(newNode);
    }
    if (moves.length > 0) emit({ type: "rename", path: fromNorm, toPath: toNorm });
  },

  /** List direct children of a directory. */
  listSync(path: string): VfsNode[] {
    const norm = normalizePath(path);
    const prefix = norm ? norm + "/" : "";
    const seen = new Set<string>();
    const result: VfsNode[] = [];
    for (const [p, node] of cache.entries()) {
      if (p === norm) continue;
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (!rest) continue;
      const firstSeg = rest.split("/")[0];
      if (seen.has(firstSeg)) continue;
      seen.add(firstSeg);
      const childPath = prefix + firstSeg;
      const child = cache.get(childPath);
      if (child) result.push(child);
    }
    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  },

  async list(path: string): Promise<VfsNode[]> {
    await hydrateFromIDB();
    return vfs.listSync(path);
  },

  /** List ALL files recursively under a path. */
  listAllFilesSync(path?: string): VfsNode[] {
    const root = path ? normalizePath(path) : "";
    const prefix = root ? root + "/" : "";
    const result: VfsNode[] = [];
    for (const [p, node] of cache.entries()) {
      if (node.type !== "file") continue;
      if (root && !p.startsWith(prefix) && p !== root) continue;
      result.push(node);
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  },

  /** Build a tree representation for display. */
  treeSync(path?: string): string {
    const root = path ? normalizePath(path) : "";
    const lines: string[] = [];
    const walk = (dir: string, depth: number) => {
      const children = vfs.listSync(dir);
      for (const child of children) {
        const indent = "  ".repeat(depth);
        const name = basename(child.path);
        lines.push(`${indent}${name}${child.type === "dir" ? "/" : ""}`);
        if (child.type === "dir") walk(child.path, depth + 1);
      }
    };
    walk(root, 0);
    return lines.join("\n");
  },

  /**
   * Build a **one-level** summary of the workspace root, showing only the
   * direct children of the given directory. Each directory shows its
   * recursive total file count; files show just their name. This is a cheap,
   * token-friendly alternative to treeSync() for injecting into the AI
   * context — its size depends on the number of top-level items, NOT the
   * total file count, so it stays tiny even for huge projects.
   */
  treeSummary(path?: string): string {
    const root = path ? normalizePath(path) : "";
    const children = vfs.listSync(root);
    if (children.length === 0) {
      return root ? `(empty directory: ${root})` : "(empty workspace)";
    }
    const lines: string[] = [];
    for (const child of children) {
      if (child.type === "dir") {
        const fileCount = vfs.listAllFilesSync(child.path).length;
        lines.push(`dir   ${child.path}/  (${fileCount} files)`);
      } else {
        lines.push(`file  ${child.path}`);
      }
    }
    return `${children.length} item(s) in ${root || "/"}:\n${lines.join("\n")}`;
  },

  /** Get all nodes (for export / debugging). */
  allSync(): VfsNode[] {
    return Array.from(cache.values());
  },

  /** Wipe everything. */
  async clear() {
    await hydrateFromIDB();
    const all = Array.from(cache.keys());
    cache.clear();
    const db = await getDB();
    const tx = db.transaction(STORE, "readwrite");
    for (const p of all) await tx.store.delete(p);
    await tx.done;
    if (all.length > 0) emit({ type: "clear" });
  },

  /** Import a list of {path, content} objects (e.g. from a zip upload). */
  async importFiles(
    files: Array<{ path: string; content: string }>,
  ): Promise<number> {
    await hydrateFromIDB();
    let n = 0;
    for (const f of files) {
      await vfs.writeFile(f.path, f.content);
      n++;
    }
    return n;
  },

  // --- Undo snapshot API ---
  takeSnapshot,
  restoreLastSnapshot,
  peekSnapshot,
  listSnapshots,
  clearSnapshots,
  /** Number of snapshots currently in the stack. */
  snapshotCount: () => snapshotStack.length,
};

// ---------------------------------------------------------------------------
// Grep — basic search inside the VFS.
// ---------------------------------------------------------------------------

export interface GrepMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export function grepSync(
  pattern: string,
  opts: {
    path?: string;
    regex?: boolean;
    caseSensitive?: boolean;
    max?: number;
    /** Per-file filter applied after the type/prefix checks, before scanning content. */
    filter?: (path: string) => boolean;
  } = {},
): GrepMatch[] {
  const root = opts.path ? normalizePath(opts.path) : "";
  const prefix = root ? root + "/" : "";
  const { filter } = opts;
  const flags = opts.caseSensitive ? "g" : "gi";
  let re: RegExp;
  try {
    re = opts.regex ? new RegExp(pattern, flags) : new RegExp(escapeRegExp(pattern), flags);
  } catch {
    return [];
  }
  const results: GrepMatch[] = [];
  const max = opts.max ?? 200;
  let truncated = false;
  outer: for (const [p, node] of cache.entries()) {
    if (node.type !== "file") continue;
    if (root && p !== root && !p.startsWith(prefix)) continue;
    if (filter && !filter(p)) continue;
    const content = node.content ?? "";
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Report EVERY match on the line, not just the first one.
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        results.push({
          path: p,
          line: i + 1,
          column: m.index + 1,
          text: line,
        });
        if (results.length >= max) {
          truncated = true;
          break outer;
        }
        // Avoid infinite loop on zero-width matches (e.g. /^/ or /(?=...)/).
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }
  if (truncated) {
    // Attach a sentinel so callers can tell the AI the list was cut short.
    (results as GrepMatch[] & { truncated?: boolean }).truncated = true;
  }
  // Sort by path (then line, then column) so output order is deterministic and
  // independent of the internal Map iteration order.
  results.sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });
  return results;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
