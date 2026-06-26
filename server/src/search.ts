const SEARXNG_URL = (process.env.SEARXNG_URL ?? "http://searxng:8080").replace(/\/+$/, "");
const SEARCH_LIMIT = Number(process.env.SEARCH_LIMIT ?? 8);

export type SearchResult = {
  title: string;
  url: string;
  content: string;
};

export async function checkSearch() {
  try {
    const res = await fetch(`${SEARXNG_URL}/`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function searchWeb(query: string, limit = SEARCH_LIMIT): Promise<SearchResult[]> {
  const url = new URL(`${SEARXNG_URL}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "en");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`SearXNG returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? [])
    .filter((r) => r.title && r.url)
    .slice(0, limit)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      content: (r.content ?? "").trim(),
    }));
}
