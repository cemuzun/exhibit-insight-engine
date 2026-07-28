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
  const call = (args: Parameters<typeof generateText>[0]) =>
    guarded(llmLimiter, () => generateText(args), { label: "llm generate" });

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

export async function runPipeline(
  runId: string,
  input: {
    inputUrl: string;
    targetMarket?: string | null;
    filters: {
      minProjectValue?: number;
      maxLeadsPerShow?: number;
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

  const finishSteps = async () => {
    const last = stepLog[stepLog.length - 1];
    if (last && !last.ended_at) {
      const nowIso = new Date().toISOString();
      last.ended_at = nowIso;
      last.duration_ms = new Date(nowIso).getTime() - new Date(last.started_at).getTime();
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

  let sourceMarkdown = "";
  let sourceLinks: string[] = [];
  try {
    const scraped = await firecrawlScrape(input.inputUrl, { formats: ["markdown", "links"] });
    sourceMarkdown = scraped.markdown ?? "";
    sourceLinks = (scraped.links ?? []).slice(0, 200);
  } catch (e) {
    limitations.push(`Could not scrape source URL: ${(e as Error).message}`);
  }

  await progress("extract_events", "Identifying trade shows in the source");
  const eventListPrompt = `${CORE_SYSTEM}

Source URL: ${input.inputUrl}
Target market: ${input.targetMarket ?? "unspecified"}
Priority industries: ${(input.filters.priorityIndustries ?? []).join(", ") || "any"}

TASK: Read the scraped markdown below and identify trade shows / exhibitions. If it is a directory listing many shows, return them all (max 15). If it is a single event page, return that one event.

Rank each event by opportunity for a custom-booth / LED / exhibit-services vendor. Use event_opportunity_score 0-100 based on: exhibitor count, industry fit for exhibit spending, average booth size, LED/AV relevance, geographic serviceability, time until event, whether exhibitor data is accessible, and recurring annual opportunity.

recommended_outreach_phase must be one of: EARLY_PLANNING, VENDOR_SELECTION, DESIGN_AND_BUDGET, PRODUCTION_SUPPORT, URGENT_SUPPORT, POST_SHOW_NURTURE.

--- SOURCE MARKDOWN ---
${sourceMarkdown.slice(0, 25000)}

--- LINKS ON PAGE ---
${sourceLinks.slice(0, 80).join("\n")}`;

  let eventList: import("zod").infer<typeof EventListSchema>;
  try {
    eventList = await generateStructured(extractModel, EventListSchema, eventListPrompt);
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

  // Persist events
  const eventRows = eventList.events
    .sort((a, b) => b.event_opportunity_score - a.event_opportunity_score)
    .slice(0, 15);
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
  const topEvents = eventsInDb.slice(0, eventList.is_directory ? 2 : 1);

  const allLeads: Array<{ lead: LeadRecord; eventId: string; eventName: string; eventDate: string | null; boothNumber: string | null }> = [];

  for (const ev of topEvents) {
    await progress("extract_exhibitors", `Extracting exhibitors from ${ev.event_name}`);

    let exhibitorSource = sourceMarkdown;
    let exhibitorSourceUrl = input.inputUrl;

    if (eventList.is_directory && ev.official_url) {
      try {
        const scraped = await firecrawlScrape(ev.official_url, { formats: ["markdown", "links"] });
        exhibitorSource = scraped.markdown ?? "";
        exhibitorSourceUrl = ev.official_url;
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
      exhibitorList = await generateStructured(extractModel, ExhibitorListSchema, exhibitorPrompt);
      if (exhibitorList.extraction_complete === false) {
        limitations.push(`Exhibitor list for ${ev.event_name} is partial.`);
      }
      limitations.push(...(exhibitorList.limitations ?? []));
    } catch (e) {
      limitations.push(`Exhibitor extraction failed for ${ev.event_name}: ${(e as Error).message}`);
      continue;
    }

    const exhibitors = exhibitorList.exhibitors.slice(0, maxLeads);

    let completed = 0;

    await mapPool(exhibitors, concurrency, async (ex) => {
      // Firecrawl search for enrichment context
      let enrichmentContext = "";
      try {
        const results = await firecrawlSearch(
          `${ex.company_name} trade show exhibit booth ${ev.event_name}`,
          { limit: 3 },
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
        const output = await generateStructured(reasonModel, LeadSchema, leadPrompt);
        allLeads.push({
          lead: output,
          eventId: ev.id,
          eventName: ev.event_name,
          eventDate: ev.start_date ?? null,
          boothNumber: ex.booth_number ?? null,
        });
      } catch (e) {
        limitations.push(`Could not analyze ${ex.company_name}: ${(e as Error).message}`);
      }

      completed++;
      await progress(
        "enrich_leads",
        `[${ev.event_name}] Analyzed ${completed}/${exhibitors.length} (${ex.company_name}) · ${concurrency} at a time`,
      );
    });



  }

  // Deterministic scoring + tiering
  const leadRows = allLeads.map(({ lead, eventId, eventName, eventDate, boothNumber }) => {
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
      source_urls: [input.inputUrl],
      raw: lead,
    };
  });

  if (leadRows.length > 0) {
    await admin.from("leads").insert(leadRows);
  }

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
