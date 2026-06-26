import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const EXTRACT_TIMEOUT_MS = Number(process.env.EXTRACT_TIMEOUT_MS ?? 5000);
const MAX_CONTENT_CHARS = 2000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; HSC-Chat/1.0; +https://github.com/97115104/chat-openai-compatible)";

export type ExtractedPage = {
  url: string;
  title: string;
  content: string;
};

function truncate(text: string, max = MAX_CONTENT_CHARS): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export async function fetchAndExtract(url: string, timeoutMs = EXTRACT_TIMEOUT_MS): Promise<ExtractedPage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return null;
    }

    const html = await res.text();
    const { document } = parseHTML(html);
    const article = new Readability(document).parse();

    const title = article?.title?.trim() || document.title?.trim() || url;
    const content = truncate(article?.textContent ?? document.body?.textContent ?? "");

    if (!content) return null;
    return { url, title, content };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function extractTopResults(
  urls: string[],
  concurrency = 3,
  timeoutMs = EXTRACT_TIMEOUT_MS,
): Promise<Map<string, ExtractedPage>> {
  const results = new Map<string, ExtractedPage>();
  const queue = [...urls];

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift();
      if (!url) break;
      const page = await fetchAndExtract(url, timeoutMs);
      if (page) results.set(url, page);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
