import type { ExhibitorRecord } from "./pipeline-schemas";

export function cleanCompanyName(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+logo$/i, "")
    .replace(/^[-–—•\s]+/, "")
    .trim();
}

export function normalizedCompanyKey(value: string): string {
  return cleanCompanyName(value)
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/\b(incorporated|inc|llc|ltd|limited|corp|corporation|company|co|gmbh|ag|sa)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function isLikelyCompanyName(value: string): boolean {
  const name = cleanCompanyName(value);
  if (name.length < 2 || name.length > 100) return false;
  if (/^(download|add to planner|view details|company information|contact us|products?|videos?|show specials?|international manufacturing technology show|map your show)$/i.test(name)) {
    return false;
  }
  if (/^(decorative|mobile app|banner|close this banner)$/i.test(name)) return false;
  if (/^(facebook|linkedin|instagram|youtube|x|twitter)$/i.test(name)) return false;
  return /[A-Za-z0-9]/.test(name);
}

function firstCompanyWebsite(markdown: string): string | null {
  const links = Array.from(markdown.matchAll(/\[([^\]]{2,120})\]\((https?:\/\/[^)\s"]+)/g));
  for (const match of links) {
    const label = match[1].toLowerCase();
    const url = match[2];
    if (/facebook|linkedin|instagram|youtube|twitter|planner|download|mapyourshow|directory\.imts|cloudfront|showfiles/i.test(url)) continue;
    if (/visit .* web|\.com|\.net|\.org|\.io|\.de|\.co/i.test(label) || /^https?:\/\//i.test(url)) return url;
  }
  return null;
}

function firstBoothNumber(markdown: string): string | null {
  const match = /\b(?:booth|stand|location)\s*(?:number|#|no\.)?\s*[:#-]?\s*([A-Z]{0,4}\d[\w.-]{1,12})\b/i.exec(markdown);
  return match?.[1] ?? null;
}

function addExhibitor(out: Map<string, ExhibitorRecord>, exhibitor: ExhibitorRecord) {
  const company = cleanCompanyName(exhibitor.company_name);
  if (!isLikelyCompanyName(company)) return;
  const key = normalizedCompanyKey(company);
  if (!key || out.has(key)) return;
  out.set(key, {
    ...exhibitor,
    company_name: company,
    normalized_company_name: exhibitor.normalized_company_name ?? key,
  });
}

const LIST_NOISE_RE =
  /^(as of|exhibitors?|exhibitor list|company|booth|page \d+|updated|table of contents|\d{1,4})\b/i;

/**
 * PDF exhibitor lists (and simple HTML lists) are just one company per line,
 * often wrapped mid-name by the PDF layout. Rejoin wrapped lines and keep the
 * entries that look like company names.
 */
export function parseExhibitorsFromPlainList(markdown: string, max = 500): ExhibitorRecord[] {
  const raw = markdown
    .split("\n")
    .map((l) => l.replace(/^[-*•\s]+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Rejoin lines the PDF layout wrapped: "American Green Spring Diagnostics" + "Inc."
  const lines: string[] = [];
  for (const line of raw) {
    const prev = lines[lines.length - 1];
    const isContinuation =
      !!prev &&
      prev.length > 3 &&
      line.length < 60 &&
      (/^(inc\.?|llc|ltd\.?|corp\.?|co\.|gmbh|s\.a\.?|b\.v\.?|ag|plc|and)\b/i.test(line) ||
        /^[a-z(&]/.test(line));
    if (isContinuation) lines[lines.length - 1] = `${prev} ${line}`;
    else lines.push(line);
  }

  const out = new Map<string, ExhibitorRecord>();
  for (const line of lines) {
    if (out.size >= max) break;
    if (/^#/.test(line) || /^\|/.test(line)) continue;
    // "Acme Corp .... Booth 123" / "Acme Corp — 1042"
    const boothMatch = /^(.{2,90}?)[\s.\u2026|,–—-]{2,}([A-Z]{0,4}\d[\w.-]{0,8})$/.exec(line);
    const name = cleanCompanyName(boothMatch ? boothMatch[1] : line);
    if (!name || name.length < 3 || name.length > 90) continue;
    if (LIST_NOISE_RE.test(name)) continue;
    if (/^[^A-Za-z]*$/.test(name)) continue;
    if (name.split(" ").length > 10) continue;
    if (/[?!]$/.test(name)) continue;
    addExhibitor(out, {
      company_name: name,
      normalized_company_name: name,
      company_website: null,
      booth_number: boothMatch ? boothMatch[2] : null,
      category: null,
    });
  }


  return Array.from(out.values()).slice(0, max);
}

/**
 * Directory platforms often expose structured markdown already. Use deterministic
 * extraction before asking a model so a huge MapYourShow page cannot stall the run.
 */
export function parseExhibitorsFromMarkdown(markdown: string, sourceUrl: string, max = 30): ExhibitorRecord[] {
  const out = new Map<string, ExhibitorRecord>();
  const isDetailPage = /exhibitor-details\.cfm|\/exhibitor\//i.test(sourceUrl) || /##\s*Company Information/i.test(markdown);

  if (isDetailPage) {
    const heading = markdown
      .split("\n")
      .map((line) => line.match(/^#\s+(.+)$/)?.[1])
      .find((name) => name && isLikelyCompanyName(name));
    const logo = markdown.match(/!\[([^\]]{2,100})\s+logo\]/i)?.[1];
    const company = cleanCompanyName(heading ?? logo ?? "");
    if (company) {
      addExhibitor(out, {
        company_name: company,
        normalized_company_name: company,
        company_website: firstCompanyWebsite(markdown),
        booth_number: firstBoothNumber(markdown),
        category: null,
      });
    }
  }

  for (const match of markdown.matchAll(/(?<!!)\[([^\]\n]{2,100})\]\(([^)\s"]*exhibitor-details\.cfm[^)\s"]*)/gi)) {
    addExhibitor(out, {
      company_name: match[1],
      normalized_company_name: match[1],
      company_website: null,
      booth_number: null,
      category: null,
    });
    if (out.size >= max) return Array.from(out.values());
  }

  for (const match of markdown.matchAll(/!\[([^\]]{2,100})\s+logo\]/gi)) {
    addExhibitor(out, {
      company_name: match[1],
      normalized_company_name: match[1],
      company_website: null,
      booth_number: null,
      category: null,
    });
    if (out.size >= max) return Array.from(out.values());
  }

  if (out.size === 0) {
    // Plain company-per-line lists: PDF handouts and simple HTML pages.
    for (const ex of parseExhibitorsFromPlainList(markdown, max)) addExhibitor(out, ex);
  }

  return Array.from(out.values()).slice(0, max);
}