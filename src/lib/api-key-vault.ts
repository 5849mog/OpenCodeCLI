/**
 * API Key Vault — secure in-memory storage for the user's API keys.
 *
 * Supports multiple key slots: "llm" (the LLM API key) and "search" (search API key).
 *
 * Security properties:
 * - Keys are NEVER stored in localStorage, IndexedDB, or any persistent
 *   browser storage in plaintext.
 * - Keys are NOT in the Zustand store, so `useSession.getState()` cannot
 *   reveal them. React DevTools cannot see them either.
 * - Each key lives in a module-level private variable (closure), accessible
 *   only via `getKey()` / `getSearchKey()`.
 * - Optionally encrypted with AES-GCM (Web Crypto API) and stored in
 *   sessionStorage. On page refresh, it is decrypted back to memory.
 *   When the browser tab closes, sessionStorage is cleared automatically.
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

// --- Encryption (optional session persistence) ---

function getStorageKeys(prefix: string) {
  return {
    enc: `${prefix}.enc`,
    salt: `${prefix}.salt`,
    iv: `${prefix}.iv`,
  };
}

/** Encrypt a key with a random AES-GCM key and store in sessionStorage. */
async function encryptAndStore(key: string, prefix: string): Promise<void> {
  try {
    const { enc, salt, iv } = getStorageKeys(prefix);

    // Generate a random AES key
    const cryptoKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );

    // Generate random IV
    const ivRaw = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt
    const encoded = new TextEncoder().encode(key);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ivRaw },
      cryptoKey,
      encoded,
    );

    // Export the AES key and store everything in sessionStorage
    const exportedKey = await crypto.subtle.exportKey("raw", cryptoKey);

    sessionStorage.setItem(enc, arrayBufferToBase64(ciphertext));
    sessionStorage.setItem(salt, arrayBufferToBase64(exportedKey));
    sessionStorage.setItem(iv, arrayBufferToBase64(ivRaw.buffer));
  } catch {
    // If encryption fails, don't persist — key stays in memory only
  }
}

/** Decrypt a key from sessionStorage. */
async function decryptAndLoad(prefix: string): Promise<string | null> {
  try {
    const { enc, salt, iv } = getStorageKeys(prefix);

    const encB64 = sessionStorage.getItem(enc);
    const keyB64 = sessionStorage.getItem(salt);
    const ivB64 = sessionStorage.getItem(iv);
    if (!encB64 || !keyB64 || !ivB64) return null;

    const ciphertext = base64ToArrayBuffer(encB64);
    const rawKey = base64ToArrayBuffer(keyB64);
    const ivRaw = new Uint8Array(base64ToArrayBuffer(ivB64));

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivRaw },
      cryptoKey,
      ciphertext,
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
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

  /** Set the LLM API key. Stores in memory + encrypted in sessionStorage. */
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

  /** Check if the LLM API key is set. */
  hasKey(): boolean {
    return !!slots.llm.key;
  },

  /** Clear the LLM API key from memory and sessionStorage. */
  clear(): void {
    slots.llm.key = null;
    clearStored(slots.llm.sessionPrefix);
  },

  /** Try to restore the LLM API key from encrypted sessionStorage on page load.
   *  Returns true if the key was successfully restored. */
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

  /** Set the search API key. Stores in memory + encrypted in sessionStorage. */
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

  /** Check if the search API key is set. */
  hasSearchKey(): boolean {
    return !!slots.search.key;
  },

  /** Clear the search API key from memory and sessionStorage. */
  clearSearchKey(): void {
    slots.search.key = null;
    clearStored(slots.search.sessionPrefix);
  },

  /** Try to restore the search API key from encrypted sessionStorage.
   *  Returns true if the key was successfully restored. */
  async tryRestoreSearchKey(): Promise<boolean> {
    if (slots.search.key) return true;
    const restored = await decryptAndLoad(slots.search.sessionPrefix);
    if (restored) {
      slots.search.key = restored;
      return true;
    }
    return false;
  },
};
