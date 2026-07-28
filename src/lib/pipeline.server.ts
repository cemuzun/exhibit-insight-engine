import { generateText, Output, NoObjectGeneratedError } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLovableAiGatewayProvider, requireLovableKey } from "./ai-gateway.server";
import { firecrawlScrape, firecrawlSearch } from "./firecrawl.server";
import {
  guarded,
  llmLimiter,
  firecrawlLimiter,
  enrichConcurrency,
  mapPool,
} from "./rate-limit.server";
import {
  EventListSchema,
  ExhibitorListSchema,
  LeadSchema,
  ExecSummarySchema,
  type EventRecord,
  type LeadRecord,
} from "./pipeline-schemas";

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
  boothNumber: string | null;
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

const SCORE_MAX: Record<string, number> = {
  trade_show_activity: 15,
  booth_scale_complexity: 15,
  led_digital_fit: 15,
  buying_capacity: 10,
  timing: 10,
  decision_maker_availability: 10,
  growth_trigger_signals: 10,
  service_fit: 10,
  vendor_opportunity: 5,
};

const TIER_REASON: Record<string, string> = {
  TIER_1_IMMEDIATE: "Top score with a confirmed decision-maker path — prioritized for immediate outreach.",
  TIER_2_HIGH_PRIORITY: "Strong fit but no confirmed contact yet — high-priority outreach.",
  TIER_3_NURTURE: "Moderate fit — worth nurturing ahead of the show.",
  TIER_4_LOW_PRIORITY: "Low fit signals — deprioritized, kept for reference only.",
};

/** Explain a scored lead: strongest and weakest scoring components. */
export function explainLeadScore(row: ReturnType<typeof buildLeadRow>): ScoringFeedEntry {
  const b = (row.score_breakdown ?? {}) as Record<string, number>;
  const parts = Object.keys(SCORE_MAX).map((key) => ({
    key,
    points: Number(b[key] ?? 0),
    max: SCORE_MAX[key],
  }));
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
function buildLeadRow(runId: string, inputUrl: string, entry: LeadEntry) {
  const { lead, eventId, eventName, eventDate, boothNumber } = entry;
  const b = lead.score_breakdown;
  const total = Math.min(
    100,
    b.trade_show_activity +
      b.booth_scale_complexity +
      b.led_digital_fit +
      b.buying_capacity +
      b.timing +
      b.decision_maker_availability +
      b.growth_trigger_signals +
      b.service_fit +
      b.vendor_opportunity,
  );

  // Tier 1 requires a credible decision-maker path
  const decisionMakers = lead.decision_makers ?? [];
  const hasVerified = decisionMakers.some(
    (dm) => (dm.contact_confidence ?? 0) >= 70 && dm.evidence_status === "CONFIRMED",
  );
  let tier: string;
  if (total >= 80 && hasVerified) tier = "TIER_1_IMMEDIATE";
  else if (total >= 65) tier = "TIER_2_HIGH_PRIORITY";
  else if (total >= 50) tier = "TIER_3_NURTURE";
  else tier = "TIER_4_LOW_PRIORITY";

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
    source_urls: [inputUrl],
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

function looksLikeExhibitorContent(markdown: string): boolean {
  if (markdown.length < 400) return false;
  const hits = (markdown.match(/booth|stand\s?#|exhibitor/gi) ?? []).length;
  return hits >= 3;
}

/**
 * Event homepages almost never list exhibitors. Follow links that look like an
 * exhibitor directory, and fall back to a web search, before giving up.
 */
async function findExhibitorListSource(
  officialUrl: string,
  eventName: string,
): Promise<{ url: string; markdown: string } | null> {
  const home = await firecrawlScrape(officialUrl, { formats: ["markdown", "links"] }).catch(() => null);

  const candidates: string[] = [];
  for (const link of home?.links ?? []) {
    if (EXHIBITOR_LINK_RE.test(link)) candidates.push(link);
    if (candidates.length >= 3) break;
  }

  if (candidates.length === 0) {
    const results = await firecrawlSearch(`${eventName} exhibitor list directory`, { limit: 3 }).catch(
      () => [] as Array<{ url: string }>,
    );
    for (const r of results) if (r.url) candidates.push(r.url);
  }

  for (const url of candidates.slice(0, 3)) {
    const page = await firecrawlScrape(url, { formats: ["markdown"] }).catch(() => null);
    const md = page?.markdown ?? "";
    if (looksLikeExhibitorContent(md)) return { url, markdown: md };
  }

  const homeMd = home?.markdown ?? "";
  if (looksLikeExhibitorContent(homeMd)) return { url: officialUrl, markdown: homeMd };
  return null;
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
      /** Max shows to deep-dive for exhibitors/leads (default 4). */
      maxDeepDiveShows?: number;
      /** Skip shows starting sooner than this many days from now (default 45). */
      minLeadTimeDays?: number;
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
    leads_scored: 0,
    scoring_feed: [] as ScoringFeedEntry[],
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

  const key = requireLovableKey();
  const gateway = createLovableAiGatewayProvider(key);
  const extractModel = gateway(EXTRACT_MODEL);
  const reasonModel = gateway(REASON_MODEL);

  await admin.from("research_runs").update({ status: "scraping" }).eq("id", runId);
  await progress("scrape_source", `Fetching ${input.inputUrl}`);

  const maxEvents = Math.max(1, Math.min(2000, input.filters.maxEvents ?? 500));
  const maxPages = Math.max(1, Math.min(50, input.filters.maxDirectoryPages ?? 25));

  let sourceMarkdown = "";
  let sourceLinks: string[] = [];
  try {
    const scraped = await withHeartbeat("scrape_source", `Fetching ${input.inputUrl}`, () =>
      firecrawlScrape(input.inputUrl, { formats: ["markdown", "links"] }),
    );
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
            const page = await firecrawlScrape(url, { formats: ["markdown"] });
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
  const minLeadDays = Math.max(0, Math.min(365, input.filters.minLeadTimeDays ?? 45));
  const dated = eventList.events.map((e) => ({ event: e, leadDays: eventLeadTimeDays(e.start_date) }));
  const tooSoon = dated.filter((d) => d.leadDays !== null && d.leadDays < minLeadDays);
  const eligible = dated.filter((d) => d.leadDays === null || d.leadDays >= minLeadDays).map((d) => d.event);

  await bumpCounters({
    discovered: eventList.events.length,
    filtered_too_soon: tooSoon.length,
    eligible: eligible.length,
  });



  if (tooSoon.length > 0) {
    limitations.push(
      `Skipped ${tooSoon.length} show(s) starting in under ${minLeadDays} days (or already past): ${tooSoon
        .slice(0, 5)
        .map((d) => d.event.event_name)
        .join(", ")}${tooSoon.length > 5 ? "…" : ""}`,
    );
  }

  if (eligible.length === 0 && eventList.events.length > 0) {
    const msg = `All ${eventList.events.length} show(s) found start in under ${minLeadDays} days or are already past. Lower "Min days until show" or use a directory page that lists later dates.`;
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

  // Scrape top events for exhibitors
  const maxLeads = input.filters.maxLeadsPerShow ?? 10;
  const deepDiveCount = Math.max(
    1,
    Math.min(25, input.filters.maxDeepDiveShows ?? (eventList.is_directory ? 4 : 1)),
  );
  const topEvents = eventsInDb.slice(0, eventList.is_directory ? deepDiveCount : 1);
  if (eventsInDb.length > topEvents.length) {
    limitations.push(
      `Exhibitor deep-dive ran on the top ${topEvents.length} of ${eventsInDb.length} shows; the rest are listed without leads.`,
    );
  }

  await bumpCounters({ kept: eventsInDb.length, deep_dive_total: topEvents.length });

  const allLeads: Array<{ lead: LeadRecord; eventId: string; eventName: string; eventDate: string | null; boothNumber: string | null }> = [];

  for (const ev of topEvents) {
    await progress("extract_exhibitors", `Extracting exhibitors from ${ev.event_name}`);


    let exhibitorSource = sourceMarkdown;
    let exhibitorSourceUrl = input.inputUrl;

    if (eventList.is_directory && ev.official_url) {
      try {
        const found = await withHeartbeat(
          "extract_exhibitors",
          `Looking for the exhibitor list of ${ev.event_name}`,
          () => findExhibitorListSource(ev.official_url, ev.event_name),
        );
        if (!found) {
          limitations.push(
            `No public exhibitor list found for ${ev.event_name} — event site did not expose an exhibitor directory.`,
          );
          continue;
        }
        exhibitorSource = found.markdown;
        exhibitorSourceUrl = found.url;
      } catch (e) {
        limitations.push(`Could not scrape ${ev.event_name}: ${(e as Error).message}`);
        continue;
      }
    }

    const exhibitorPrompt = `${CORE_SYSTEM}

TASK: Extract EXHIBITING COMPANIES from the source below for event "${ev.event_name}". Return up to ${maxLeads * 2} candidates. Skip associations, government bodies, media partners, sponsors that aren't exhibitors, universities, and service vendors that are not the trade show's own exhibitors. Normalize company names (strip Inc./LLC/etc for normalized_company_name).

Source URL: ${exhibitorSourceUrl}

--- SOURCE MARKDOWN ---
${exhibitorSource.slice(0, 30000)}`;

    let exhibitorList: import("zod").infer<typeof ExhibitorListSchema>;
    try {
      exhibitorList = await withHeartbeat("extract_exhibitors", `Extracting exhibitors from ${ev.event_name}`, () =>
        generateStructured(extractModel, ExhibitorListSchema, exhibitorPrompt),
      );
      if (exhibitorList.extraction_complete === false) {
        limitations.push(`Exhibitor list for ${ev.event_name} is partial.`);
      }
      limitations.push(...(exhibitorList.limitations ?? []));
    } catch (e) {
      limitations.push(`Exhibitor extraction failed for ${ev.event_name}: ${(e as Error).message}`);
      continue;
    }

    const exhibitors = exhibitorList.exhibitors.slice(0, maxLeads);
    await bumpCounters({ exhibitors_found: counters.exhibitors_found + exhibitors.length });

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
3. Suggest 1-3 decision makers. When you cannot verify a specific person (default), return a RECOMMENDED_TARGET with only title, role_classification=RECOMMENDED_TARGET, name=null, professional_profile_url=null, public_business_email=null, contact_confidence < 70, evidence_status=INFERRED. Company-size logic: <50 employees → founder/CEO/head of marketing; 50-500 → marketing/event marketing director/manager; >500 → director of events, experiential marketing, trade show manager.
4. Draft a 60-120 word first-touch email using only facts actually stated above (never invent details). Include subject line separately. Also draft a LinkedIn message ≤ 300 characters.
5. List buying_triggers, risks_and_uncertainties, unknown_fields, and a plain-language rationale.
6. Set confidence_level based on how well-supported the record is.`;

      try {
        const output = await withHeartbeat("enrich_leads", `[${ev.event_name}] Scoring ${ex.company_name}`, () =>
          generateStructured(reasonModel, LeadSchema, leadPrompt),
        );
        const entry = {
          lead: output,
          eventId: ev.id,
          eventName: ev.event_name,
          eventDate: ev.start_date ?? null,
          boothNumber: ex.booth_number ?? null,
        };
        allLeads.push(entry);
        const row = buildLeadRow(runId, input.inputUrl, entry);
        // Stream the lead into the database immediately so the UI can show it live.
        try {
          await admin.from("leads").insert(row);
        } catch {
          // non-fatal; the row is still counted in the summary
        }
        await bumpCounters({ leads_scored: counters.leads_scored + 1 });
        await pushScoringEntry(explainLeadScore(row));
        if (row.lead_score >= 65) {
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
    buildLeadRow(runId, input.inputUrl, { lead, eventId, eventName, eventDate, boothNumber }),
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
    qualified_accounts: leadRows.filter((l) => l.lead_score >= 50).length,
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
}
