import { DEFAULT_TIMEOUT_MS, GLIN_USER_AGENT } from "./http.js";

const EXA_SEARCH_URL = "https://api.exa.ai/search";

export interface WebSearchOptions {
  query: string;
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
}

export interface WebSearchHit {
  url: string;
  title?: string;
  publishedDate?: string;
  author?: string;
  snippet?: string;
  score?: number;
}

export interface WebSearchResult {
  query: string;
  results: WebSearchHit[];
  costDollars?: number;
}

interface ExaSearchHit {
  url?: string;
  title?: string | null;
  publishedDate?: string;
  author?: string;
  score?: number;
  highlights?: string[];
}

interface ExaSearchResponse {
  results?: ExaSearchHit[];
  costDollars?: { total?: number };
  error?: string;
}

export async function webSearch(
  options: WebSearchOptions,
): Promise<WebSearchResult> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "EXA_API_KEY is not set — export it in the environment (get a key at https://dashboard.exa.ai)",
    );
  }

  const body: Record<string, unknown> = {
    query: options.query,
    numResults: options.numResults ?? 20,
    contents: { highlights: true },
  };
  if (options.includeDomains) body.includeDomains = options.includeDomains;
  if (options.excludeDomains) body.excludeDomains = options.excludeDomains;
  if (options.startPublishedDate) {
    body.startPublishedDate = options.startPublishedDate;
  }
  if (options.endPublishedDate) body.endPublishedDate = options.endPublishedDate;

  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(EXA_SEARCH_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "User-Agent": GLIN_USER_AGENT,
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms calling Exa search`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload: ExaSearchResponse;
  try {
    payload = JSON.parse(text) as ExaSearchResponse;
  } catch {
    throw new Error(
      response.ok
        ? "Exa search returned invalid JSON"
        : `Exa search failed with HTTP ${response.status}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      payload.error ?? `Exa search failed with HTTP ${response.status}`,
    );
  }
  if (!Array.isArray(payload.results)) {
    throw new Error("Exa search returned no results array");
  }

  const result: WebSearchResult = {
    query: options.query,
    results: payload.results.flatMap((r) => {
      if (!r.url) return [];
      const hit: WebSearchHit = { url: r.url };
      if (r.title) hit.title = r.title;
      if (r.publishedDate) hit.publishedDate = r.publishedDate;
      if (r.author) hit.author = r.author;
      if (r.score != null) hit.score = r.score;
      if (r.highlights && r.highlights.length > 0) {
        hit.snippet = r.highlights.join("\n\n");
      }
      return [hit];
    }),
  };
  if (payload.costDollars?.total != null) {
    result.costDollars = payload.costDollars.total;
  }
  return result;
}
