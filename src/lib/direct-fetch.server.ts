/**
 * Free-first page fetching.
 *
 * Plain `fetch` costs nothing, so we try it before spending a Firecrawl credit.
 * It only works for static HTML (no JS rendering, no PDF parsing) — when the
 * result looks empty or JS-gated, callers fall back to Firecrawl.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Rough markdown-ish text extraction from raw HTML. */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<h([1-6])[^>]*>/gi, (_m, n) => `\n\n${"#".repeat(Number(n))} `);
  s = s.replace(/<\/h[1-6]>/gi, "\n");
  s = s.replace(/<(br|hr)\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|section|article|li|tr|table|ul|ol)>/gi, "\n");
  s = s.replace(/<td[^>]*>/gi, " | ");
  s = s.replace(/<li[^>]*>/gi, "\n- ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)));
  s = s.replace(/[ \t\u00a0]+/g, " ");
  s = s.replace(/\n\s*\n\s*\n+/g, "\n\n");
  return s.trim();
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], baseUrl).toString();
      if (/^https?:/i.test(u)) out.add(u);
    } catch {
      /* ignore malformed href */
    }
  }
  return [...out];
}

export type DirectPage = {
  ok: boolean;
  markdown: string;
  html: string;
  links: string[];
  title?: string;
  status?: number;
  reason?: string;
};

const EMPTY: DirectPage = { ok: false, markdown: "", html: "", links: [] };

/** Signals the HTML is a JS shell / bot wall where plain fetch is useless. */
function looksJsGated(html: string, text: string): boolean {
  if (text.length < 400) return true;
  if (/enable javascript|please enable js|checking your browser|cf-browser-verification|__NEXT_DATA__|ng-app|<div id="root">\s*<\/div>/i.test(html) && text.length < 1500) {
    return true;
  }
  return false;
}

/**
 * Fetches a page with plain HTTP. Returns `ok: false` when the page could not
 * be usefully read (network error, non-HTML, JS-gated, or near-empty), which
 * means the caller should pay for a Firecrawl scrape instead.
 */
export async function directFetch(
  url: string,
  opts?: { timeoutMs?: number; minChars?: number },
): Promise<DirectPage> {
  const timeoutMs = opts?.timeoutMs ?? Number(process.env.DIRECT_FETCH_TIMEOUT_MS ?? 15_000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ...EMPTY, reason: `fetch failed: ${(e as Error).message}` };
  }

  if (!res.ok) return { ...EMPTY, status: res.status, reason: `http ${res.status}` };

  const ct = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml|text\/plain|application\/xml|text\/xml/i.test(ct)) {
    // PDFs and binaries need Firecrawl's parser.
    return { ...EMPTY, status: res.status, reason: `unsupported content-type ${ct || "unknown"}` };
  }

  const html = await res.text().catch(() => "");
  if (!html) return { ...EMPTY, status: res.status, reason: "empty body" };

  const markdown = htmlToText(html);
  const minChars = opts?.minChars ?? 400;
  if (markdown.length < minChars || looksJsGated(html, markdown)) {
    return { ...EMPTY, status: res.status, html, reason: "js-gated or too little content" };
  }

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  return {
    ok: true,
    markdown,
    html,
    links: extractLinks(html, res.url || url),
    title,
    status: res.status,
  };
}
