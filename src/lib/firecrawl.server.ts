import { firecrawlLimiter, guarded, RateLimitError } from "./rate-limit.server";
import { withCache } from "./firecrawl-cache.server";

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

function key(): string {
  const k = process.env.FIRECRAWL_API_KEY;
  if (!k) throw new Error("FIRECRAWL_API_KEY not configured");
  return k;
}

function parseRetryAfter(res: Response, body?: unknown): number | undefined {
  const h = res.headers.get("retry-after");
  if (h) {
    const secs = Number(h);
    if (Number.isFinite(secs)) return secs * 1000;
    const date = Date.parse(h);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  // Firecrawl reports the reset window in the error body, not a header:
  // "... please retry after 39s, resets at Tue Jul 28 2026 14:55:17 GMT+0000"
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  const secMatch = /retry after (\d+)\s*s/i.exec(text);
  if (secMatch) return (Number(secMatch[1]) + 2) * 1000;
  const resetMatch = /resets at ([^"}]+)/i.exec(text);
  if (resetMatch) {
    const t = Date.parse(resetMatch[1].trim());
    if (Number.isFinite(t)) return Math.max(0, t - Date.now()) + 2000;
  }
  return undefined;
}

async function firecrawlPost<T>(path: string, payload: unknown, label: string): Promise<T> {
  return guarded(
    firecrawlLimiter,
    async () => {
      const timeoutMs = Number(process.env.FIRECRAWL_TIMEOUT_MS ?? 90_000);
      const res = await fetch(`${FIRECRAWL_V2}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      }).catch((e: Error) => {
        throw new Error(
          e.name === "TimeoutError" || e.name === "AbortError"
            ? `Firecrawl ${label} timed out after ${Math.round(timeoutMs / 1000)}s`
            : `Firecrawl ${label} request failed: ${e.message}`,
        );
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = JSON.stringify(body)?.slice(0, 300);
        throw new RateLimitError(
          `Firecrawl ${label} ${res.status}: ${detail}`,
          res.status,
          parseRetryAfter(res, body),
        );
      }
      return body as T;
    },
    { label: `firecrawl ${label}` },
  );
}

type ScrapeResult = {
  markdown?: string;
  html?: string;
  links?: string[];
  metadata?: { title?: string; description?: string; sourceURL?: string; statusCode?: number };
};

export async function firecrawlScrape(
  url: string,
  opts?: { formats?: string[]; onlyMainContent?: boolean; waitFor?: number },
): Promise<ScrapeResult> {
  const payload = {
    url,
    formats: opts?.formats ?? ["markdown", "links"],
    onlyMainContent: opts?.onlyMainContent ?? true,
    waitFor: opts?.waitFor,
  };
  const { value: body } = await withCache<({ data?: ScrapeResult } & ScrapeResult) | null>(
    "scrape",
    payload,
    () => firecrawlPost<({ data?: ScrapeResult } & ScrapeResult) | null>("/scrape", payload, "scrape"),
  );
  const b = body ?? {};
  // v2 sometimes nests under data
  return {
    markdown: b.markdown ?? b.data?.markdown,
    html: b.html ?? b.data?.html,
    links: b.links ?? b.data?.links,
    metadata: b.metadata ?? b.data?.metadata,
  };
}

export async function firecrawlSearch(
  query: string,
  opts?: { limit?: number; scrapeMarkdown?: boolean },
): Promise<Array<{ url: string; title?: string; description?: string; markdown?: string }>> {
  const payload = {
    query,
    limit: opts?.limit ?? 5,
    scrapeOptions: opts?.scrapeMarkdown ? { formats: ["markdown"] } : undefined,
  };
  const { value: body } = await withCache<{ data?: unknown; web?: unknown } | null>(
    "search",
    payload,
    () => firecrawlPost<{ data?: unknown; web?: unknown } | null>("/search", payload, "search"),
  );
  const b = body ?? {};
  const arr = (Array.isArray(b.data) ? b.data : Array.isArray(b.web) ? b.web : []) as Array<{
    url: string;
    title?: string;
    description?: string;
    markdown?: string;
  }>;
  return arr;
}
