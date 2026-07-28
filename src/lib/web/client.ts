/**
 * Web client — browser fetch utilities for the AI agent's web tools.
 *
 * Fetch strategy (tried in order):
 *   1. Direct fetch() — works for CORS-enabled APIs (GitHub API, JSONPlaceholder, etc.)
 *   2. If direct fails with CORS error, try via Jina AI Reader (r.jina.ai) — free,
 *      no API key needed, returns LLM-friendly markdown. *Not accessible from all regions.*
 *   3. If a custom CORS proxy URL is configured, try via proxy.
 *
 * The "try direct first" approach ensures we don't unnecessarily route through a
 * proxy for sites that already support CORS.
 */

const DEFAULT_TIMEOUT = 15_000;    // 15 seconds
const MAX_RESPONSE_SIZE = 1_000_000; // 1MB

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FetchUrlOptions {
  /** Expected response format. 'json' pretty-prints JSON. Default 'text'. */
  format?: "text" | "json";
  /** Route through Jina AI Reader to bypass CORS (default true, used as fallback). */
  useJinaReader?: boolean;
  /** Custom CORS proxy URL (e.g. "http://localhost:81/cors-proxy/"). */
  corsProxy?: string;
}

export interface FetchUrlResult {
  content: string;
  url: string;
  truncated: boolean;
  /** HTTP status code, if available. */
  status?: number;
}

// ---------------------------------------------------------------------------
// CORS error detection
// ---------------------------------------------------------------------------

/** Check if an error is likely a CORS-related failure. */
export function isCorsError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("network error") ||
      msg.includes("cors") ||
      msg.includes("load failed")
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Core fetch function
// ---------------------------------------------------------------------------

/**
 * Fetch a URL's content, with CORS bypass fallbacks.
 *
 * Strategy:
 *   1. Direct fetch first — works for CORS-enabled APIs.
 *   2. On CORS error, retry via Jina AI Reader (if enabled).
 *   3. On CORS error, retry via custom proxy (if configured).
 *
 * Returns the response body as a string, truncated to MAX_RESPONSE_SIZE.
 * Throws on network errors, HTTP errors, and timeouts.
 */
export async function fetchUrl(
  url: string,
  opts: FetchUrlOptions = {},
): Promise<FetchUrlResult> {
  const format = opts.format ?? "text";

  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Unsupported protocol: ${parsed.protocol}. Only http:// and https:// are allowed.`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Unsupported protocol")) throw e;
    throw new Error(`Invalid URL: "${url}". Please provide a valid URL starting with http:// or https://.`);
  }

  // Try strategies in order
  const errors: string[] = [];

  // Strategy 1: Direct fetch
  try {
    return await doFetch(url, { format });
  } catch (e) {
    errors.push(`Direct: ${e instanceof Error ? e.message : String(e)}`);

    // Only fall through to proxies on CORs / network errors, not HTTP errors
    if (!isCorsError(e) && !isNetworkError(e)) {
      throw e; // HTTP 4xx/5xx, timeout, etc — not a CORS issue
    }
  }

  // Strategy 2: Jina AI Reader (free CORS proxy)
  const useJinaReader = opts.useJinaReader !== false;
  if (useJinaReader && format !== "json") {
    const jinaUrl = `https://r.jina.ai/${url}`;
    try {
      const result = await doFetch(jinaUrl, {
        format,
        headers: { Accept: "text/plain" },
      });
      return {
        ...result,
        url: jinaUrl,
      };
    } catch (e) {
      errors.push(`Jina Reader: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Strategy 3: Custom CORS proxy
  const corsProxy = opts.corsProxy?.trim();
  if (corsProxy) {
    const base = corsProxy.replace(/\/+$/, "");
    const proxyUrl = `${base}/${url}`;
    try {
      return await doFetch(proxyUrl, { format });
    } catch (e) {
      errors.push(`Custom proxy: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // All strategies failed
  const lastErr = errors[errors.length - 1] || "Unknown error";
  throw new Error(
    `Failed to fetch URL. Tried direct request and ${useJinaReader ? "Jina Reader" : ""}${corsProxy ? " + custom proxy" : ""}.\n` +
    `Last error: ${lastErr}\n\n` +
    `Suggestions:\n` +
    `1. Use \`web_search\` to find the information instead\n` +
    `2. Configure a different CORS proxy URL in Settings → Web & Search`,
  );
}

// ---------------------------------------------------------------------------
// Internal fetch with timeout + size limit
// ---------------------------------------------------------------------------

async function doFetch(
  targetUrl: string,
  opts: { format?: "text" | "json"; headers?: Record<string, string> },
): Promise<FetchUrlResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const resp = await fetch(targetUrl, {
      signal: controller.signal,
      headers: opts.headers,
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}${resp.statusText ? " " + resp.statusText : ""}`);
    }

    let content = await readWithLimit(resp, MAX_RESPONSE_SIZE);

    // If the response is HTML (either by Content-Type or content sniffing),
    // strip HTML tags and extract readable text. This prevents the AI from
    // seeing raw <head>/<script>/<link> boilerplate when fetching web pages.
    const contentType = resp.headers.get("content-type") || "";
    if (
      opts.format !== "json" &&
      (contentType.includes("text/html") || looksLikeHtml(content))
    ) {
      content = htmlToText(content);
    }

    let output = content;
    if (opts.format === "json") {
      try {
        const parsed = JSON.parse(output);
        output = JSON.stringify(parsed, null, 2);
      } catch {
        // Not valid JSON — return raw text
      }
    }

    return {
      content: output,
      url: targetUrl,
      truncated: output.length >= MAX_RESPONSE_SIZE,
      status: resp.status,
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(`Request timed out after ${DEFAULT_TIMEOUT / 1000}s. The site may be slow or unreachable.`);
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a response body with a byte limit. */
async function readWithLimit(resp: Response, limit: number): Promise<string> {
  const reader = resp.body?.getReader();
  if (!reader) {
    return (await resp.text()).slice(0, limit);
  }

  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
    if (result.length > limit) {
      reader.cancel();
      break;
    }
  }
  result += decoder.decode();
  return result.slice(0, limit);
}

// ---------------------------------------------------------------------------
// HTML → text conversion
// ---------------------------------------------------------------------------

/** Check if a string looks like HTML (starts with DOCTYPE or <html). */
function looksLikeHtml(s: string): boolean {
  const trimmed = s.trimStart().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html") || trimmed.startsWith("<!" );
}

/** Strip HTML tags and extract readable text content. */
function htmlToText(html: string): string {
  // Remove <script>, <style>, <svg>, <noscript> blocks and their content
  let text = html.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>\s*/gi, " ");
  text = text.replace(
    /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>\s*/gi, " ");
  text = text.replace(
    /<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>\s*/gi, " ");
  text = text.replace(
    /<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>\s*/gi, " ");

  // Replace <br>, <p>, <div>, <li>, <tr>, <h1-6>, <hr> with newlines
  text = text.replace(
    /<\/(?:p|div|h[1-6]|li|ol|ul|tr|th|td|blockquote|pre|section|article|main|header|footer|nav|figure|figcaption|details|summary|address)>/gi,
    "\n",
  );
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Strip remaining HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#x27;/g, "'");
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&[a-z]+;/g, " "); // fallback for other entities

  // Collapse multiple blank lines into one
  text = text.replace(/\n{3,}/g, "\n\n");

  // Trim each line and collapse multiple spaces
  text = text.split("\n").map((l) => l.trim().replace(/\s{2,}/g, " ")).join("\n");

  return text.trim();
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const msg = err.message.toLowerCase();
    return msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed");
  }
  return false;
}

/** Classify a network error into a user-friendly message. */
export function classifyNetworkError(err: unknown): string {
  if (isCorsError(err)) {
    return "CORS restriction: the target website does not allow cross-origin requests from browser-based apps.";
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("timed out") || msg.includes("timeout")) {
      return "Request timed out. The site may be slow or unreachable.";
    }
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      return "Network error: could not reach the server. Check the URL and your internet connection.";
    }
    if (msg.includes("HTTP 429") || msg.includes("429")) {
      return "Rate limited by the server. Try again later.";
    }
    if (msg.includes("HTTP 4")) {
      return `The server returned an error: ${msg}`;
    }
    return msg;
  }
  return "An unknown network error occurred.";
}
