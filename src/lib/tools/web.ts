/**
 * Web tool handlers for the AI agent.
 *
 * Implements:
 *   - toolWebSearch — search the internet via Tavily or Brave
 *   - toolFetchUrl  — fetch the content of a URL
 */

import type { ToolResult } from "./types";
import { apiKeyVault } from "@/lib/api-key-vault";
import { fetchUrl, classifyNetworkError, searchWeb, DEFAULT_SEARCH_API_KEY } from "@/lib/web";
import { useSession } from "@/store/session";

// ---------------------------------------------------------------------------
// web_search
// ---------------------------------------------------------------------------

export async function toolWebSearch(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) {
    return {
      ok: false,
      output: "web_search requires a 'query' argument — specify what you want to search for.",
      tool: "web_search",
      args,
    };
  }

  const maxResults = Math.min(Math.max(Number(args.max_results) || 5, 1), 10);

  // Get search API key — user-configured key takes precedence over built-in default
  const searchKey = apiKeyVault.getSearchKey() || DEFAULT_SEARCH_API_KEY;

  // Get the configured provider
  const config = useSession.getState().config;
  const provider = config.searchProvider === "brave" ? "brave" : "tavily";

  try {
    const results = await searchWeb(provider, searchKey, query, {
      maxResults,
    });

    if (results.length === 0) {
      return {
        ok: true,
        output: `No search results found for "${query}". Try rephrasing or using different keywords.`,
        tool: "web_search",
        args,
      };
    }

    const formatted = results
      .map(
        (r, i) =>
          `${i + 1}. [${r.title}](${r.url})\n   ${r.content ? r.content.slice(0, 300) : r.snippet || "(no description)"}`,
      )
      .join("\n\n");

    return {
      ok: true,
      output: `Search results for "${query}" (${results.length} results):\n\n${formatted}`,
      tool: "web_search",
      args,
    };
  } catch (e) {
    return {
      ok: false,
      output: `Web search failed: ${e instanceof Error ? e.message : String(e)}`,
      tool: "web_search",
      args,
    };
  }
}

// ---------------------------------------------------------------------------
// fetch_url
// ---------------------------------------------------------------------------

export async function toolFetchUrl(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const url = String(args.url ?? "").trim();
  if (!url) {
    return {
      ok: false,
      output: "fetch_url requires a 'url' argument — provide a full URL starting with http:// or https://.",
      tool: "fetch_url",
      args,
    };
  }

  const format = args.format === "json" ? "json" : "text";

  // Validate URL early
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        ok: false,
        output: `Unsupported protocol: ${parsed.protocol}. Only http:// and https:// URLs are supported.`,
        tool: "fetch_url",
        args,
      };
    }
  } catch {
    return {
      ok: false,
      output: `Invalid URL: "${url}". Please provide a valid URL starting with http:// or https://.`,
      tool: "fetch_url",
      args,
    };
  }

  const config = useSession.getState().config;

  try {
    const result = await fetchUrl(url, {
      format,
      useJinaReader: config.useJinaReader,
      corsProxy: config.corsProxyUrl || undefined,
    });

    // Trim very long output for the agent context
    const MAX_OUTPUT = 5000;
    let display = result.content;
    let truncated = false;
    if (display.length > MAX_OUTPUT) {
      display = display.slice(0, MAX_OUTPUT) + "\n\n... (content truncated)";
      truncated = true;
    }

    const info = truncated
      ? `Fetched ${url} (${result.content.length} chars) — showing first ${MAX_OUTPUT} chars.`
      : `Fetched ${url} (${result.content.length} chars).`;

    return {
      ok: true,
      output: `${info}\n\n${display}`,
      tool: "fetch_url",
      args,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isCors = msg.toLowerCase().includes("cors") || msg.includes("cross-origin");

    if (isCors) {
      return {
        ok: false,
        output:
          `⚠️ **无法获取该网页** — 浏览器安全限制（CORS）\n\n` +
          `"${url}" 不允许跨域请求。\n\n` +
          `**建议：**\n` +
          `1. 改用 \`web_search\` 搜索相关信息（内置搜索 Key，开箱即用）\n` +
          `2. 检查 Settings → Web & Search 中的 "Use Jina AI Reader" 是否已开启（默认开启，免费无需 Key）\n` +
          `3. 如果自己有 CORS 代理，可在 Settings → Web & Search 中配置`,
        tool: "fetch_url",
        args,
      };
    }

    return {
      ok: false,
      output: `Failed to fetch URL: ${msg}`,
      tool: "fetch_url",
      args,
    };
  }
}
