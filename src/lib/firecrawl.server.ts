const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

function key(): string {
  const k = process.env.FIRECRAWL_API_KEY;
  if (!k) throw new Error("FIRECRAWL_API_KEY not configured");
  return k;
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
  const res = await fetch(`${FIRECRAWL_V2}/scrape`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: opts?.formats ?? ["markdown", "links"],
      onlyMainContent: opts?.onlyMainContent ?? true,
      waitFor: opts?.waitFor,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Firecrawl scrape ${res.status}: ${JSON.stringify(body)?.slice(0, 300)}`);
  // v2 sometimes nests under data
  const b = body as { data?: ScrapeResult } & ScrapeResult;
  return { markdown: b.markdown ?? b.data?.markdown, html: b.html ?? b.data?.html, links: b.links ?? b.data?.links, metadata: b.metadata ?? b.data?.metadata };
}

export async function firecrawlSearch(
  query: string,
  opts?: { limit?: number; scrapeMarkdown?: boolean },
): Promise<Array<{ url: string; title?: string; description?: string; markdown?: string }>> {
  const res = await fetch(`${FIRECRAWL_V2}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      limit: opts?.limit ?? 5,
      scrapeOptions: opts?.scrapeMarkdown ? { formats: ["markdown"] } : undefined,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Firecrawl search ${res.status}: ${JSON.stringify(body)?.slice(0, 300)}`);
  const b = body as { data?: unknown; web?: unknown };
  const arr = (Array.isArray(b.data) ? b.data : Array.isArray(b.web) ? b.web : []) as Array<{
    url: string;
    title?: string;
    description?: string;
    markdown?: string;
  }>;
  return arr;
}
