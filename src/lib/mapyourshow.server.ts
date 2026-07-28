import type { ExhibitorRecord } from "./pipeline-schemas";
import { cleanCompanyName, isLikelyCompanyName, normalizedCompanyKey } from "./exhibitor-parser";

/**
 * MapYourShow directories (IMTS, PACK EXPO, many large US shows) are Vue SPAs:
 * the rendered page contains no exhibitor rows at all, so scraping markdown
 * returns navigation chrome only. The app itself reads a public JSON endpoint
 * (`/ajax/remote-proxy.cfm?action=search&searchtype=exhibitoralpha`), so we
 * call the same endpoint letter by letter and get the complete list.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export function mapYourShowBase(url: string): string | null {
  try {
    const u = new URL(url);
    // MapYourShow installs always live under a versioned app root such as
    // "/8_0/", on mapyourshow.com or on the show's own directory subdomain.
    const version = /\/(\d+_\d+)(\/|$)/.exec(u.pathname)?.[1];
    if (!version) return null;
    return `${u.origin}/${version}`;
  } catch {
    return null;
  }
}


export function isMapYourShowUrl(url: string): boolean {
  return mapYourShowBase(url) !== null;
}

type Hit = {
  fields?: {
    exhid_l?: string;
    exhname_t?: string;
    exhdesc_t?: string;
    boothsdisplay_la?: string[];
  };
};

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
    },
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

/** Booth values are served with an anti-scrape suffix, e.g. "135644randomstring". */
function cleanBooth(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/randomstring/gi, "").trim();
  return cleaned || null;
}

async function alphaChars(base: string): Promise<string[]> {
  const body = await getJson<{ DATA?: Array<{ value?: string; count?: number }> }>(
    `${base}/ajax/remote-proxy.cfm?action=getsearchoptions&function=getexhibitoralphachars`,
  );
  return (body?.DATA ?? [])
    .map((d) => d.value)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

const DEFAULT_ALPHA = ["0", ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))];

/**
 * Big shows keep their exhibitor directory on a MapYourShow subdomain that the
 * event homepage may never link in plain HTML (directory.imts.com,
 * exhibitors.<show>.com, …). Probe the handful of conventional hosts and app
 * roots directly — each check is a single cheap JSON request.
 */
export async function discoverMapYourShowBase(officialUrl: string): Promise<string | null> {
  let host: string;
  try {
    host = new URL(officialUrl).hostname;
  } catch {
    return null;
  }
  const root = host.replace(/^www\./i, "");
  const hosts = [host, root, `directory.${root}`, `exhibitors.${root}`, `directory.${host}`];
  const versions = ["8_0", "7_0"];
  const bases = Array.from(
    new Set(hosts.flatMap((h) => versions.map((v) => `https://${h}/${v}`))),
  );
  const found = await Promise.all(
    bases.map(async (base) => ((await alphaChars(base)).length > 0 ? base : null)),
  );
  return found.find((b): b is string => b !== null) ?? null;
}


async function fetchLetter(base: string, letter: string, size: number): Promise<Hit[]> {
  const url =
    `${base}/ajax/remote-proxy.cfm?action=search&sortfield=title_t&sortdirection=asc` +
    `&search=${encodeURIComponent(letter)}&searchtype=exhibitoralpha&size-exhibitor=${size}`;
  const body = await getJson<{ DATA?: { results?: { exhibitor?: { hit?: Hit[] } } } }>(url);
  return body?.DATA?.results?.exhibitor?.hit ?? [];
}

export type MapYourShowResult = {
  /** Directory URL the rows came from. */
  url: string;
  /** Synthesized markdown listing so evidence checks have a source to match. */
  markdown: string;
  exhibitors: ExhibitorRecord[];
};

/**
 * Pull every exhibitor from a MapYourShow directory by walking its A–Z index.
 */
export async function fetchMapYourShowExhibitors(
  url: string,
  opts?: { max?: number; concurrency?: number },
): Promise<MapYourShowResult | null> {
  const base = mapYourShowBase(url);
  if (!base) return null;

  const max = opts?.max && opts.max > 0 ? opts.max : 100_000;
  const concurrency = opts?.concurrency ?? 4;
  const letters = await alphaChars(base);
  if (letters.length === 0) return null;

  const hits: Hit[] = [];
  for (let i = 0; i < letters.length; i += concurrency) {
    const batch = letters.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((l) => fetchLetter(base, l, 2000).catch(() => [])));
    for (const r of results) hits.push(...r);
    if (hits.length >= max) break;
  }
  if (hits.length === 0) return null;

  const byKey = new Map<string, ExhibitorRecord>();
  const lines: string[] = [`# Exhibitor directory (${base})`, ""];
  for (const hit of hits) {
    const name = cleanCompanyName(hit.fields?.exhname_t ?? "");
    if (!name || !isLikelyCompanyName(name)) continue;
    const key = normalizedCompanyKey(name);
    if (!key || byKey.has(key)) continue;
    const exhid = hit.fields?.exhid_l;
    const booth = cleanBooth(hit.fields?.boothsdisplay_la?.[0]);
    const profileUrl = exhid ? `${base}/exhibitor/exhibitor-details.cfm?exhid=${encodeURIComponent(exhid)}` : null;
    byKey.set(key, {
      company_name: name,
      normalized_company_name: key,
      company_website: null,
      booth_number: booth,
      category: null,
      ...(profileUrl ? { profile_url: profileUrl } : {}),
    } as ExhibitorRecord);
    lines.push(`- ${profileUrl ? `[${name}](${profileUrl})` : name}${booth ? ` — Booth ${booth}` : ""}`);
    if (byKey.size >= max) break;
  }
  if (byKey.size === 0) return null;

  return {
    url: `${base}/explore/exhibitor-alphalist.cfm`,
    markdown: lines.join("\n"),
    exhibitors: Array.from(byKey.values()),
  };
}
