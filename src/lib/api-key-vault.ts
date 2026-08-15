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
 * - **Master-key encryption:** API keys are encrypted with AES-GCM using a
 *   per-key AES key derived (PBKDF2 + random salt) from a 256-bit master key.
 *   The master key itself is persisted (Base64) to localStorage so a page
 *   refresh can restore the in-memory master key and decrypt the stored
 *   ciphertext — keys survive refreshes without re-entry. This trades the
 *   previous "XSS cannot decrypt" guarantee for a modern "keys persist
 *   across refreshes" UX; this is a local tool where the user accepted the
 *   local XSS risk as acceptable.
 * - `lock()` / `lockAll()` wipe keys from memory AND localStorage (the
 *   master key stays in localStorage so future keys still persist).
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
  storagePrefix: string;
}

const slots: Record<string, KeySlot> = {
  llm: { key: null, storagePrefix: "opencode-web.key" },
  search: { key: null, storagePrefix: "opencode-web.search-key" },
};

// --- Master key ---
// A random 256-bit seed is generated once. Its RAW BYTES are persisted
// (Base64) to localStorage so a page refresh / new tab can re-derive the SAME
// PBKDF2 key and decrypt stored ciphertexts. The seed is cached in memory.
// NOTE: a PBKDF2 CryptoKey cannot be exported (`exportKey` throws "PBKDF2 keys
// are not extractable"), so we must persist the seed bytes and re-import rather
// than exporting the key object.

let masterKey: CryptoKey | null = null;
let masterSeed: Uint8Array<ArrayBuffer> | null = null;
const MASTER_KEY_STORAGE = "opencode-web.master";

/** 主密钥 seed 持久化：把原始 32 字节写入 localStorage（Base64），刷新后可
 *  恢复、得到同一个 PBKDF2 主密钥，从而解密存储的密文。接受本地 XSS 风险。 */
function persistMasterKey(): void {
  try {
    if (masterSeed) {
      localStorage.setItem(MASTER_KEY_STORAGE, arrayBufferToBase64(masterSeed));
    }
  } catch {
    /* ignore — 无法持久化则仅内存 */
  }
}

/** 用给定的原始字节生成 PBKDF2 主密钥并缓存。 */
async function deriveMasterFromSeed(seed: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    seed,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
}

/** Lazily create (and persist) the master key — a random 256-bit PBKDF2 base
 *  key. On refresh, restored from localStorage so stored ciphertext decrypts.
 *  Returns null if Web Crypto unavailable. */
async function getMasterKey(): Promise<CryptoKey | null> {
  if (masterKey) return masterKey;
  try {
    // 先从 localStorage 恢复持久化的 seed
    const stored = localStorage.getItem(MASTER_KEY_STORAGE);
    if (stored) {
      // 兼容历史格式：旧实现可能存的是 base64，直接解析字节即可。
      masterSeed = new Uint8Array(base64ToArrayBuffer(stored));
      masterKey = await deriveMasterFromSeed(masterSeed);
      return masterKey;
    }
    // 无持久化 seed → 生成新的 32 字节 seed 并持久化。
    masterSeed = crypto.getRandomValues(new Uint8Array(32));
    persistMasterKey();
    masterKey = await deriveMasterFromSeed(masterSeed);
    return masterKey;
  } catch {
    return null;
  }
}

/** 判断是否已配置过主密钥（用于决定是否首次弹设置）。 */
export function hasPersistentMasterKey(): boolean {
  try {
    return !!localStorage.getItem(MASTER_KEY_STORAGE);
  } catch {
    return false;
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
 * Encrypt a key with the in-memory master key and store the ciphertext, salt
 * and IV in localStorage (persists across refresh / tabs / restarts). The AES
 * key itself is never exported/saved. XSS can read both the encrypted blob and
 * the persisted master key — this is the accepted local-security tradeoff for
 * the "keys survive refresh" UX.
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

    localStorage.setItem(enc, arrayBufferToBase64(ciphertext));
    localStorage.setItem(salt, arrayBufferToBase64(saltRaw.buffer));
    localStorage.setItem(iv, arrayBufferToBase64(ivRaw.buffer));
  } catch {
    // If encryption fails, don't persist — key stays in memory only
  }
}

/** Decrypt a key from localStorage using the in-memory master key.
 *  If ciphertext exists but fails to decrypt (stale/corrupt — e.g. written under
 *  a different ephemeral master key before persistence was fixed), the stored
 *  blob is cleared so it can't linger and trigger misleading re-entry prompts. */
async function decryptAndLoad(prefix: string): Promise<string | null> {
  try {
    const master = await getMasterKey();
    if (!master) return null;

    const { enc, salt, iv } = getStorageKeys(prefix);
    const encB64 = localStorage.getItem(enc);
    const saltB64 = localStorage.getItem(salt);
    const ivB64 = localStorage.getItem(iv);
    if (!encB64 || !saltB64 || !ivB64) return null;

    try {
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
      // Stored data present but undecryptable → wipe the stale blob.
      clearStored(prefix);
      return null;
    }
  } catch {
    return null;
  }
}

/** Whether ciphertext for a slot exists in localStorage (regardless of
 *  whether the master key is still available). */
function hasStoredCiphertext(prefix: string): boolean {
  try {
    const { enc } = getStorageKeys(prefix);
    return !!localStorage.getItem(enc);
  } catch {
    return false;
  }
}

/** Remove encrypted key data from localStorage. */
function clearStored(prefix: string): void {
  const { enc, salt, iv } = getStorageKeys(prefix);
  localStorage.removeItem(enc);
  localStorage.removeItem(salt);
  localStorage.removeItem(iv);
}

// --- Helpers ---

function arrayBufferToBase64(buf: ArrayBuffer | Uint8Array<ArrayBufferLike>): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
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

  /** Set the LLM API key. Stores in memory + encrypted (master-key) in localStorage. */
  async setKey(key: string): Promise<void> {
    slots.llm.key = key;
    if (key) {
      await encryptAndStore(key, slots.llm.storagePrefix);
    } else {
      clearStored(slots.llm.storagePrefix);
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

  /** True if ciphertext exists in localStorage but the in-memory key is gone —
   *  normally impossible now since the master key + ciphertext both persist;
   *  kept as a defensive fallback in case decryption/restore fails. */
  llmNeedsReentry(): boolean {
    return hasStoredCiphertext(slots.llm.storagePrefix) && !slots.llm.key;
  },

  /** Clear the LLM API key from memory and localStorage. */
  clear(): void {
    slots.llm.key = null;
    clearStored(slots.llm.storagePrefix);
  },

  /** Restore the LLM key from the encrypted localStorage copy (works across
   *  refresh, new tabs, and browser restarts — master key is persisted too).
   *  Returns true if successfully restored. */
  async tryRestore(): Promise<boolean> {
    if (slots.llm.key) return true; // already in memory
    const restored = await decryptAndLoad(slots.llm.storagePrefix);
    if (restored) {
      slots.llm.key = restored;
      return true;
    }
    return false;
  },

  // ── Search API key ──

  /** Set the search API key. Stores in memory + encrypted (master-key) in localStorage. */
  async setSearchKey(key: string): Promise<void> {
    slots.search.key = key;
    if (key) {
      await encryptAndStore(key, slots.search.storagePrefix);
    } else {
      clearStored(slots.search.storagePrefix);
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

  /** True if search ciphertext exists in localStorage but the in-memory key is gone. */
  searchNeedsReentry(): boolean {
    return hasStoredCiphertext(slots.search.storagePrefix) && !slots.search.key;
  },

  /** Clear the search API key from memory and localStorage. */
  clearSearchKey(): void {
    slots.search.key = null;
    clearStored(slots.search.storagePrefix);
  },

  /** Restore the search key from the encrypted localStorage copy (across refresh / tabs). */
  async tryRestoreSearchKey(): Promise<boolean> {
    if (slots.search.key) return true;
    const restored = await decryptAndLoad(slots.search.storagePrefix);
    if (restored) {
      slots.search.key = restored;
      return true;
    }
    return false;
  },

  // ── Lock / lifecycle ──

  /** Wipe ALL keys from memory and localStorage immediately. */
  lockAll(): void {
    slots.llm.key = null;
    slots.search.key = null;
    clearStored(slots.llm.storagePrefix);
    clearStored(slots.search.storagePrefix);
  },

  /** Wipe a single slot. */
  lockSlot(slot: "llm" | "search"): void {
    slots[slot].key = null;
    clearStored(slots[slot].storagePrefix);
  },
};
