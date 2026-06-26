import { extractTopResults } from "./extract.js";

const SEARXNG_URL = (process.env.SEARXNG_URL ?? "http://searxng:8080").replace(/\/+$/, "");

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const SEARCH_LIMIT = envInt("SEARCH_LIMIT", 5);
const EXTRACT_LIMIT = envInt("EXTRACT_LIMIT", 3);
const EXTRACT_TIMEOUT_MS = envInt("EXTRACT_TIMEOUT_MS", 5000);
const SEARCH_CACHE_TTL_MS = envInt("SEARCH_CACHE_TTL_MS", 300_000);
const SEARCH_SNIPPET_ONLY = (process.env.SEARCH_SNIPPET_ONLY ?? "false").toLowerCase() === "true";
const CACHE_MAX_ENTRIES = 100;

export type SearchResult = {
  title: string;
  url: string;
  content: string;
  source: "extracted" | "snippet";
};

export type SearchResponse = {
  query: string;
  cached: boolean;
  results: SearchResult[];
  timing: { searchMs: number; extractMs: number };
};

type CacheEntry = { expiresAt: number; value: SearchResponse };

const cache = new Map<string, CacheEntry>();

const QUESTION_PREFIXES = [
  /^what (is|are|was|were) (the )?/i,
  /^how (do|does|can|could|would|much|many) (i |you |we |one )?(the )?/i,
  /^can you (tell me |explain |find )?(what |how |why |the )?/i,
  /^please (tell me |explain |find )?(what |how |the )?/i,
  /^tell me (about |what |how |the )?/i,
  /^who (is|are|was|were) (the )?/i,
  /^when (is|are|was|were|did|does|will) (the )?/i,
  /^where (is|are|was|were|can|do) (the )?/i,
  /^why (is|are|was|were|do|does|did) (the )?/i,
  /^is there (a |an )?/i,
  /^are there (any )?/i,
];

const SEARCH_FILLER_WORDS = new Set([
  "a",
  "an",
  "the",
  "please",
  "currently",
  "right",
  "now",
  "today",
]);

function shapeQuery(raw: string): string {
  let q = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/[?!.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  for (const re of QUESTION_PREFIXES) {
    q = q.replace(re, "");
  }

  q = q.trim();

  if (q.length > 200) {
    const cut = q.slice(0, 200);
    const lastSpace = cut.lastIndexOf(" ");
    q = lastSpace > 80 ? cut.slice(0, lastSpace) : cut;
  }

  return q;
}

function simplifyQuery(query: string): string {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word && !SEARCH_FILLER_WORDS.has(word));
  return words.join(" ").trim();
}

function cacheGet(key: string): SearchResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key: string, value: SearchResponse) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, value });
}

type SearxResult = { title?: string; url?: string; content?: string };

async function fetchSearxng(query: string): Promise<SearxResult[]> {
  const url = new URL(`${SEARXNG_URL}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "en");
  url.searchParams.set("categories", "general");
  url.searchParams.set("pageno", "1");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = body.slice(0, 200);
    throw new Error(`SearXNG returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  const data = (await res.json()) as { results?: SearxResult[] };
  return (data.results ?? []).filter((r) => r.title && r.url).slice(0, SEARCH_LIMIT);
}

function mergeResults(
  searxResults: SearxResult[],
  extracted: Map<string, { title: string; content: string }>,
): SearchResult[] {
  return searxResults.map((r) => {
    const url = r.url!;
    const page = extracted.get(url);
    if (page?.content) {
      return { title: page.title || r.title!, url, content: page.content, source: "extracted" as const };
    }
    return {
      title: r.title!,
      url,
      content: (r.content ?? "").trim(),
      source: "snippet" as const,
    };
  });
}

export async function checkSearch(): Promise<boolean> {
  try {
    const url = new URL(`${SEARXNG_URL}/search`);
    url.searchParams.set("q", "healthcheck");
    url.searchParams.set("format", "json");
    url.searchParams.set("categories", "general");

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;

    const data = (await res.json()) as { results?: unknown[] };
    return Array.isArray(data.results);
  } catch {
    return false;
  }
}

export async function searchWeb(rawQuery: string): Promise<SearchResponse> {
  const query = shapeQuery(rawQuery);
  if (!query) {
    return { query: "", cached: false, results: [], timing: { searchMs: 0, extractMs: 0 } };
  }

  const cacheKey = query.toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached) {
    return { ...cached, cached: true, timing: { searchMs: 0, extractMs: 0 } };
  }

  const searchStart = Date.now();
  let searxResults = await fetchSearxng(query);

  if (searxResults.length === 0) {
    const simplified = simplifyQuery(query);
    if (simplified && simplified !== query.toLowerCase()) {
      searxResults = await fetchSearxng(simplified);
    }
  }

  const searchMs = Date.now() - searchStart;

  let extractMs = 0;
  let extracted = new Map<string, { title: string; content: string }>();

  if (!SEARCH_SNIPPET_ONLY && searxResults.length > 0) {
    const urls = searxResults.map((r) => r.url!).slice(0, EXTRACT_LIMIT);
    const extractStart = Date.now();
    const pages = await extractTopResults(urls, EXTRACT_LIMIT, EXTRACT_TIMEOUT_MS);
    extractMs = Date.now() - extractStart;
    extracted = new Map(
      [...pages.entries()].map(([url, page]) => [url, { title: page.title, content: page.content }]),
    );
  }

  const response: SearchResponse = {
    query,
    cached: false,
    results: mergeResults(searxResults, extracted),
    timing: { searchMs, extractMs },
  };

  if (response.results.length > 0) {
    cacheSet(cacheKey, response);
  }

  return response;
}
