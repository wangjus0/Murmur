import { tavily } from "@tavily/core";

export interface TavilySearchResult {
  /** Clean, Gemini-ready summary of top search results. */
  summary: string;
  /** Raw result snippets in case the caller wants to do its own synthesis. */
  results: Array<{ title: string; url: string; content: string; score: number }>;
}

const MAX_RESULTS = 5;
const MAX_CONTENT_CHARS_PER_RESULT = 600;

/**
 * Run a Tavily web search for `query` and return a structured result.
 * Returns null if the API key is missing or the call fails — the caller
 * should gracefully fall back to a Gemini-only answer in that case.
 */
export async function tavilySearch(
  query: string,
  apiKey: string,
  onStatus?: (message: string) => void
): Promise<TavilySearchResult | null> {
  if (!apiKey) {
    return null;
  }

  try {
    onStatus?.(`Searching the web for "${query}"...`);

    const client = tavily({ apiKey });

    const response = await client.search(query, {
      searchDepth: "basic",
      maxResults: MAX_RESULTS,
      includeAnswer: true,   // Tavily's own AI answer snippet
      includeRawContent: false,
    });

    // Normalize results — truncate long snippets so the Gemini context stays tight.
    const results = (response.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      content: (r.content ?? "").slice(0, MAX_CONTENT_CHARS_PER_RESULT),
      score: r.score ?? 0,
    }));

    // Build a compact summary: prefer Tavily's own answer when available,
    // otherwise concatenate the top snippet titles + content.
    let summary = "";
    if (typeof response.answer === "string" && response.answer.trim()) {
      summary = response.answer.trim();
    } else if (results.length > 0) {
      summary = results
        .slice(0, 3)
        .map((r) => `${r.title}: ${r.content}`)
        .join("\n\n");
    }

    return { summary, results };
  } catch (err) {
    console.error("[Tavily] Search failed:", err);
    return null;
  }
}
