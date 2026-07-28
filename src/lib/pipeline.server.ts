import { generateText, Output, NoObjectGeneratedError } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLovableAiGatewayProvider, requireLovableKey } from "./ai-gateway.server";
import { firecrawlMap, firecrawlScrape, firecrawlSearch } from "./firecrawl.server";
import { recentCachedScrapesForHost } from "./firecrawl-cache.server";
import { normalizedCompanyKey, parseExhibitorsFromMarkdown } from "./exhibitor-parser";
import {
  guarded,
  llmLimiter,
  firecrawlLimiter,
  enrichConcurrency,
  mapPool,
} from "./rate-limit.server";
import {
  DEFAULT_SCORING,
  SCORE_COMPONENTS,
  applyWeights,
  componentMax,
  normalizeScoringSettings,
  tierFor,
  type ScoringSettings,
} from "./scoring";
import {
  EventListSchema,
  ExhibitorListSchema,
  LeadSchema,
  ExecSummarySchema,
  type EventRecord,
  type LeadRecord,
} from "./pipeline-schemas";
import { verifyEvent } from "./verification.server";
import { compareForProcessing, exclusionReason, type EventVerifiedStatus } from "./verification";
import { recommendedAction, scoreEvent, SPEC_EVENT_SCORING } from "./event-scoring";
import { pipelineLog, type PipelineLogEntry } from "./pipeline-log";
import {
  capConfidence,
  checkEvidence,
  emptyMetrics,
  evidenceHash,
  finalizeMetrics,
  MIN_RECORD_EXTRACTION_CONFIDENCE,
  type ExhibitorSourceType,
  type ExtractionMethod,
} from "./evidence";
import { accountKey, dedupeExhibitorInstances, exhibitorInstanceKey } from "./exhibitor-dedupe";

const EXTRACT_MODEL = "google/gemini-3.6-flash";
const REASON_MODEL = "google/gemini-3.1-pro-preview";

const CORE_SYSTEM = `You are a B2B sales-intelligence analyst for a company that designs, fabricates, installs, rents, stores, and services custom trade show booths, exhibition stands, modular exhibits, LED video-wall booths, digital signage, interactive displays, experiential environments, booth graphics, installation and dismantling, and exhibit storage/refurbishment.

Your job is to turn trade show information into verified, prioritized, actionable sales leads.

MANDATORY RULES:
- Never invent people, emails, phone numbers, LinkedIn URLs, or employment status.
- Never state a company is exhibiting unless the provided source clearly supports it.
- Never state a person owns the budget unless the source supports it.
- When a person cannot be verified, return a Recommended Target Title (role_classification: RECOMMENDED_TARGET, name: null, contact_confidence < 70, evidence_status: INFERRED or ESTIMATED).
- UNKNOWN is better than fabricated. Use null for unknown fields.
- Score components must sum exactly to the lead_score total.
- Personalization in outreach must use only facts actually present in the source material.`;


type ZodLike<T> = { safeParse: (v: unknown) => { success: boolean; data?: T } };

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.search(/[{[]/);
  if (start === -1) return null;
  const slice = candidate.slice(start);
  try {
    return JSON.parse(slice);
  } catch {
    // Trim trailing junk after the last closing brace/bracket.
    const end = Math.max(slice.lastIndexOf("}"), slice.lastIndexOf("]"));
    if (end === -1) return null;
    try {
      return JSON.parse(slice.slice(0, end + 1));
    } catch {
      return null;
    }
  }
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function parseMarkdownLink(cell: string): { label: string; url: string | null } {
  const match = Array.from(cell.matchAll(/(!?)\[([^\]]+)]\(([^)]+)\)/g)).find((m) => m[1] !== "!");
  if (!match) return { label: cell.replace(/<br\s*\/?>/gi, " ").trim(), url: null };
  return { label: match[2].trim(), url: match[3].trim() };
}

function numberFromCell(cell: string): number | null {
  const cleaned = cell.replace(/[^0-9]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseLocation(location: string): { city: string | null; state: string | null } {
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts.slice(0, -1).join(", "), state: parts[parts.length - 1] };
  return { city: location.trim() || null, state: null };
}

function inferIndustry(name: string): string | null {
  const n = name.toLowerCase();
  if (/medical|health|diagnostic|hospital|pharma|clinical|respiratory/.test(n)) return "Healthcare";
  if (/tech|automation|ai|software|cyber|black hat|data|electronics/.test(n)) return "Technology";
  if (/manufactur|process|pack|material|fastener|welding|industrial/.test(n)) return "Manufacturing";
  if (/vehicle|auto|aviation|travel|rail|marine|logistics|supply chain/.test(n)) return "Transportation";
  if (/food|wine|agri|farm|restaurant/.test(n)) return "Food & Agriculture";
  if (/design|market|textile|gift|home|architecture|building/.test(n)) return "Design & Construction";
  return null;
}

function scoreDirectoryEvent(args: {
  name: string;
  country: string | null;
  attendees: number | null;
  exhibitors: number | null;
  targetMarket?: string | null;
}): number {
  const target = (args.targetMarket ?? "").toLowerCase();
  const country = (args.country ?? "").toLowerCase();
  let score = 45;
  if (args.exhibitors !== null) score += Math.min(30, Math.round(args.exhibitors / 25));
  if (args.attendees !== null) score += Math.min(15, Math.round(args.attendees / 3000));
  if (target.includes("united states") && country === "united states") score += 12;
  if (inferIndustry(args.name)) score += 6;
  return Math.max(0, Math.min(100, score));
}

function extractEventsFromMarkdownDirectory(
  markdown: string,
  targetMarket?: string | null,
): EventRecord[] {
  const events: EventRecord[] = [];
  for (const line of markdown.split("\n")) {
    if (/show names|next dates|attendees|exhibitors/i.test(line)) continue;
    const cells = splitMarkdownTableRow(line);
    if (cells.length < 6 || !cells[0].includes("](")) continue;
    const linked = parseMarkdownLink(cells[0]);
    if (!linked.label || /show names/i.test(linked.label)) continue;
    const location = parseLocation(cells[2] ?? "");
    const country = (cells[3] ?? "").trim() || null;
    const attendees = numberFromCell(cells[4] ?? "");
    const exhibitors = numberFromCell(cells[5] ?? "");
    const eventName = linked.label.replace(/\s+/g, " ").trim();
    events.push({
      event_name: eventName,
      official_url: linked.url,
      industry: inferIndustry(eventName),
      start_date: (cells[1] ?? "").trim() || null,
      end_date: null,
      venue: null,
      city: location.city,
      state: location.state,
      country,
      event_opportunity_score: scoreDirectoryEvent({
        name: eventName,
        country,
        attendees,
        exhibitors,
        targetMarket,
      }),
      recommended_outreach_phase: "DESIGN_AND_BUDGET",
      estimated_exhibitor_count: exhibitors,
      rationale: `Directory row lists ${exhibitors ?? "unknown"} exhibitors and ${attendees ?? "unknown"} attendees.`,
    });
  }

  return events;
}

function dedupeEvents(events: EventRecord[]): EventRecord[] {
  const seen = new Map<string, EventRecord>();
  for (const e of events) {
    const key = `${e.event_name.toLowerCase().trim()}|${(e.official_url ?? "").toLowerCase().trim()}`;
    if (!seen.has(key)) seen.set(key, e);
  }
  return Array.from(seen.values());
}

type LeadEntry = {
  lead: import("zod").infer<typeof LeadSchema>;
  eventId: string;
  eventName: string;
  eventDate: string | null;
  eventYear?: number | null;
  boothNumber: string | null;
  /** Extraction provenance carried from the exhibitor record. */
  provenance?: ExhibitorProvenance | null;
  displayedCompanyName?: string | null;
  hall?: string | null;
  profileUrl?: string | null;
};

/** One live scoring decision streamed to the run UI as it happens. */
export type ScoringFeedEntry = {
  at: string;
  company: string;
  show: string;
  status: "scored" | "skipped";
  score?: number;
  tier?: string;
  confidence?: string;
  booth_confidence?: number;
  top_drivers?: { key: string; points: number; max: number }[];
  weak_spots?: { key: string; points: number; max: number }[];
  reason: string;
};

const TIER_REASON: Record<string, string> = {
  TIER_1_IMMEDIATE: "Top score with a confirmed decision-maker path — prioritized for immediate outreach.",
  TIER_2_HIGH_PRIORITY: "Strong fit but no confirmed contact yet — high-priority outreach.",
  TIER_3_NURTURE: "Moderate fit — worth nurturing ahead of the show.",
  TIER_4_LOW_PRIORITY: "Low fit signals — deprioritized, kept for reference only.",
};

/** Explain a scored lead: strongest and weakest scoring components. */
export function explainLeadScore(
  row: ReturnType<typeof buildLeadRow>,
  scoring: ScoringSettings = DEFAULT_SCORING,
): ScoringFeedEntry {
  const b = (row.score_breakdown ?? {}) as Record<string, number>;
  const parts = SCORE_COMPONENTS.map((c) => ({
    key: c.key as string,
    points: Number(b[c.key] ?? 0),
    max: componentMax(scoring, c.key),
  })).filter((p) => p.max > 0);
  const byRatio = [...parts].sort((a, b2) => b2.points / b2.max - a.points / a.max);
  return {
    at: new Date().toISOString(),
    company: row.company_name,
    show: row.trade_show ?? "",
    status: "scored",
    score: row.lead_score,
    tier: row.priority_tier,
    confidence: row.confidence_level ?? "LOW",
    booth_confidence: row.booth_analysis_confidence,
    top_drivers: byRatio.slice(0, 3),
    weak_spots: byRatio.slice(-2).reverse(),
    reason: TIER_REASON[row.priority_tier] ?? "Scored.",
  };
}


/** Deterministic scoring + tiering for one enriched exhibitor. */
/** Provenance attached to every extracted exhibitor before it becomes a lead. */
export type ExhibitorProvenance = {
  source_url: string;
  source_type: ExhibitorSourceType;
  extraction_method: ExtractionMethod;
  evidence_text: string | null;
  evidence_locator: string | null;
  evidence_hash: string | null;
  extraction_confidence: number;
  record_status: "CONFIRMED" | "UNCERTAIN";
  exhibitor_instance_key: string;
  account_key: string;
};

/** Classify a source URL into the spec's source-type ladder. */
export function sourceTypeFor(url: string): ExhibitorSourceType {
  if (/\.pdf($|\?)/i.test(url)) return "PDF";
  if (/floor\s*plan|floorplan|map/i.test(url)) return "FLOOR_PLAN";
  if (/exhibitor|exhibitors|exhibit-list|participants|vendors/i.test(url)) return "OFFICIAL_EXHIBITOR_DIRECTORY";
  if (/mapyourshow|a2zinc|expocad|swapcard|eventscribe/i.test(url)) return "DIRECTORY_API";
  return "ORGANIZER_PAGE";
}

/**
 * The line of source content that names the company. This is the verbatim
 * evidence we keep so a record can always be traced back to the page.
 */
export function evidenceLineFor(markdown: string, companyName: string): { text: string; line: number } | null {
  const needle = companyName.trim().toLowerCase();
  if (!needle) return null;
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(needle)) {
      return { text: lines[i].trim().slice(0, 500), line: i + 1 };
    }
  }
  return null;
}

function buildLeadRow(
  runId: string,
  inputUrl: string,
  entry: LeadEntry,
  scoring: ScoringSettings = DEFAULT_SCORING,
) {
  const { lead, eventId, eventName, eventDate, boothNumber } = entry;
  const provenance = entry.provenance ?? null;
  const { breakdown: b, total } = applyWeights(
    (lead.score_breakdown ?? {}) as Record<string, number>,
    scoring,
  );

  // Tier 1 requires a credible decision-maker path
  const decisionMakers = lead.decision_makers ?? [];
  const hasVerified = decisionMakers.some(
    (dm) => (dm.contact_confidence ?? 0) >= 70 && dm.evidence_status === "CONFIRMED",
  );
  const tier = tierFor(total, hasVerified, scoring);

  return {
    run_id: runId,
    event_id: eventId,
    company_name: lead.company_name,
    normalized_company_name: lead.normalized_company_name ?? lead.company_name,
    parent_company: lead.parent_company ?? null,
    company_website: lead.company_website ?? null,
    industry: lead.industry ?? null,
    employee_range: lead.employee_range ?? null,
    revenue_range: lead.revenue_range ?? null,
    trade_show: eventName,
    event_date: eventDate,
    booth_number: boothNumber,
    booth_type: lead.booth_type ?? null,
    booth_size_estimate: lead.booth_size_estimate ?? null,
    booth_analysis_confidence: Math.max(0, Math.min(100, Math.round(lead.booth_analysis_confidence ?? 0))),
    recommended_services: lead.recommended_services ?? [],
    estimated_project_value_low: Math.round(lead.estimated_project_value_low ?? 0),
    estimated_project_value_high: Math.round(lead.estimated_project_value_high ?? 0),
    lead_score: total,
    priority_tier: tier,
    score_breakdown: b,
    decision_makers: decisionMakers,
    recommended_outreach_date: lead.recommended_outreach_date ?? null,
    recommended_next_action: lead.recommended_next_action ?? null,
    personalized_email: `Subject: ${lead.personalized_email_subject ?? ""}\n\n${lead.personalized_email_body ?? ""}`,
    linkedin_message: lead.linkedin_message ?? null,
    confidence_level: lead.confidence_level ?? "LOW",
    unknown_fields: lead.unknown_fields ?? [],
    source_urls: [inputUrl, provenance?.source_url].filter(Boolean) as string[],
    displayed_company_name: entry.displayedCompanyName ?? null,
    hall: entry.hall ?? null,
    profile_url: entry.profileUrl ?? null,
    event_year: entry.eventYear ?? null,
    source_type: provenance?.source_type ?? null,
    extraction_method: provenance?.extraction_method ?? null,
    evidence_text: provenance?.evidence_text ?? null,
    evidence_locator: provenance?.evidence_locator ?? null,
    evidence_hash: provenance?.evidence_hash ?? null,
    extraction_confidence: provenance?.extraction_confidence ?? null,
    record_status: provenance?.record_status ?? "UNCERTAIN",
    exhibitor_instance_key: provenance?.exhibitor_instance_key ?? null,
    account_key: provenance?.account_key ?? null,
    last_confirmed_at: provenance ? new Date().toISOString() : null,
    raw: lead,
  };
}


const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Best-effort parse of directory date strings such as
 * "Nov 4 - Nov 6, 2026", "4-6 November 2026", "2026-03-10".
 * Returns null when no date can be read (never guesses).
 */
export function parseEventStartDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const text = String(raw).replace(/\s+/g, " ").trim();
  if (!text) return null;

  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));

  const year = text.match(/\b(20\d{2})\b/);
  if (!year) return null;

  const monthMatch = text.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  if (!monthMatch) return null;
  const month = MONTHS[monthMatch[1]];

  // First standalone 1-2 digit number that isn't part of the year.
  const dayMatch = text.match(/\b(\d{1,2})\b/);
  const day = dayMatch ? Math.min(28, Math.max(1, +dayMatch[1])) : 1;

  const d = new Date(Date.UTC(+year[1], month, day));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Days from today until the show starts; negative when already past. */
export function eventLeadTimeDays(raw: string | null | undefined, now = new Date()): number | null {
  const start = parseEventStartDate(raw);
  if (!start) return null;
  return Math.round((start.getTime() - now.getTime()) / 86_400_000);
}

function compactSourceMarkdown(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => line.length < 4000)
    .join("\n")
    .slice(0, 25000);
}

/** Split long markdown into model-sized chunks so nothing is silently truncated. */
function chunkMarkdown(markdown: string, chunkChars = 25000, maxChunks = 8): string[] {
  const lines = markdown.split("\n").filter((line) => line.length < 4000);
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current.length + line.length + 1 > chunkChars) {
      chunks.push(current);
      current = "";
      if (chunks.length >= maxChunks) return chunks;
    }
    current += line + "\n";
  }
  if (current.trim()) chunks.push(current);
  return chunks.slice(0, maxChunks);
}

/**
 * Discover additional pages of a paginated directory listing, based on links
 * found on the first page (?page=2, /page/2, ?p=2, &start=50 ...).
 */
function findPaginationUrls(baseUrl: string, links: string[], maxPages: number): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const basePath = base.pathname.replace(/\/page\/\d+\/?$/, "").replace(/\/$/, "");
  const found = new Map<number, string>();

  for (const raw of links) {
    let u: URL;
    try {
      u = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    if (u.host !== base.host) continue;
    const path = u.pathname.replace(/\/$/, "");
    const pathPageMatch = path.match(/^(.*)\/page\/(\d+)$/);
    const queryPage =
      u.searchParams.get("page") ??
      u.searchParams.get("p") ??
      u.searchParams.get("pg") ??
      u.searchParams.get("pageNumber");

    let n: number | null = null;
    if (pathPageMatch && pathPageMatch[1].replace(/\/$/, "") === basePath) {
      n = Number(pathPageMatch[2]);
    } else if (queryPage && path === basePath) {
      n = Number(queryPage);
    }
    if (n && Number.isFinite(n) && n > 1 && n <= 1000) {
      u.hash = "";
      if (!found.has(n)) found.set(n, u.toString());
    }
  }

  const numbered = Array.from(found.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, maxPages)
    .map(([, url]) => url);
  if (numbered.length > 0) return numbered;

  // Fallback: offset-style feeds (?vPos=0&vRpP=100, ?offset=, ?start=…), which many
  // embedded directory widgets use — often on a different host than the host page.
  return findOffsetPaginationUrls(links, maxPages);
}

const OFFSET_PARAMS = ["vPos", "offset", "start", "skip", "from", "firstResult"];
const PER_PAGE_PARAMS = ["vRpP", "rpp", "limit", "per_page", "perPage", "pageSize", "count"];

function findOffsetPaginationUrls(links: string[], maxPages: number): string[] {
  for (const raw of links) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const offsetKey = OFFSET_PARAMS.find((k) => u.searchParams.get(k) !== null);
    if (!offsetKey) continue;
    const perKey = PER_PAGE_PARAMS.find((k) => Number(u.searchParams.get(k)) > 0);
    const step = perKey ? Number(u.searchParams.get(perKey)) : 100;
    if (!Number.isFinite(step) || step <= 0) continue;
    const startOffset = Number(u.searchParams.get(offsetKey)) || 0;

    const urls: string[] = [];
    for (let i = 1; i <= maxPages; i++) {
      const next = new URL(u.toString());
      next.searchParams.set(offsetKey, String(startOffset + i * step));
      next.hash = "";
      urls.push(next.toString());
    }
    return urls;
  }
  return [];
}



function fmtElapsed(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  return min > 0 ? `${min}m ${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

/**
 * Structured generation that degrades instead of crashing:
 * 1. provider structured output
 * 2. plain-text JSON-only generation, parsed locally
 * 3. one repair pass that re-asks the model to fix its own JSON
 */
async function generateStructured<T>(
  model: Parameters<typeof generateText>[0]["model"],
  schema: ZodLike<T>,
  prompt: string,
): Promise<T> {
  let lastText = "";

  // Every model call goes through the shared LLM limiter (concurrency cap +
  // per-minute throttle) and is retried with exponential backoff on 429/5xx.
  const llmTimeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 120_000);
  const call = (args: Parameters<typeof generateText>[0]) =>
    guarded(
      llmLimiter,
      () =>
        generateText({ ...args, abortSignal: AbortSignal.timeout(llmTimeoutMs) }).catch(
          (e: Error) => {
            if (e.name === "TimeoutError" || e.name === "AbortError")
              throw new Error(`Model call timed out after ${Math.round(llmTimeoutMs / 1000)}s`);
            throw e;
          },
        ),
      { label: "llm generate" },
    );

  try {
    const { output } = await call({
      model,
      output: Output.object({ schema: schema as never }),
      prompt,
    });
    return output as T;
  } catch (e) {
    if (NoObjectGeneratedError.isInstance(e) && e.text) {
      lastText = e.text;
      const parsed = schema.safeParse(extractJson(e.text));
      if (parsed.success && parsed.data !== undefined) return parsed.data;
    }
  }

  const jsonOnly = `${prompt}

OUTPUT FORMAT: Reply with a single valid JSON object only. No markdown fences, no commentary, no trailing text. Use null for unknown values and never omit required keys.`;

  try {
    const { text } = await call({ model, prompt: jsonOnly });
    lastText = text || lastText;
    const parsed = schema.safeParse(extractJson(text));
    if (parsed.success && parsed.data !== undefined) return parsed.data;
  } catch {
    // fall through to repair
  }

  const { text: repaired } = await call({
    model,
    prompt: `The following text was supposed to be a single valid JSON object but could not be parsed or validated. Return ONLY the corrected JSON object, preserving all usable data and using null for unknown values.

${lastText.slice(0, 20000)}`,
  });
  const parsed = schema.safeParse(extractJson(repaired));
  if (parsed.success && parsed.data !== undefined) return parsed.data;

  throw new Error(
    "Could not extract structured data from the source page after 3 attempts. The page may be blocked, empty, or not a trade show listing.",
  );
}



type ProgressFn = (stage: string, message: string) => Promise<void>;

const EXHIBITOR_LINK_RE =
  /(exhibitor|exhibit)[-_/]?(list|directory|search|hall|floor ?plan|showcase)|\/exhibitors?\b|who-?s-?exhibiting/i;

/** Pages that mention exhibitors but never list companies. */
const EXHIBITOR_NEGATIVE_RE =
  /prospectus|sponsor|become[-_/]?an?[-_/]?exhibitor|why[-_/]?exhibit|faq|service[-_/]?manual|resources?|contact|pricing|rates/i;

/** Many associations publish the exhibitor list only as a linked PDF. */
const PDF_RE = /\.pdf($|\?)/i;
const EXHIBITOR_PDF_RE = /(exhibit|exhibitor|floor ?plan|booth)/i;

/**
 * Directory platforms that reliably host real exhibitor lists. Many shows put
 * these on a `directory.<show>.com` subdomain with opaque `.cfm` paths that
 * contain no "exhibitor" keyword at all, so match the platform shape too.
 */
const EXHIBITOR_PLATFORM_RE =
  /mapyourshow|a2zinc|expocad|swapcard|eventscribe|exhibitor-alphalist|10times\.com\/.+\/exhibitors|\/\d+_\d+\/(explore|exhibitor|exhview)\b/i;

/** A `directory.` / `exhibitors.` host is itself strong evidence. */
const DIRECTORY_HOST_RE = /^(directory|exhibitors?|directory\d*)\./i;

function scoreCandidate(url: string): number {
  let score = 0;
  if (EXHIBITOR_PLATFORM_RE.test(url)) score += 6;
  if (/exhibitor[-_/]?(list|directory|search)|exhibitor-?directory|who-?s-?exhibiting/i.test(url)) score += 4;
  if (/\/exhibitors?\/?($|\?)/i.test(url)) score += 2;
  try {
    if (DIRECTORY_HOST_RE.test(new URL(url).hostname)) score += 4;
  } catch {
    /* ignore unparseable urls */
  }
  if (PDF_RE.test(url)) score += EXHIBITOR_PDF_RE.test(url) ? 5 : -6;
  if (EXHIBITOR_NEGATIVE_RE.test(url)) score -= 5;
  return score;
}

/**
 * A real exhibitor list has many company entries, not just the word
 * "exhibitor" sprinkled across a resources page.
 */
function looksLikeExhibitorContent(markdown: string): boolean {
  if (markdown.length < 600) return false;
  const lines = markdown.split("\n").map((l) => l.trim()).filter(Boolean);
  const linkLines = lines.filter((l) => /^[-*|\s]*\[?[A-Z0-9][^\n]{2,60}\]?/.test(l)).length;
  const companyish = (markdown.match(/\b(inc\.?|llc|ltd\.?|corp\.?|co\.|gmbh|group|systems|technologies|industries|equipment|solutions)\b/gi) ?? []).length;
  const boothHits = (markdown.match(/booth\s*#?\s*\w+|stand\s?#/gi) ?? []).length;
  // PDF handouts are just one company per line — no links, few suffixes.
  const bareNameLines = lines.filter((l) =>
    /^[A-Z0-9][A-Za-z0-9&.,'’()\/-]*(\s+[A-Za-z0-9&.,'’()\/-]+){0,7}$/.test(l) && l.length <= 70,
  ).length;
  return (
    boothHits >= 3 ||
    companyish >= 8 ||
    (companyish >= 4 && linkLines >= 20) ||
    (bareNameLines >= 25 && companyish >= 3)
  );
}

/**
 * Directory platforms bury the company list under a long filter/nav header.
 * Start the slice at the results section so the model's context window is
 * spent on companies rather than square-footage checkboxes.
 */
function trimToListing(markdown: string): string {
  const m = /(#+\s*(results|featured exhibitors|exhibitor list|all exhibitors)|^\s*A\s*\|\s*B\s*\|)/im.exec(markdown);
  return m && m.index > 500 ? markdown.slice(m.index) : markdown;
}

/** Common exhibitor-directory paths to try when a site exposes no obvious link. */
const EXHIBITOR_PATH_GUESSES = [
  "/exhibitor-list",
  "/exhibitors/exhibitor-list",
  "/exhibitor-directory",
  "/attend/exhibitor-list",
  "/exhibitors",
];

/** MapYourShow-hosted directories follow a fixed shape on a `directory.` host. */
const DIRECTORY_HOST_GUESSES = [
  "/8_0/explore/exhibitor-alphalist.cfm",
  "/exhibitor-alphalist.cfm",
];

function guessExhibitorUrls(officialUrl: string): string[] {
  try {
    const base = new URL(officialUrl);
    const apex = base.host.replace(/^www\./i, "");
    const urls = EXHIBITOR_PATH_GUESSES.map((p) =>
      new URL(p, `${base.protocol}//${base.host}`).toString(),
    );
    // Many association sites nest the list under the event path
    // (e.g. /annualmeeting/exhibits/exhibitor-list).
    const eventPath = base.pathname.replace(/\/+$/, "");
    if (eventPath && eventPath !== "") {
      for (const p of ["/exhibits", "/exhibits/exhibitor-list", "/exhibitors", ...EXHIBITOR_PATH_GUESSES]) {
        urls.push(new URL(`${eventPath}${p}`, `${base.protocol}//${base.host}`).toString());
      }
    }
    for (const p of DIRECTORY_HOST_GUESSES) {
      urls.push(new URL(p, `https://directory.${apex}`).toString());
    }
    return urls;
  } catch {
    return [];
  }
}


/** Per-show extraction diagnostics surfaced in the run debug panel. */
export type ShowDebugEntry = {
  show: string;
  official_url: string | null;
  candidates: number;
  accepted: string[];
  rejected: Array<{ url: string; reason: string }>;
  pages: Array<{ url: string; added: number }>;
  exhibitors: number;
  skip_reason: string | null;
};

/** Per-show diagnostics captured while hunting for exhibitor sources. */
export type SourceDiag = {
  /** Every URL that was considered as a possible exhibitor list. */
  candidates: number;
  /** URLs dropped before or after scraping, with the reason. */
  rejected: Array<{ url: string; reason: string }>;
  /** URLs accepted as exhibitor listing pages. */
  accepted: string[];
};

/**
 * Event homepages almost never list exhibitors, and "exhibitor resources"
 * pages list none either. Collect ranked candidates from the site itself,
 * common paths, known directory platforms, and aggregator sites (10times),
 * so the caller can try the next one when extraction yields nothing.
 */
async function findExhibitorSources(
  officialUrl: string,
  eventName: string,
  max = 12,
  diag?: SourceDiag,
): Promise<Array<{ url: string; markdown: string }>> {

  // max <= 0 means "collect every exhibitor page we can find" for this show.
  const exhaustive = max <= 0;
  const limit = exhaustive ? Number.POSITIVE_INFINITY : max;
  // Each scrape can take up to 90s; chained together a single dead event site
  // could eat the whole run. Give the hunt one overall budget and move on.
  const budgetMs = Number(
    process.env.EXHIBITOR_SOURCE_BUDGET_MS ?? (exhaustive ? 420_000 : 150_000),
  );
  const deadline = Date.now() + budgetMs;
  const outOfTime = () => Date.now() >= deadline;

  const candidates: string[] = [];
  const push = (u?: string | null) => {
    if (u && /^https?:\/\//i.test(u) && !candidates.includes(u)) candidates.push(u);
  };

  const home = officialUrl
    ? await firecrawlScrape(officialUrl, { formats: ["markdown", "links"] }).catch(() => null)
    : null;

  for (const link of home?.links ?? []) if (EXHIBITOR_LINK_RE.test(link)) push(link);
  for (const g of guessExhibitorUrls(officialUrl)) push(g);

  // Aggregators + platform-hosted directories via web search. Search hits are
  // the only way to reach directories on a separate host with a keyword-free
  // path (e.g. directory.imts.com/8_0/exhview/index.cfm), so give them a base
  // score that survives ranking instead of discarding them.
  const searchHits = new Set<string>();
  if (!outOfTime()) {
    const queries = [
      `${eventName} exhibitor list directory`,
      `${eventName} exhibitor directory booth numbers`,
      `10times ${eventName} exhibitors`,
      `${eventName} exhibitor list pdf`,
      ...(exhaustive
        ? [`${eventName} exhibitors A-Z`, `${eventName} exhibitor floor plan companies`]
        : []),
    ];
    for (const q of queries) {
      if (outOfTime()) break;
      const results = await firecrawlSearch(q, { limit: 6 }).catch(() => [] as Array<{ url: string }>);
      for (const r of results) {
        push(r.url);
        searchHits.add(r.url);
      }
    }
  }

  // Sites that block crawlers on their exhibits page still expose the list
  // through the site index — this is usually where a PDF exhibitor list lives.
  if (!outOfTime()) {
    try {
      const origin = new URL(officialUrl).origin;
      const terms = exhaustive
        ? ["exhibitor list", "exhibitors", "exhibitor directory", "booth", "exhibit"]
        : ["exhibitor list", "exhibitors"];
      for (const term of terms) {
        if (outOfTime()) break;
        const mapped = await firecrawlMap(origin, { search: term, limit: exhaustive ? 200 : 60 });
        for (const u of mapped) if (scoreCandidate(u) > 0) push(u);
      }
    } catch {
      // mapping is best-effort
    }
  }

  const scoredCandidates = candidates.map((url) => ({
    url,
    score: scoreCandidate(url) + (searchHits.has(url) ? 1 : 0),
  }));
  if (diag) {
    diag.candidates = scoredCandidates.length;
    for (const c of scoredCandidates) {
      if (c.score <= 0 && diag.rejected.length < 60) {
        diag.rejected.push({ url: c.url, reason: "URL filtered — no exhibitor-list signal in the link" });
      }
    }
  }
  const ranked = scoredCandidates
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((c) => c.url);

  const secondHop: string[] = [];
  const secondHopCap = exhaustive ? 60 : 6;
  const found: Array<{ url: string; markdown: string }> = [];
  const seenFound = new Set<string>();
  const addFound = (url: string, markdown: string) => {
    if (seenFound.has(url)) return;
    if (!looksLikeExhibitorContent(markdown)) {
      if (diag && diag.rejected.length < 60) {
        diag.rejected.push({
          url,
          reason: markdown
            ? "Scraped but content did not look like an exhibitor list"
            : "Page could not be scraped (blocked, empty or timed out)",
        });
      }
      return;
    }
    seenFound.add(url);
    if (diag) diag.accepted.push(url);
    found.push({ url, markdown: trimToListing(markdown) });
  };


  // Reruns often already have useful MapYourShow detail pages cached from an
  // interrupted attempt. Use them immediately instead of waiting on the listing
  // page or the model again.
  const cachedHosts = new Set<string>();
  for (const url of ranked) {
    try {
      const host = new URL(url).hostname;
      if (/directory\.|mapyourshow|a2zinc/i.test(host)) cachedHosts.add(host);
    } catch {
      // ignore malformed search results
    }
  }
  for (const host of cachedHosts) {
    if (found.length >= limit) break;
    const cached = await recentCachedScrapesForHost(host, {
      limit: exhaustive ? 500 : max,
    });
    for (const page of cached) {
      addFound(page.url, page.markdown);
      if (found.length >= limit) break;
    }
  }

  const collectHops = (pageUrl: string, links: string[]) => {
    for (const link of links) {
      if (secondHop.length >= secondHopCap) break;
      if (!/^https?:\/\//i.test(link) || candidates.includes(link) || secondHop.includes(link)) continue;
      if (PDF_RE.test(link) && EXHIBITOR_PDF_RE.test(link)) secondHop.push(link);
      else if (EXHIBITOR_LINK_RE.test(link) && scoreCandidate(link) >= 4) secondHop.push(link);
      // Exhibitor lists are usually paginated or split A-Z. Follow every page of
      // the same listing so we get all exhibitors, not just the first screen.
      else if (exhaustive && isSameListingPage(pageUrl, link)) secondHop.push(link);
    }
  };

  const rankedCap = exhaustive ? 40 : 10;
  for (const url of ranked.slice(0, rankedCap)) {
    if (outOfTime() || found.length >= limit) break;
    // Directory platforms render the list client-side; give them a moment.
    const isPdf = PDF_RE.test(url);
    const page = await firecrawlScrape(
      url,
      isPdf
        ? { formats: ["markdown"], parsers: ["pdf"] }
        : { formats: ["markdown", "links"], waitFor: 4000 },
    ).catch(() => null);
    addFound(url, page?.markdown ?? "");
    // Exhibitor pages often only link to the real list (commonly a PDF).
    collectHops(url, page?.links ?? []);
  }

  // Follow the links discovered on the exhibitor pages themselves (PDF lists,
  // A-Z index pages, "page 2" links).
  for (let i = 0; i < secondHop.length; i += 1) {
    const url = secondHop[i];
    if (outOfTime() || found.length >= limit) break;
    const page = await firecrawlScrape(
      url,
      PDF_RE.test(url)
        ? { formats: ["markdown"], parsers: ["pdf"] }
        : { formats: ["markdown", "links"], waitFor: 4000 },
    ).catch(() => null);
    addFound(url, page?.markdown ?? "");
    if (exhaustive) collectHops(url, page?.links ?? []);
  }

  const homeMd = home?.markdown ?? "";
  if (found.length === 0 && looksLikeExhibitorContent(homeMd)) {
    addFound(officialUrl, homeMd);
  }
  return found;
}

/**
 * True when `link` is another page of the same exhibitor listing as `pageUrl`
 * (pagination, A-Z letter index, or "load more" style query variants).
 */
function isSameListingPage(pageUrl: string, link: string): boolean {
  try {
    const a = new URL(pageUrl);
    const b = new URL(link);
    if (a.hostname !== b.hostname) return false;
    const samePath = a.pathname === b.pathname;
    const paginated = /([?&#](page|p|pg|start|offset|letter|alpha|char|index)=)/i.test(link);
    const letterPath =
      b.pathname.startsWith(a.pathname.replace(/\/$/, "")) &&
      /\/(page\/\d+|[a-z0-9])\/?$/i.test(b.pathname.slice(a.pathname.replace(/\/$/, "").length));
    return (samePath && b.search !== a.search && paginated) || (paginated && samePath) || letterPath;
  } catch {
    return false;
  }
}





export async function runPipeline(
  runId: string,
  input: {
    inputUrl: string;
    targetMarket?: string | null;
    filters: {
      minProjectValue?: number;
      maxLeadsPerShow?: number;
      /** Max shows kept from a directory (default 500). */
      maxEvents?: number;
      /** Max extra paginated directory pages to fetch (default 25). */
      maxDirectoryPages?: number;
      /**
       * Re-use directory pages fetched within this many hours instead of
       * refetching them (default 24). 0 forces a fresh fetch of every page.
       */
      pageReuseHours?: number;
      /** Max shows to deep-dive for exhibitors/leads (default 4). */
      maxDeepDiveShows?: number;
      /** Skip shows starting sooner than this many days from now (default 45). */
      minLeadTimeDays?: number;
      /** Process shows that could not be confirmed against their official site. */
      allowUnverifiedEvents?: boolean;
      /** Only keep shows starting on or after this ISO date (YYYY-MM-DD). Overrides minLeadTimeDays. */
      startDateFrom?: string | null;
      /** Only keep shows starting on or before this ISO date (YYYY-MM-DD). */
      startDateTo?: string | null;
      priorityIndustries?: string[];
      targetServices?: string[];
      /** Optional per-run tuning of parallelism / request rates. */
      concurrency?: number;
      firecrawlConcurrency?: number;
      firecrawlRpm?: number;
      llmConcurrency?: number;
      llmRpm?: number;
    };
  },
  admin: SupabaseClient,
) {
  // Per-step timing log so the UI can show where time is going.
  type StepEntry = {
    key: string;
    started_at: string;
    ended_at: string | null;
    duration_ms: number | null;
    message: string | null;
  };
  const stepLog: StepEntry[] = [];

  const progress: ProgressFn = async (stage, message) => {
    const nowIso = new Date().toISOString();
    const last = stepLog[stepLog.length - 1];
    if (last && last.key === stage) {
      last.message = message;
    } else {
      if (last && !last.ended_at) {
        last.ended_at = nowIso;
        last.duration_ms = new Date(nowIso).getTime() - new Date(last.started_at).getTime();
      }
      stepLog.push({
        key: stage,
        started_at: nowIso,
        ended_at: null,
        duration_ms: null,
        message,
      });
    }

    await admin
      .from("research_runs")
      .update({
        stage,
        progress_message: message,
        step_log: stepLog,
        updated_at: nowIso,
      })
      .eq("id", runId);
  };

  // Live counters surfaced in the run UI while the pipeline is working.
  const counters = {
    discovered: 0,
    filtered_too_soon: 0,
    eligible: 0,
    kept: 0,
    deep_dive_total: 0,
    deep_dive_done: 0,
    exhibitors_found: 0,
    /** Directory/detail pages parsed while hunting exhibitors. */
    exhibitor_pages_parsed: 0,
    /** Pages that actually yielded at least one exhibitor. */
    exhibitor_pages_with_hits: 0,
    /** ISO timestamp of the most recent successful exhibitor extraction. */
    last_exhibitor_at: null as string | null,
    /** Hostname of the page that produced the most recent exhibitors. */
    last_exhibitor_source: null as string | null,
    leads_scored: 0,
    /** Shows confirmed against their official website. */
    events_verified: 0,
    /** Shows dropped by the verification gate. */
    events_excluded: 0,
    pages_reused: 0,
    pages_fetched: 0,
    scoring_feed: [] as ScoringFeedEntry[],
    /** Per-show extraction diagnostics shown in the run debug panel. */
    show_debug: [] as ShowDebugEntry[],

  };
  const bumpCounters = async (patch: Partial<typeof counters>) => {
    Object.assign(counters, patch);
    await admin.from("research_runs").update({ counters }).eq("id", runId);
  };

  /** Push a live scoring decision (kept or skipped) onto the run feed. */
  const pushScoringEntry = async (entry: ScoringFeedEntry) => {
    counters.scoring_feed = [entry, ...counters.scoring_feed].slice(0, 40);
    await admin.from("research_runs").update({ counters }).eq("id", runId);
  };

  // Alert the run owner when qualified leads (score 65+) cross a milestone.
  // Per-user scoring configuration (weights + tier thresholds).
  let scoring: ScoringSettings = DEFAULT_SCORING;
  try {
    const { runOwner } = await import("./notifications.server");
    const { userId } = await runOwner(admin, runId);
    if (userId) {
      const { data: scoringRow } = await admin
        .from("scoring_settings")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (scoringRow) scoring = normalizeScoringSettings(scoringRow);
    }
  } catch {
    // fall back to defaults
  }

  let qualifiedCount = 0;
  const announceMilestone = async (before: number, after: number) => {
    try {
      const { crossedMilestone, notifyLeadMilestone, runOwner } = await import("./notifications.server");
      const milestone = crossedMilestone(before, after);
      if (!milestone) return;
      const { userId, inputUrl } = await runOwner(admin, runId);
      if (!userId) return;
      await notifyLeadMilestone(admin, {
        runId,
        userId,
        inputUrl: inputUrl ?? input.inputUrl,
        milestone,
        qualified: after,
      });
    } catch {
      // notifications must never break the run
    }
  };


  const finishSteps = async () => {
    const last = stepLog[stepLog.length - 1];
    if (last && !last.ended_at) {
      const nowIso = new Date().toISOString();
      last.ended_at = nowIso;
      last.duration_ms = new Date(nowIso).getTime() - new Date(last.started_at).getTime();
    }
  };

  const withHeartbeat = async <T,>(stage: string, message: string, work: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = fmtElapsed(Date.now() - started);
      void progress(stage, `${message} · still working (${elapsed})`).catch((error: unknown) => {
        console.warn(`[progress] heartbeat failed for ${stage}:`, (error as Error)?.message ?? error);
      });
    }, 20_000);
    try {
      return await work();
    } finally {
      clearInterval(timer);
    }
  };


  const limitations: string[] = [];

  // Per-run overrides on top of the env-var defaults (concurrency + rate caps).
  const concurrency = enrichConcurrency(input.filters.concurrency);
  if (input.filters.firecrawlConcurrency || input.filters.firecrawlRpm) {
    firecrawlLimiter.configure({
      ...(input.filters.firecrawlConcurrency ? { concurrency: input.filters.firecrawlConcurrency } : {}),
      ...(input.filters.firecrawlRpm ? { requestsPerMinute: input.filters.firecrawlRpm } : {}),
    });
  }
  if (input.filters.llmConcurrency || input.filters.llmRpm) {
    llmLimiter.configure({
      ...(input.filters.llmConcurrency ? { concurrency: input.filters.llmConcurrency } : {}),
      ...(input.filters.llmRpm ? { requestsPerMinute: input.filters.llmRpm } : {}),
    });
  }

  // Circuit breaker visibility: when Firecrawl (or the model gateway) starts
  // throttling us, every worker parks. Surface that as live progress so the
  // run reads as "paused, resuming in Ns" instead of looking frozen — and so
  // the stall watchdog keeps seeing a heartbeat.
  let breakerTicker: ReturnType<typeof setInterval> | null = null;
  const stopBreakerTicker = () => {
    if (breakerTicker) {
      clearInterval(breakerTicker);
      breakerTicker = null;
    }
  };
  const currentStage = () => stepLog[stepLog.length - 1]?.key ?? "scrape_source";
  const watchBreaker = (limiter: typeof firecrawlLimiter, label: string) =>
    limiter.onBreakerChange((event) => {
      if (event.state === "open") {
        const tick = () => {
          if (limiter.breakerState !== "open") {
            stopBreakerTicker();
            return;
          }
          const secs = Math.max(0, Math.ceil((limiter.resumeAt - Date.now()) / 1000));
          void progress(
            currentStage(),
            `Paused — ${label} rate limit reached. All workers stopped, resuming in ${secs}s`,
          ).catch(() => {});
        };
        tick();
        stopBreakerTicker();
        breakerTicker = setInterval(tick, 5_000);
      } else {
        stopBreakerTicker();
        if (event.state === "closed") {
          void progress(currentStage(), `${label} rate limit cleared — resuming`).catch(() => {});
        }
      }
    });
  const unwatchBreakers = [
    watchBreaker(firecrawlLimiter, "Firecrawl"),
    watchBreaker(llmLimiter, "Model gateway"),
  ];
  const releaseBreakerWatch = () => {
    stopBreakerTicker();
    for (const off of unwatchBreakers) off();
  };

  const key = requireLovableKey();
  const gateway = createLovableAiGatewayProvider(key);
  const extractModel = gateway(EXTRACT_MODEL);
  const reasonModel = gateway(REASON_MODEL);

  await admin.from("research_runs").update({ status: "scraping" }).eq("id", runId);
  await progress("scrape_source", `Fetching ${input.inputUrl}`);

  const maxEvents = Math.max(1, Math.min(5000, input.filters.maxEvents ?? 2000));
  const maxPages = Math.max(1, Math.min(50, input.filters.maxDirectoryPages ?? 25));

  // Re-run reuse window: pages fetched inside this window are served from the
  // shared cache, so a re-run (or an auto-resume) replays discovery without
  // paying for the same directory pages again.
  const reuseHours = Math.max(0, Math.min(720, input.filters.pageReuseHours ?? 24));
  const pageCache = reuseHours > 0
    ? { maxAgeMs: reuseHours * 3_600_000, ttlMs: Math.max(reuseHours, 24) * 3_600_000 }
    : { bypass: true };
  let reusedPages = 0;
  let fetchedPages = 0;
  const notePage = (fromCache?: boolean) => {
    if (fromCache) reusedPages++;
    else fetchedPages++;
  };

  let sourceMarkdown = "";
  let sourceLinks: string[] = [];
  try {
    const scraped = await withHeartbeat("scrape_source", `Fetching ${input.inputUrl}`, () =>
      firecrawlScrape(input.inputUrl, { formats: ["markdown", "links"], cache: pageCache }),
    );
    notePage(scraped.fromCache);
    sourceMarkdown = scraped.markdown ?? "";
    sourceLinks = (scraped.links ?? []).slice(0, 2000);
  } catch (e) {
    limitations.push(`Could not scrape source URL: ${(e as Error).message}`);
  }

  // Follow pagination so a multi-page directory isn't truncated to page 1.
  const paginationUrls = findPaginationUrls(input.inputUrl, sourceLinks, maxPages);
  const extraPages: Array<{ url: string; markdown: string }> = [];
  if (paginationUrls.length > 0) {
    await progress(
      "scrape_source",
      `Found ${paginationUrls.length} additional directory pages — fetching them`,
    );
    const results = await withHeartbeat(
      "scrape_source",
      `Fetching ${paginationUrls.length} additional directory pages`,
      () =>
        mapPool(paginationUrls, concurrency, async (url) => {
          try {
            const page = await firecrawlScrape(url, { formats: ["markdown"], cache: pageCache });
            notePage(page.fromCache);
            return { url, markdown: page.markdown ?? "" };
          } catch {
            return { url, markdown: "" };
          }
        }),
    );
    for (const r of results) if (r.markdown) extraPages.push(r);
    if (extraPages.length < paginationUrls.length) {
      limitations.push(
        `${paginationUrls.length - extraPages.length} directory page(s) could not be fetched.`,
      );
    }
  }

  const allMarkdown = [sourceMarkdown, ...extraPages.map((p) => p.markdown)].join("\n");

  await bumpCounters({ pages_reused: reusedPages, pages_fetched: fetchedPages });
  if (reusedPages > 0) {
    await progress(
      "scrape_source",
      `Reused ${reusedPages} cached directory page(s) from the last ${reuseHours}h · fetched ${fetchedPages} fresh`,
    );
    limitations.push(
      `Reused ${reusedPages} directory page(s) cached within the last ${reuseHours}h (set the reuse window to 0 on a new run to force fresh fetches).`,
    );
  }

  await progress("extract_events", "Identifying trade shows in the source");
  const parsedDirectoryEvents = dedupeEvents(
    extractEventsFromMarkdownDirectory(allMarkdown, input.targetMarket),
  );

  const promptHeader = (chunkNote: string) => `${CORE_SYSTEM}

Source URL: ${input.inputUrl}
Target market: ${input.targetMarket ?? "unspecified"}
Priority industries: ${(input.filters.priorityIndustries ?? []).join(", ") || "any"}

TASK: Read the scraped markdown below and identify trade shows / exhibitions. If it is a directory listing many shows, return EVERY show you can see (do not truncate the list). If it is a single event page, return that one event.${chunkNote}

Rank each event by opportunity for a custom-booth / LED / exhibit-services vendor. Use event_opportunity_score 0-100 based on: exhibitor count, industry fit for exhibit spending, average booth size, LED/AV relevance, geographic serviceability, time until event, whether exhibitor data is accessible, and recurring annual opportunity.

recommended_outreach_phase must be one of: EARLY_PLANNING, VENDOR_SELECTION, DESIGN_AND_BUDGET, PRODUCTION_SUPPORT, URGENT_SUPPORT, POST_SHOW_NURTURE.`;

  let eventList: import("zod").infer<typeof EventListSchema>;
  if (parsedDirectoryEvents.length > 0) {
    eventList = {
      source_classification: "markdown_directory_table",
      is_directory: true,
      events: parsedDirectoryEvents,
      limitations: [
        `Parsed ${parsedDirectoryEvents.length} shows directly from the directory table across ${extraPages.length + 1} page(s).`,
      ],
    };
    limitations.push(...(eventList.limitations ?? []));
  } else {
    // Chunk the markdown instead of truncating, then merge the per-chunk results.
    const chunks = chunkMarkdown(allMarkdown);
    try {
      const chunkResults = await withHeartbeat(
        "extract_events",
        `Identifying trade shows in the source (${chunks.length} section(s))`,
        () =>
          mapPool(chunks.length > 0 ? chunks : [""], Math.min(3, concurrency), (chunk, i) =>
            generateStructured(
              extractModel,
              EventListSchema,
              `${promptHeader(
                chunks.length > 1
                  ? `\n\nThis is section ${i + 1} of ${chunks.length} of a larger page — return only the events visible in this section.`
                  : "",
              )}

--- SOURCE MARKDOWN ---
${chunk}

--- LINKS ON PAGE ---
${sourceLinks.slice(0, 80).join("\n")}`,
            ).catch(() => null),
          ),
      );
      const merged = dedupeEvents(
        chunkResults.flatMap((r) => (r ? r.events : [])),
      );
      if (merged.length === 0) throw new Error("No events could be extracted from the source page.");
      eventList = {
        source_classification: chunkResults.find((r) => r)?.source_classification ?? "web_page",
        is_directory: merged.length > 1,
        events: merged,
        limitations: chunkResults.flatMap((r) => r?.limitations ?? []),
      };
      limitations.push(...(eventList.limitations ?? []));
    } catch (e) {
      if (NoObjectGeneratedError.isInstance(e)) {
        limitations.push("Event extraction returned malformed output; halting.");
      } else {
        limitations.push(`Event extraction failed: ${(e as Error).message}`);
      }
      await finishSteps();
      await admin.from("research_runs").update({
        status: "failed",
        error_message: (e as Error).message,
        limitations,
        step_log: stepLog,
      }).eq("id", runId);
      return;
    }
  }

  // Drop shows that are already over or too close to sell into (booth design,
  // fabrication and shipping need lead time).
  // An explicit "from" date is a direct answer to "is this too soon?", so when the
  // user supplies one it replaces the rolling lead-time window entirely.
  const minLeadDays = Math.max(0, Math.min(365, input.filters.minLeadTimeDays ?? 45));
  const fromDate = input.filters.startDateFrom ? parseEventStartDate(input.filters.startDateFrom) : null;
  const toDate = input.filters.startDateTo ? parseEventStartDate(input.filters.startDateTo) : null;

  const dated = eventList.events.map((e) => ({
    event: e,
    leadDays: eventLeadTimeDays(e.start_date),
    start: parseEventStartDate(e.start_date),
  }));

  // Undated shows are always kept — we can't prove they're too soon.
  const isEligible = (d: (typeof dated)[number]) => {
    if (fromDate || toDate) {
      if (!d.start) return true;
      if (fromDate && d.start < fromDate) return false;
      if (toDate && d.start > toDate) return false;
      return true;
    }
    return d.leadDays === null || d.leadDays >= minLeadDays;
  };

  const tooSoon = dated.filter((d) => !isEligible(d));
  const eligible = dated.filter(isEligible).map((d) => d.event);
  const windowLabel = fromDate
    ? `outside your date window (from ${input.filters.startDateFrom}${input.filters.startDateTo ? ` to ${input.filters.startDateTo}` : ""})`
    : toDate
      ? `after ${input.filters.startDateTo}`
      : `starting in under ${minLeadDays} days (or already past)`;

  await bumpCounters({
    discovered: eventList.events.length,
    filtered_too_soon: tooSoon.length,
    eligible: eligible.length,
  });



  if (tooSoon.length > 0) {
    limitations.push(
      `Skipped ${tooSoon.length} show(s) ${windowLabel}: ${tooSoon
        .slice(0, 5)
        .map((d) => d.event.event_name)
        .join(", ")}${tooSoon.length > 5 ? "…" : ""}`,
    );
  }

  if (eligible.length === 0 && eventList.events.length > 0) {
    const msg = `All ${eventList.events.length} show(s) found fall ${windowLabel}. Widen the date window (or lower "Min days until show") or use a directory page that lists later dates.`;
    limitations.push(msg);
    await finishSteps();
    await admin
      .from("research_runs")
      .update({ status: "failed", error_message: msg, limitations, step_log: stepLog })
      .eq("id", runId);
    return;
  }



  // Persist events
  const eventRows = eligible
    .sort((a, b) => b.event_opportunity_score - a.event_opportunity_score)
    .slice(0, maxEvents);
  if (eligible.length > eventRows.length) {
    limitations.push(
      `Source listed ${eligible.length} eligible shows; kept the top ${eventRows.length} by opportunity score.`,
    );
  }

  const insertedEvents = await admin
    .from("events")
    .insert(
      eventRows.map((e) => ({
        run_id: runId,
        event_name: e.event_name,
        official_url: e.official_url ?? null,
        industry: e.industry ?? null,
        start_date: e.start_date ?? null,
        end_date: e.end_date ?? null,
        venue: e.venue ?? null,
        city: e.city ?? null,
        state: e.state ?? null,
        country: e.country ?? null,
        event_opportunity_score: Math.max(0, Math.min(100, Math.round(e.event_opportunity_score))),
        recommended_outreach_phase: e.recommended_outreach_phase,
        source_urls: [input.inputUrl, e.official_url].filter(Boolean) as string[],
        raw: e,
      })),
    )
    .select();

  const eventsInDb = insertedEvents.data ?? [];

  await admin.from("research_runs").update({ status: "analyzing" }).eq("id", runId);

  // ---------------------------------------------------------------------
  // Phase 1 — official-site verification and 8-component event scoring.
  // Verification is expensive (scrape + model call per show), so it only runs
  // on the ranked candidate pool we could actually deep-dive.
  // ---------------------------------------------------------------------
  const plannedDeepDive = input.filters.maxDeepDiveShows ?? (eventList.is_directory ? 12 : 1);
  const verifyPool =
    plannedDeepDive === 0
      ? eventsInDb
      : eventsInDb.slice(0, Math.max(plannedDeepDive * 3, 30));
  if (eventsInDb.length > verifyPool.length) {
    limitations.push(
      `Verified the top ${verifyPool.length} of ${eventsInDb.length} shows by opportunity score (enough to fill ${plannedDeepDive} deep-dive slots).`,
    );
  }

  await progress("verify_events", `Verifying ${verifyPool.length} show(s) against their official sites`);

  const allowUnverified = input.filters.allowUnverifiedEvents === true;
  const verificationLog: PipelineLogEntry[] = [];
  let verifiedCount = 0;
  let excludedCount = 0;
  let verifyDone = 0;

  const verified = await mapPool(verifyPool, Math.min(4, concurrency), async (ev) => {

    const started = Date.now();
    const { verification, extras } = await verifyEvent({
      eventName: ev.event_name,
      officialUrl: ev.official_url ?? null,
      directoryStartDate: ev.start_date ?? null,
      directoryEndDate: ev.end_date ?? null,
      city: ev.city ?? null,
      state: ev.state ?? null,
      venue: ev.venue ?? null,
      generate: (schema, prompt) => generateStructured(extractModel, schema as ZodLike<never>, prompt),
    });

    const { breakdown, mode } = scoreEvent(
      {
        exhibitorCount: extras.estimatedExhibitorCount,
        averageCompanySize: null,
        industry: ev.industry ?? null,
        directoryStatus: verification.exhibitor_directory_status,
        daysUntilEvent: verification.days_until_event,
        serviceable: true,
        recurring: extras.recurring,
      },
      SPEC_EVENT_SCORING,
    );

    const reason = exclusionReason({
      status: verification.verified_status,
      daysUntilEvent: verification.days_until_event,
      hasIdentity: Boolean(verification.event_year || verification.start_date),
      consumerOnly: extras.consumerOnly ?? undefined,
      allowUnverified,
    });

    if (verification.verified_status === "CONFIRMED") verifiedCount += 1;
    if (reason) excludedCount += 1;

    await admin
      .from("events")
      .update({
        event_year: verification.event_year,
        verified_status: verification.verified_status,
        exhibitor_directory_status: verification.exhibitor_directory_status,
        days_until_event: verification.days_until_event,
        official_event_url: verification.official_event_url,
        verification_source_urls: verification.verification_source_urls,
        verification_checked_at: verification.verification_checked_at,
        verification_confidence: verification.verification_confidence,
        verification_notes: verification.verification_notes,
        start_date: verification.start_date ?? ev.start_date,
        end_date: verification.end_date ?? ev.end_date,
        city: verification.city ?? ev.city,
        state: verification.state ?? ev.state,
        venue: verification.venue ?? ev.venue,
        event_score: breakdown.total,
        event_score_breakdown: breakdown,
        scoring_mode: mode,
        event_opportunity_score: breakdown.total,
        recommended_outreach_phase: ev.recommended_outreach_phase,
        excluded: Boolean(reason),
        exclusion_reason: reason,
      })
      .eq("id", ev.id);

    verificationLog.push(
      pipelineLog("EVENT_VERIFICATION", reason ? "BLOCKED" : "SUCCESS", {
        run_id: runId,
        event_id: ev.id,
        source_url: verification.official_event_url ?? undefined,
        duration_ms: Date.now() - started,
        confidence: verification.verification_confidence ?? undefined,
        failure_reason: reason ?? undefined,
        message: `${ev.event_name}: ${verification.verified_status} — ${recommendedAction(
          breakdown.total,
          verification.verified_status,
        )}`,
      }),
    );

    await pushScoringEntry({
      at: new Date().toISOString(),
      company: ev.event_name,
      show: ev.event_name,
      status: reason ? "skipped" : "scored",
      score: breakdown.total,
      reason: reason
        ? `Excluded — ${reason}`
        : `${verification.verified_status} · event score ${breakdown.total} · ${recommendedAction(breakdown.total, verification.verified_status)}`,
    });

    return {
      ...ev,
      start_date: verification.start_date ?? ev.start_date,
      event_year: verification.event_year,
      verified_status: verification.verified_status as EventVerifiedStatus,
      event_score: breakdown.total,
      exclusion_reason: reason,
      days_until_event: verification.days_until_event,
      directory_status: verification.exhibitor_directory_status,
    };
  });

  await bumpCounters({
    events_verified: verifiedCount,
    events_excluded: excludedCount,
  });

  const eligibleEvents = verified
    .filter((e) => !e.exclusion_reason)
    .sort((a, b) => compareForProcessing(a, b));

  if (eligibleEvents.length === 0) {
    const msg = allowUnverified
      ? "No show survived verification — every candidate was canceled, already over, or lacked a usable identity."
      : "No show could be confirmed against its official website. Enable “Allow unverified shows” to process directory-only listings.";
    limitations.push(msg);
    await finishSteps();
    await admin
      .from("research_runs")
      .update({ status: "failed", error_message: msg, limitations, step_log: stepLog })
      .eq("id", runId);
    return;
  }

  // Scrape top events for exhibitors.
  // maxLeadsPerShow = 0 means "every exhibitor we can find on the show".
  const requestedLeads = input.filters.maxLeadsPerShow ?? 10;
  const unlimitedLeads = requestedLeads <= 0;
  const maxLeads = unlimitedLeads ? Number.POSITIVE_INFINITY : requestedLeads;
  /** Per-page extraction batch size (the model needs a finite number). */
  const extractBatch = unlimitedLeads ? 200 : requestedLeads * 2;

  // 0 (or unset via 0) means "deep-dive every show we kept" — no cap.
  const requestedDeepDive = input.filters.maxDeepDiveShows ?? (eventList.is_directory ? 12 : 1);
  const deepDiveCount =
    requestedDeepDive === 0 ? eligibleEvents.length : Math.max(1, Math.min(5000, requestedDeepDive));
  const topEvents = eligibleEvents.slice(0, eventList.is_directory ? deepDiveCount : 1);
  if (eligibleEvents.length > topEvents.length) {
    limitations.push(
      `Exhibitor deep-dive ran on the top ${topEvents.length} of ${eligibleEvents.length} verified shows; the rest are listed without leads.`,
    );
  }


  await bumpCounters({ kept: eventsInDb.length, deep_dive_total: topEvents.length });

  const allLeads: Array<{ lead: LeadRecord; eventId: string; eventName: string; eventDate: string | null; boothNumber: string | null }> = [];

  for (const ev of topEvents) {
    await progress("extract_exhibitors", `Extracting exhibitors from ${ev.event_name}`);

    const diag: SourceDiag = { candidates: 0, rejected: [], accepted: [] };
    const debugEntry: ShowDebugEntry = {
      show: ev.event_name,
      official_url: ev.official_url ?? null,
      candidates: 0,
      accepted: [],
      rejected: [],
      pages: [],
      exhibitors: 0,
      skip_reason: null,
    };
    const saveDebug = async () => {
      debugEntry.candidates = diag.candidates;
      debugEntry.accepted = diag.accepted.slice(0, 25);
      debugEntry.rejected = diag.rejected.slice(0, 25);
      const rest = counters.show_debug.filter((d) => d.show !== debugEntry.show);
      counters.show_debug = [debugEntry, ...rest].slice(0, 60);
      await bumpCounters({ show_debug: counters.show_debug });
    };

    let sources: Array<{ url: string; markdown: string }> = [
      { url: input.inputUrl, markdown: sourceMarkdown },
    ];

    if (eventList.is_directory && ev.official_url) {
      try {
        sources = await withHeartbeat(
          "extract_exhibitors",
          `Looking for the exhibitor list of ${ev.event_name}`,
          () =>
            findExhibitorSources(
              ev.official_url,
              ev.event_name,
              unlimitedLeads ? 0 : Math.max(requestedLeads, 12),
              diag,
            ),
        );
        if (sources.length === 0) {
          limitations.push(
            `No public exhibitor list found for ${ev.event_name} — event site did not expose an exhibitor directory.`,
          );
          await pushScoringEntry({
            at: new Date().toISOString(),
            company: "—",
            show: ev.event_name,
            status: "skipped",
            reason: "Skipped — no public exhibitor list found on the event site",
          });
          debugEntry.skip_reason = "No public exhibitor list found on the event site";
          await saveDebug();
          await bumpCounters({ deep_dive_done: counters.deep_dive_done + 1 });
          continue;
        }
      } catch (e) {
        limitations.push(`Could not scrape ${ev.event_name}: ${(e as Error).message}`);
        debugEntry.skip_reason = `Scrape failed — ${(e as Error).message}`;
        await saveDebug();
        await bumpCounters({ deep_dive_done: counters.deep_dive_done + 1 });
        continue;
      }
    }
    await saveDebug();



    // Try each candidate source until enough exhibitors are found. Detail pages
    // produce one company each, while listing pages can produce many.
    type RawExhibitor = import("zod").infer<typeof ExhibitorListSchema>["exhibitors"][number];
    type ExtractedExhibitor = RawExhibitor & ExhibitorProvenance;
    let exhibitors: ExtractedExhibitor[] = [];
    const metrics = emptyMetrics();
    const confidences: number[] = [];

    /**
     * Attach provenance, validate the evidence against the page it came from,
     * and keep only records that survive. Anything the source cannot back is
     * rejected rather than downgraded.
     */
    const addCandidateExhibitors = (
      items: RawExhibitor[],
      src: { url: string; markdown: string },
      method: ExtractionMethod,
    ) => {
      const sourceType = sourceTypeFor(src.url);
      const seen = new Set(exhibitors.map((item) => item.exhibitor_instance_key));
      let added = 0;
      for (const item of items) {
        metrics.records_extracted += 1;
        if (method === "AI") metrics.ai_records += 1;
        else metrics.deterministic_records += 1;

        const key = normalizedCompanyKey(item.company_name);
        if (!key) {
          metrics.records_rejected += 1;
          metrics.rejection_reasons.EMPTY_COMPANY_NAME =
            (metrics.rejection_reasons.EMPTY_COMPANY_NAME ?? 0) + 1;
          continue;
        }

        const line = evidenceLineFor(src.markdown, item.company_name);
        const evidenceText = item.evidence_text?.trim() || line?.text || null;
        const check = checkEvidence({
          companyName: item.company_name,
          evidenceText,
          sourceContent: src.markdown,
          locator: line ? { line: line.line, url: src.url } : { url: src.url },
        });
        if (!check.ok) {
          metrics.records_rejected += 1;
          metrics.rejection_reasons[check.reason] = (metrics.rejection_reasons[check.reason] ?? 0) + 1;
          continue;
        }

        const baseConfidence = method === "AI" ? 0.8 : 0.95;
        const confidence = capConfidence(baseConfidence, method, sourceType);
        const status = confidence >= MIN_RECORD_EXTRACTION_CONFIDENCE ? "CONFIRMED" : "UNCERTAIN";

        const record: ExtractedExhibitor = {
          ...item,
          source_url: src.url,
          source_type: sourceType,
          extraction_method: method,
          evidence_text: evidenceText,
          evidence_locator: item.evidence_locator ?? (line ? `line:${line.line}` : null),
          evidence_hash: evidenceHash(evidenceText),
          extraction_confidence: confidence,
          record_status: status,
          exhibitor_instance_key: exhibitorInstanceKey({
            eventId: ev.id,
            companyName: item.company_name,
            normalizedCompanyName: item.normalized_company_name,
            profileUrl: item.profile_url,
            boothNumber: item.booth_number,
            companyWebsite: item.company_website,
          }),
          account_key: accountKey({ companyWebsite: item.company_website, companyName: item.company_name }),
        };

        if (seen.has(record.exhibitor_instance_key)) {
          metrics.duplicates_grouped += 1;
          continue;
        }

        exhibitors.push(record);
        seen.add(record.exhibitor_instance_key);
        confidences.push(confidence);
        metrics.records_accepted += 1;
        if (status === "CONFIRMED") metrics.confirmed_records += 1;
        else metrics.uncertain_records += 1;
        if (record.booth_number) metrics.records_with_booth_numbers += 1;
        if (record.profile_url) metrics.records_with_profile_urls += 1;
        if (record.company_website) metrics.records_with_websites += 1;
        added += 1;
        if (exhibitors.length >= maxLeads) break;
      }
      return added;
    };

    /** Live counter update after each directory/detail page is parsed. */
    const recordPageParsed = async (sourceUrl: string, added: number) => {
      let host = sourceUrl;
      try {
        host = new URL(sourceUrl).hostname;
      } catch {
        // keep the raw string
      }
      metrics.pages_processed += 1;
      if (debugEntry.pages.length < 40) debugEntry.pages.push({ url: sourceUrl, added });
      debugEntry.exhibitors += added;
      await bumpCounters({
        exhibitor_pages_parsed: counters.exhibitor_pages_parsed + 1,
        exhibitor_pages_with_hits: counters.exhibitor_pages_with_hits + (added > 0 ? 1 : 0),
        exhibitors_found: counters.exhibitors_found + added,
        ...(added > 0
          ? { last_exhibitor_at: new Date().toISOString(), last_exhibitor_source: host }
          : {}),
      });
      await saveDebug();
    };


    for (const src of sources) {
      const deterministic = parseExhibitorsFromMarkdown(src.markdown, src.url, extractBatch);
      if (deterministic.length > 0) {
        const added = addCandidateExhibitors(deterministic, src, /\.pdf($|\?)/i.test(src.url) ? "PDF" : "HTML");
        await recordPageParsed(src.url, added);
        await pushScoringEntry({
          at: new Date().toISOString(),
          company: deterministic[0]?.company_name ?? "—",
          show: ev.event_name,
          status: "scored",
          reason: `Found ${deterministic.length} exhibitor(s) directly from ${new URL(src.url).hostname}`,
        });
        if (exhibitors.length >= maxLeads) break;
        continue;
      }

      const exhibitorPrompt = `${CORE_SYSTEM}

TASK: Extract EXHIBITING COMPANIES from the source below for event "${ev.event_name}". Return up to ${extractBatch} candidates. Extract EVERY exhibiting company listed on the page — do not stop early or summarize. Skip associations, government bodies, media partners, sponsors that aren't exhibitors, universities, and service vendors that are not the trade show's own exhibitors. Normalize company names (strip Inc./LLC/etc for normalized_company_name).

Source URL: ${src.url}

--- SOURCE MARKDOWN ---
${src.markdown.slice(0, 60000)}`;

      try {
        const exhibitorList = await withHeartbeat(
          "extract_exhibitors",
          `Extracting exhibitors from ${ev.event_name} (${new URL(src.url).hostname})`,
          () => generateStructured(extractModel, ExhibitorListSchema, exhibitorPrompt),
        );
        if (exhibitorList.extraction_complete === false) {
          limitations.push(`Exhibitor list for ${ev.event_name} is partial.`);
        }
        limitations.push(...(exhibitorList.limitations ?? []));
        const added =
          exhibitorList.exhibitors.length > 0 ? addCandidateExhibitors(exhibitorList.exhibitors, src, "AI") : 0;
        await recordPageParsed(src.url, added);
        if (exhibitors.length >= maxLeads) break;
      } catch (e) {
        limitations.push(`Exhibitor extraction failed for ${ev.event_name}: ${(e as Error).message}`);
        await recordPageParsed(src.url, 0);
      }
    }

    {
      const { kept, duplicatesGrouped } = dedupeExhibitorInstances(exhibitors);
      metrics.duplicates_grouped += duplicatesGrouped;
      exhibitors = kept;
    }
    metrics.candidate_sources_found = diag.candidates;
    metrics.sources_verified = sources.length;
    finalizeMetrics(metrics, confidences);
    await admin.from("events").update({ extraction_metrics: metrics }).eq("id", ev.id);
    stepLog.push({
      key: "extraction_metrics",
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: 0,
      message: `${ev.event_name}: ${metrics.records_accepted} accepted / ${metrics.records_rejected} rejected`,
    });
    pipelineLog("EVIDENCE_VALIDATION", metrics.records_rejected > 0 ? "SUCCESS_WITH_WARNINGS" : "SUCCESS", {
      run_id: runId,
      event_id: ev.id,
      accepted: metrics.records_accepted,
      rejected: metrics.records_rejected,
    });

    if (!unlimitedLeads) exhibitors = exhibitors.slice(0, requestedLeads);

    if (exhibitors.length === 0) {
      limitations.push(`No exhibitors could be extracted for ${ev.event_name}.`);
      await pushScoringEntry({
        at: new Date().toISOString(),
        company: "—",
        show: ev.event_name,
        status: "skipped",
        reason: `Skipped — no exhibitors extractable from ${sources.length} candidate page(s)`,
      });
      debugEntry.skip_reason = `No exhibitors extractable from ${sources.length} candidate page(s)`;
      await saveDebug();
      await bumpCounters({ deep_dive_done: counters.deep_dive_done + 1 });
      continue;
    }


    let completed = 0;


    await mapPool(exhibitors, concurrency, async (ex) => {
      // Firecrawl search for enrichment context
      let enrichmentContext = "";
      try {
        const results = await withHeartbeat(
          "enrich_leads",
          `[${ev.event_name}] Searching context for ${ex.company_name}`,
          () =>
            firecrawlSearch(
              `${ex.company_name} trade show exhibit booth ${ev.event_name}`,
              { limit: 3 },
            ),
        );
        enrichmentContext = results
          .map((r) => `[${r.url}] ${r.title ?? ""} — ${r.description ?? ""}`)
          .join("\n");
      } catch {
        // Non-fatal
      }

      const leadPrompt = `${CORE_SYSTEM}

You are analyzing ONE exhibitor and producing a complete lead record.

Company: ${ex.company_name}${ex.company_website ? ` (${ex.company_website})` : ""}
Trade show: ${ev.event_name}
Event date: ${ev.start_date ?? "unknown"} — ${ev.end_date ?? ""}
Event location: ${[ev.city, ev.state, ev.country].filter(Boolean).join(", ") || "unknown"}
Booth number: ${ex.booth_number ?? "unknown"}
Category: ${ex.category ?? "unknown"}
Target market: ${input.targetMarket ?? "unspecified"}
Priority industries: ${(input.filters.priorityIndustries ?? []).join(", ") || "any"}
Target services we offer: ${(input.filters.targetServices ?? ["custom booths", "modular booths", "LED walls", "installation", "graphics", "storage"]).join(", ")}
Minimum project value we care about: $${input.filters.minProjectValue ?? 0}

Additional research context (search snippets — treat as unverified):
${enrichmentContext || "(no additional context available)"}

TASK:
1. Estimate booth type, size, likely services needed, and an estimated project value range in USD.
2. Score the opportunity using the 9-component model. Components must sum to lead_score (max 100):
   - trade_show_activity (0-15), booth_scale_complexity (0-15), led_digital_fit (0-15), buying_capacity (0-10), timing (0-10), decision_maker_availability (0-10), growth_trigger_signals (0-10), service_fit (0-10), vendor_opportunity (0-5).
   Buyer's weighting emphasis (rescaled after you score — use it to judge what matters most): ${SCORE_COMPONENTS.map((c) => `${c.key}=${componentMax(scoring, c.key)}pts`).join(", ")}.
3. Suggest 1-3 decision makers. When you cannot verify a specific person (default), return a RECOMMENDED_TARGET with only title, role_classification=RECOMMENDED_TARGET, name=null, professional_profile_url=null, public_business_email=null, contact_confidence < 70, evidence_status=INFERRED. Company-size logic: <50 employees → founder/CEO/head of marketing; 50-500 → marketing/event marketing director/manager; >500 → director of events, experiential marketing, trade show manager.
4. Draft a 60-120 word first-touch email using only facts actually stated above (never invent details). Include subject line separately. Also draft a LinkedIn message ≤ 300 characters.
5. List buying_triggers, risks_and_uncertainties, unknown_fields, and a plain-language rationale.
6. Set confidence_level based on how well-supported the record is.`;

      try {
        const output = await withHeartbeat("enrich_leads", `[${ev.event_name}] Scoring ${ex.company_name}`, () =>
          generateStructured(reasonModel, LeadSchema, leadPrompt),
        );
        const entry: LeadEntry = {
          lead: output,
          eventId: ev.id,
          eventName: ev.event_name,
          eventDate: ev.start_date ?? null,
          eventYear: ev.event_year ?? null,
          boothNumber: ex.booth_number ?? null,
          displayedCompanyName: ex.displayed_company_name ?? null,
          hall: ex.hall ?? null,
          profileUrl: ex.profile_url ?? null,
          provenance: {
            source_url: ex.source_url,
            source_type: ex.source_type,
            extraction_method: ex.extraction_method,
            evidence_text: ex.evidence_text,
            evidence_locator: ex.evidence_locator,
            evidence_hash: ex.evidence_hash,
            extraction_confidence: ex.extraction_confidence,
            record_status: ex.record_status,
            exhibitor_instance_key: ex.exhibitor_instance_key,
            account_key: ex.account_key,
          },
        };
        allLeads.push(entry);
        const row = buildLeadRow(runId, input.inputUrl, entry, scoring);
        // Stream the lead into the database immediately so the UI can show it live.
        try {
          await admin.from("leads").insert(row);
        } catch {
          // non-fatal; the row is still counted in the summary
        }
        await bumpCounters({ leads_scored: counters.leads_scored + 1 });
        await pushScoringEntry(explainLeadScore(row, scoring));
        if (row.lead_score >= scoring.qualified_min) {
          const before = qualifiedCount;
          qualifiedCount += 1;
          await announceMilestone(before, qualifiedCount);
        }


      } catch (e) {
        limitations.push(`Could not analyze ${ex.company_name}: ${(e as Error).message}`);
        await pushScoringEntry({
          at: new Date().toISOString(),
          company: ex.company_name,
          show: ev.event_name,
          status: "skipped",
          reason: `Skipped — analysis failed: ${(e as Error).message}`,
        });
      }


      completed++;
      await progress(
        "enrich_leads",
        `[${ev.event_name}] Analyzed ${completed}/${exhibitors.length} (${ex.company_name}) · ${concurrency} at a time`,
      );
    });

    await bumpCounters({ deep_dive_done: counters.deep_dive_done + 1 });
  }


  // Deterministic scoring + tiering (rows were already streamed in as they were produced)
  const leadRows = allLeads.map(({ lead, eventId, eventName, eventDate, boothNumber }) =>
    buildLeadRow(runId, input.inputUrl, { lead, eventId, eventName, eventDate, boothNumber }, scoring),
  );


  await progress("summarize", "Generating executive summary");

  // Executive summary
  const t1 = leadRows.filter((l) => l.priority_tier === "TIER_1_IMMEDIATE").length;
  const verifiedDMs = leadRows.reduce(
    (acc, l) =>
      acc +
      (l.decision_makers as unknown as Array<{ evidence_status: string; contact_confidence: number }>).filter(
        (dm) => dm.evidence_status === "CONFIRMED" && dm.contact_confidence >= 70,
      ).length,
    0,
  );

  let execSummary: import("zod").infer<typeof ExecSummarySchema> = {
    shows_reviewed: eventsInDb.length,
    exhibitors_identified: leadRows.length,
    qualified_accounts: leadRows.filter((l) => l.lead_score >= scoring.tier3_min).length,
    verified_decision_makers: verifiedDMs,
    tier_1_leads: t1,
    top_industries: [],
    top_shows: eventsInDb.slice(0, 3).map((e) => e.event_name),
    main_limitations: limitations.slice(0, 10),
    recommended_immediate_action:
      t1 > 0
        ? `Contact the ${t1} Tier 1 leads first using the drafted outreach.`
        : "Review top-scored leads and refine targeting before outreach.",
  };

  try {
    const summaryPrompt = `${CORE_SYSTEM}

Produce an executive summary given these tallies. Fill top_industries from the leads' industries.

Shows reviewed: ${eventsInDb.length}
Leads analyzed: ${leadRows.length}
Tier 1: ${t1}
Verified decision makers: ${verifiedDMs}
Top shows: ${eventsInDb.slice(0, 3).map((e) => e.event_name).join(", ")}
Industries seen: ${Array.from(new Set(leadRows.map((l) => l.industry).filter(Boolean))).join(", ")}
Limitations: ${limitations.slice(0, 10).join(" | ")}`;
    execSummary = await generateStructured(extractModel, ExecSummarySchema, summaryPrompt);
  } catch {
    // fall back to computed
  }

  releaseBreakerWatch();
  await finishSteps();
  await admin
    .from("research_runs")
    .update({
      status: "complete",
      stage: "complete",
      progress_message: "Done",
      executive_summary: execSummary,
      limitations,
      step_log: stepLog,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  // Completion alert (in-app; email once a sender domain is verified).
  try {
    const { notifyRunComplete, runOwner } = await import("./notifications.server");
    const { userId, inputUrl } = await runOwner(admin, runId);
    if (userId) {
      await notifyRunComplete(admin, {
        runId,
        userId,
        inputUrl: inputUrl ?? input.inputUrl,
        leads: leadRows.length,
        qualified: leadRows.filter((l) => l.lead_score >= scoring.qualified_min).length,
        tier1: t1,
        shows: eventsInDb.length,
      });
    }
  } catch {
    // non-fatal
  }
}
