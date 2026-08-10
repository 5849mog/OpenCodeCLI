/**
 * Search provider abstraction — Tavily and Brave Search API clients.
 *
 * Both providers support CORS from browser-based apps, so we can call
 * them directly with fetch(). No SDK needed.
 *
 * Tavily:  POST https://api.tavily.com/search  (key in body)
 * Brave:   GET  https://api.search.brave.com/res/v1/web/search  (key in header)
 */

// ---------------------------------------------------------------------------
// Search API key — no built-in default. Users configure their own key in
// Settings → Web & Search (Tavily dev keys are free: https://tavily.com).
// Without a configured key, web_search returns a clear "please configure"
// message instead of failing cryptically.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Tavily returns full page content in 'content' field. */
  content?: string;
}

export interface SearchOptions {
  maxResults?: number;
}

export type SearchProviderName = "tavily" | "brave";

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

interface RawTavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results: RawTavilyResult[];
}

async function searchTavily(
  apiKey: string,
  query: string,
  opts: SearchOptions,
): Promise<SearchResult[]> {
  const maxResults = Math.min(Math.max(opts.maxResults ?? 5, 1), 10);

  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: maxResults,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw classifySearchError(resp.status, "Tavily", body);
  }

  const data: TavilyResponse = await resp.json();
  return (data.results || []).map((r) => ({
    title: r.title || "(no title)",
    url: r.url,
    snippet: r.content ? r.content.slice(0, 300) : "",
    content: r.content || "",
  }));
}

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

interface BraveResponse {
  web?: {
    results: BraveWebResult[];
  };
}

async function searchBrave(
  apiKey: string,
  query: string,
  opts: SearchOptions,
): Promise<SearchResult[]> {
  const count = Math.min(Math.max(opts.maxResults ?? 5, 1), 10);
  const params = new URLSearchParams({ q: query, count: String(count) });

  const resp = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params}`,
    {
      headers: { "X-Subscription-Token": apiKey },
    },
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw classifySearchError(resp.status, "Brave", body);
  }

  const data: BraveResponse = await resp.json();
  return (data.web?.results || []).map((r) => ({
    title: r.title || "(no title)",
    url: r.url,
    snippet: r.description || "",
  }));
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function classifySearchError(status: number, provider: string, body: string): Error {
  switch (status) {
    case 401:
    case 403:
      return new Error(
        `${provider}: API key is invalid or unauthorized. Check your key in Settings → Web & Search.`,
      );
    case 429:
      return new Error(
        `${provider}: Rate limited. Free tier: ~1000 queries/month (Tavily) or ~2000/month (Brave). Wait and try again.`,
      );
    case 402:
      return new Error(
        `${provider}: API quota exhausted. Check your billing plan.`,
      );
    default:
      return new Error(
        `${provider} API error (HTTP ${status}): ${body.slice(0, 200)}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search the web using the configured provider.
 *
 * @param provider - "tavily" or "brave"
 * @param apiKey - The API key for the provider
 * @param query - Search query string
 * @param opts - Optional settings (maxResults)
 * @returns Array of search results
 * @throws Error with user-friendly message on failure
 */
export async function searchWeb(
  provider: SearchProviderName,
  apiKey: string,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  if (!query.trim()) {
    throw new Error("Search query must not be empty.");
  }
  if (!apiKey) {
    throw new Error(
      `No API key configured for ${provider}. Open Settings → Web & Search to add your key.`,
    );
  }

  switch (provider) {
    case "tavily":
      return searchTavily(apiKey, query, opts);
    case "brave":
      return searchBrave(apiKey, query, opts);
    default:
      throw new Error(`Unsupported search provider: "${provider}". Use "tavily" or "brave".`);
  }
}
