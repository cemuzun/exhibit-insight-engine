import { firecrawlLimiter, guarded, RateLimitError } from "./rate-limit.server";
import { withCache, type CacheOptions } from "./firecrawl-cache.server";
import { directFetch } from "./direct-fetch.server";


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
  /** true when the page came from the cache instead of a fresh fetch */
  fromCache?: boolean;
  /** true when a free direct fetch served the page (no Firecrawl credit spent) */
  free?: boolean;
};

/** Counters so the UI can show how much of the crawl stayed free. */
export const fetchStats = { direct: 0, firecrawl: 0 };

function cheapModeEnabled() {
  return process.env.SCRAPE_MODE !== "firecrawl_only";
}

export async function firecrawlScrape(
  url: string,
  opts?: {
    formats?: string[];
    onlyMainContent?: boolean;
    waitFor?: number;
    /** e.g. ["pdf"] so Firecrawl converts a linked PDF into markdown. */
    parsers?: string[];
    cache?: CacheOptions;
    /** skip the free direct fetch (JS-rendered page, PDF, etc.) */
    forceFirecrawl?: boolean;
  },
): Promise<ScrapeResult> {
  const payload = {
    url,
    formats: opts?.formats ?? ["markdown", "links"],
    onlyMainContent: opts?.onlyMainContent ?? true,
    waitFor: opts?.waitFor,
    parsers: opts?.parsers,
  };

  const canTryFree =
    cheapModeEnabled() &&
    !opts?.forceFirecrawl &&
    !opts?.waitFor &&
    !opts?.parsers?.length &&
    !/\.pdf(\?|$)/i.test(url);

  const produce = async (): Promise<({ data?: ScrapeResult } & ScrapeResult) | null> => {
    if (canTryFree) {
      const direct = await directFetch(url);
      if (direct.ok) {
        fetchStats.direct += 1;
        return {
          markdown: direct.markdown,
          html: direct.html,
          links: direct.links,
          metadata: { title: direct.title, sourceURL: url, statusCode: direct.status },
          free: true,
        };
      }
    }
    fetchStats.firecrawl += 1;
    return firecrawlPost<({ data?: ScrapeResult } & ScrapeResult) | null>("/scrape", payload, "scrape");
  };

  const { value: body, cached } = await withCache<({ data?: ScrapeResult } & ScrapeResult) | null>(
    "scrape",
    payload,
    produce,
    opts?.cache ?? {},
  );
  const b = body ?? {};
  // v2 sometimes nests under data
  return {
    markdown: b.markdown ?? b.data?.markdown,
    html: b.html ?? b.data?.html,
    links: b.links ?? b.data?.links,
    metadata: b.metadata ?? b.data?.metadata,
    free: b.free,
    fromCache: cached,
  };
}


/** Free URL discovery via robots.txt / sitemap.xml (no Firecrawl credits). */
async function sitemapUrls(url: string, limit: number, search?: string): Promise<string[]> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return [];
  }
  const seeds = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap-index.xml`];
  try {
    const robots = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(8000) });
    if (robots.ok) {
      const txt = await robots.text();
      for (const m of txt.matchAll(/sitemap:\s*(\S+)/gi)) seeds.push(m[1]);
    }
  } catch {
    /* ignore */
  }

  const seen = new Set<string>();
  const out = new Set<string>();
  const queue = [...new Set(seeds)];
  let fetched = 0;

  while (queue.length && out.size < limit && fetched < 12) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    fetched += 1;
    let xml = "";
    try {
      const r = await fetch(sm, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) continue;
      xml = await r.text();
    } catch {
      continue;
    }
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    const isIndex = /<sitemapindex/i.test(xml);
    for (const loc of locs) {
      if (isIndex || /\.xml(\.gz)?$/i.test(loc)) {
        if (queue.length < 12) queue.push(loc);
      } else if (/^https?:\/\//i.test(loc)) {
        if (search && !loc.toLowerCase().includes(search.toLowerCase())) continue;
        out.add(loc);
        if (out.size >= limit) break;
      }
    }
  }
  return [...out];
}


/**
 * Fast URL discovery for a site. Surfaces deep pages (and PDFs) that are never
 * linked from the event homepage — often the only path to an exhibitor list.
 */
export async function firecrawlMap(
  url: string,
  opts?: { search?: string; limit?: number; cache?: CacheOptions },
): Promise<string[]> {
  const payload = { url, search: opts?.search, limit: opts?.limit ?? 100 };
  const { value: body } = await withCache<{ links?: unknown; data?: { links?: unknown } } | null>(
    "map",
    payload,
    async () => {
      if (cheapModeEnabled()) {
        const free = await sitemapUrls(url, opts?.limit ?? 100, opts?.search);
        if (free.length >= 5) {
          fetchStats.direct += 1;
          return { links: free };
        }
      }
      fetchStats.firecrawl += 1;
      return firecrawlPost<{ links?: unknown; data?: { links?: unknown } } | null>("/map", payload, "map");
    },
    opts?.cache ?? {},
  );

  const raw = (body?.links ?? body?.data?.links ?? []) as Array<string | { url?: string }>;
  return raw
    .map((l) => (typeof l === "string" ? l : l?.url))
    .filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u));
}

export async function firecrawlSearch(
  query: string,
  opts?: { limit?: number; scrapeMarkdown?: boolean; cache?: CacheOptions },
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
    opts?.cache ?? {},
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
