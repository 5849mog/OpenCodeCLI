/**
 * API Key Vault — secure in-memory storage for the user's API keys.
 *
 * Supports multiple key slots: "llm" (the LLM API key) and "search" (search API key).
 *
 * Security model (strengthened):
 * - Keys are NEVER stored in localStorage, IndexedDB, or any persistent
 *   browser storage in plaintext.
 * - Keys are NOT in the Zustand store, so `useSession.getState()` cannot
 *   reveal them. React DevTools cannot see them either.
 * - Each key lives in a module-level private variable (closure), accessible
 *   only via `getKey()` / `getSearchKey()`.
 * - **Master-key encryption:** a random 256-bit master key is generated at
 *   module load and held ONLY in memory — it is NEVER written to
 *   sessionStorage / localStorage / IndexedDB. API keys are encrypted with
 *   AES-GCM using an AES key derived from the master key (PBKDF2 + random
 *   salt); only { ciphertext, salt, iv } ever touches sessionStorage.
 *   A page refresh destroys the master key, so the stored ciphertext becomes
 *   undecryptable — the user simply re-enters the API key. This is the point:
 *   even a full dump of sessionStorage (via XSS) yields only ciphertext that
 *   cannot be decrypted without the in-memory master key.
 * - `lock()` / `lockAll()` wipe keys from memory AND sessionStorage, so a
 *   user can immediately invalidate their keys before stepping away.
 *
 * What this DOES NOT protect against:
 * - A debugger breakpoint in the fetch function
 * - Monkey-patching fetch
 * - Malicious browser extensions with page access
 *
 * These are fundamental browser limitations — any JS running in the page
 * context can intercept network requests. The vault raises the bar
 * significantly but cannot achieve 100% security in a browser.
 */

// --- Key slot registry ---

interface KeySlot {
  key: string | null;
  sessionPrefix: string;
}

const slots: Record<string, KeySlot> = {
  llm: { key: null, sessionPrefix: "opencode-web.key" },
  search: { key: null, sessionPrefix: "opencode-web.search-key" },
};

// --- Master key (memory-only) ---
// Generated once per page load. Never persisted anywhere. When it's gone
// (refresh / tab close), the sessionStorage ciphertext is undecryptable.

let masterKey: CryptoKey | null = null;

/** Lazily create the in-memory master key: a random 256-bit PBKDF2 base key.
 *  Never persisted anywhere. On refresh / tab close it's gone, so stored
 *  ciphertext becomes undecryptable. Returns null if Web Crypto unavailable. */
async function getMasterKey(): Promise<CryptoKey | null> {
  if (masterKey) return masterKey;
  try {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    masterKey = await crypto.subtle.importKey(
      "raw",
      raw,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return masterKey;
  } catch {
    return null;
  }
}

// --- Encryption (optional session persistence) ---

function getStorageKeys(prefix: string) {
  return {
    enc: `${prefix}.enc`,
    salt: `${prefix}.salt`,
    iv: `${prefix}.iv`,
  };
}

/**
 * Encrypt a key with the in-memory master key and store ONLY the ciphertext,
 * salt and IV in sessionStorage. The AES key itself is never exported/saved.
 */
async function encryptAndStore(key: string, prefix: string): Promise<void> {
  try {
    const master = await getMasterKey();
    if (!master) return; // Web Crypto unavailable — key stays in memory only

    const { enc, salt, iv } = getStorageKeys(prefix);

    // Random salt + IV for this key.
    const saltRaw = crypto.getRandomValues(new Uint8Array(16));
    const ivRaw = crypto.getRandomValues(new Uint8Array(12));

    // Derive a per-key AES key from the master key (salt makes each ciphertext's
    // key unique even if the same master is reused).
    const derivedKey = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltRaw, iterations: 310_000, hash: "SHA-256" },
      master,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    const encoded = new TextEncoder().encode(key);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ivRaw },
      derivedKey,
      encoded,
    );

    sessionStorage.setItem(enc, arrayBufferToBase64(ciphertext));
    sessionStorage.setItem(salt, arrayBufferToBase64(saltRaw.buffer));
    sessionStorage.setItem(iv, arrayBufferToBase64(ivRaw.buffer));
  } catch {
    // If encryption fails, don't persist — key stays in memory only
  }
}

/** Decrypt a key from sessionStorage using the in-memory master key. */
async function decryptAndLoad(prefix: string): Promise<string | null> {
  try {
    const master = await getMasterKey();
    if (!master) return null;

    const { enc, salt, iv } = getStorageKeys(prefix);
    const encB64 = sessionStorage.getItem(enc);
    const saltB64 = sessionStorage.getItem(salt);
    const ivB64 = sessionStorage.getItem(iv);
    if (!encB64 || !saltB64 || !ivB64) return null;

    const ciphertext = base64ToArrayBuffer(encB64);
    const saltRaw = new Uint8Array(base64ToArrayBuffer(saltB64));
    const ivRaw = new Uint8Array(base64ToArrayBuffer(ivB64));

    const derivedKey = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltRaw, iterations: 310_000, hash: "SHA-256" },
      master,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivRaw },
      derivedKey,
      ciphertext,
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

/** Whether ciphertext for a slot exists in sessionStorage (regardless of
 *  whether the master key is still available). Used by the UI to show
 *  "a key was configured but must be re-entered after refresh". */
function hasStoredCiphertext(prefix: string): boolean {
  try {
    const { enc } = getStorageKeys(prefix);
    return !!sessionStorage.getItem(enc);
  } catch {
    return false;
  }
}

/** Remove encrypted key data from sessionStorage. */
function clearStored(prefix: string): void {
  const { enc, salt, iv } = getStorageKeys(prefix);
  sessionStorage.removeItem(enc);
  sessionStorage.removeItem(salt);
  sessionStorage.removeItem(iv);
}

// --- Helpers ---

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// --- Public API ---

export const apiKeyVault = {
  // ── LLM API key (backward-compatible methods) ──

  /** Set the LLM API key. Stores in memory + encrypted (master-key) in sessionStorage. */
  async setKey(key: string): Promise<void> {
    slots.llm.key = key;
    if (key) {
      await encryptAndStore(key, slots.llm.sessionPrefix);
    } else {
      clearStored(slots.llm.sessionPrefix);
    }
  },

  /** Get the LLM API key (from memory). Returns null if not set. */
  getKey(): string | null {
    return slots.llm.key;
  },

  /** Check if the LLM API key is set (in memory). */
  hasKey(): boolean {
    return !!slots.llm.key;
  },

  /** True if LLM ciphertext exists in sessionStorage but the in-memory key is
   *  gone (i.e. after a refresh) — the UI should tell the user to re-enter it. */
  llmNeedsReentry(): boolean {
    return hasStoredCiphertext(slots.llm.sessionPrefix) && !slots.llm.key;
  },

  /** Clear the LLM API key from memory and sessionStorage. */
  clear(): void {
    slots.llm.key = null;
    clearStored(slots.llm.sessionPrefix);
  },

  /** Restore the LLM key from encrypted sessionStorage (only possible within
   *  the SAME page load — the master key is memory-only). Returns true if
   *  successfully restored. */
  async tryRestore(): Promise<boolean> {
    if (slots.llm.key) return true; // already in memory
    const restored = await decryptAndLoad(slots.llm.sessionPrefix);
    if (restored) {
      slots.llm.key = restored;
      return true;
    }
    return false;
  },

  // ── Search API key ──

  /** Set the search API key. Stores in memory + encrypted (master-key) in sessionStorage. */
  async setSearchKey(key: string): Promise<void> {
    slots.search.key = key;
    if (key) {
      await encryptAndStore(key, slots.search.sessionPrefix);
    } else {
      clearStored(slots.search.sessionPrefix);
    }
  },

  /** Get the search API key (from memory). Returns null if not set. */
  getSearchKey(): string | null {
    return slots.search.key;
  },

  /** Check if the search API key is set (in memory). */
  hasSearchKey(): boolean {
    return !!slots.search.key;
  },

  /** True if search ciphertext exists but the in-memory key is gone (after refresh). */
  searchNeedsReentry(): boolean {
    return hasStoredCiphertext(slots.search.sessionPrefix) && !slots.search.key;
  },

  /** Clear the search API key from memory and sessionStorage. */
  clearSearchKey(): void {
    slots.search.key = null;
    clearStored(slots.search.sessionPrefix);
  },

  /** Restore the search key from encrypted sessionStorage (same page load only). */
  async tryRestoreSearchKey(): Promise<boolean> {
    if (slots.search.key) return true;
    const restored = await decryptAndLoad(slots.search.sessionPrefix);
    if (restored) {
      slots.search.key = restored;
      return true;
    }
    return false;
  },

  // ── Lock / lifecycle ──

  /** Wipe ALL keys from memory and sessionStorage immediately. */
  lockAll(): void {
    slots.llm.key = null;
    slots.search.key = null;
    clearStored(slots.llm.sessionPrefix);
    clearStored(slots.search.sessionPrefix);
  },

  /** Wipe a single slot. */
  lockSlot(slot: "llm" | "search"): void {
    slots[slot].key = null;
    clearStored(slots[slot].sessionPrefix);
  },
};
