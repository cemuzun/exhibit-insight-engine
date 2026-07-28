import type { ExhibitorRecord } from "./pipeline-schemas";

export function cleanCompanyName(value: string): string {
  return value
    .replace(/!?\[([^\]]*)\]\((?:[^)\s]*)(?:\s+"[^"]*")?\)/g, "$1") // markdown links → label
    .replace(/<[^>]+>/g, " ") // stray html tags
    .replace(/\s+/g, " ")
    .replace(/\s+logo$/i, "")
    .replace(/^[-–—•\s]+/, "")
    .replace(/[-–—•\s]+$/, "")
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

/** Navigation labels, section headings and UI chrome that are never companies. */
const NAV_NOISE = new Set(
  [
    "attendees","attendee","exhibitors","exhibitor","exhibit","exhibits","exhibitor list","exhibitor directory",
    "suppliers","supplier","vendors","vendor","sponsors","sponsor","sponsorship","partners","partner",
    "home","about","about us","contact","contact us","register","registration","register now","login","log in",
    "sign in","sign up","search","menu","news","press","media","blog","events","event","event info","schedule",
    "agenda","program","programme","sessions","speakers","speaker","education","conference","expo","show",
    "trade show","tradeshow","floor plan","floorplan","map","maps","venue","hotels","hotel","travel","directions",
    "faq","faqs","help","support","resources","resource","downloads","download","gallery","photos","videos",
    "video","products","product","services","service","solutions","categories","category","industries","industry",
    "membership","members","member","join","donate","shop","store","cart","careers","jobs","team","leadership",
    "board","staff","privacy","privacy policy","terms","terms of use","cookie policy","sitemap","subscribe",
    "newsletter","why exhibit","become an exhibitor","exhibitor resources","attendee info","attendee information",
    "plan your visit","visit","visitors","visitor","buyers","buyer","press room","newsroom","all","view all",
    "more","read more","learn more","next","previous","back","top","skip to content","main menu","navigation",
    "book now","get started","apply","apply now","tickets","pricing","plans","overview","features","testimonials",
    "awards","committees","committee","volunteer","advertise","advertising","exhibit space","exhibitor portal",
  ].map((s) => s.toLowerCase()),
);

export function isLikelyCompanyName(value: string): boolean {
  const name = cleanCompanyName(value);
  if (name.length < 2 || name.length > 100) return false;
  const lower = name.toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!lower) return false;
  if (NAV_NOISE.has(lower)) return false;
  // "Exhibitor List 2026", "2026 Attendees", "Sponsors & Partners"
  if (/^(20\d{2}\s+)?(attendees?|exhibitors?|suppliers?|vendors?|sponsors?|partners?|speakers?|members?|buyers?|visitors?)(\s*(&|and)\s*\w+)?(\s+20\d{2})?(\s+(list|directory|search|index|a\s*z))?$/.test(lower)) {
    return false;
  }
  if (/^(download|add to planner|view details|company information|contact us|products?|videos?|show specials?|international manufacturing technology show|map your show)$/i.test(name)) {
    return false;
  }
  if (/^(decorative|mobile app|banner|close this banner)$/i.test(name)) return false;
  if (/^(facebook|linkedin|instagram|youtube|x|twitter)$/i.test(name)) return false;
  if (HARD_REJECT_RE.some((re) => re.test(name))) return false;
  return /[A-Za-z0-9]/.test(name);
}

/** Account chrome, dates, and UI actions that a company name can never be. */
const HARD_REJECT_RE: RegExp[] = [
  // Account / session chrome — "Log In / Create Account", "Login to email Doug Wood"
  /^(log\s?in|log\s?out|sign\s?in|sign\s?up|sign\s?out|register|create\s+(an\s+)?account|my\s+account|account)\b/i,
  /\b(log\s?in|sign\s?in|create\s+account|forgot\s+password)\b/i,
  /\blogin\b/i,
  // Nav separators / breadcrumbs
  /\s[/|»›>]\s/,
  /^[↑↓←→«»▲▼•]/,
  /\bback to top\b/i,
  // Dates: "OCTOBER 12-15, 2026", "Oct 12 - 15, 2026", "12-15 October 2026"
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b[^a-z]{0,12}\d{1,2}\s*(?:[-–—]\s*\d{1,2})?\s*,?\s*(20\d{2})?/i,
  /^\d{1,2}\s*[-–—]\s*\d{1,2}\b/,
  /\b20\d{2}\s*[-–—]\s*20\d{2}\b/,
  // UI actions
  /^(add to|share|print|export|download|view|show|hide|filter|sort|apply|clear|select|search|email|call|visit|open|close|next|prev)\b/i,
  /\b(click here|read more|learn more|view details|add to planner|show specials)\b/i,
  // Copyright / legal chrome
  /©|\ball rights reserved\b|\bcopyright\b/i,
  // Sentences and labels
  /[:;]$/,
  /^\W*$/,
];



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