import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { fetchAllRows } from "./fetch-all";
import {
  buildCrmExport,
  buildReport,
  type ReportContact,
  type ReportEvent,
  type ReportInput,
  type ReportLead,
  type ReportOutreach,
} from "./report";
import type { Json } from "@/integrations/supabase/types";

type Row = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function toEvent(row: Row): ReportEvent {
  return {
    id: String(row.id),
    event_name: String(row.event_name ?? ""),
    official_url: str(row.official_event_url) ?? str(row.official_url),
    event_year: num(row.event_year),
    start_date: str(row.start_date),
    end_date: str(row.end_date),
    city: str(row.city),
    state: str(row.state),
    venue: str(row.venue),
    event_opportunity_score: num(row.event_score) ?? num(row.event_opportunity_score),
    event_score_breakdown: obj(row.event_score_breakdown),
    verified_status: str(row.verified_status),
    verification_confidence: num(row.verification_confidence),
    exhibitor_directory_status: str(row.exhibitor_directory_status),
    verification_source_urls: arr(row.verification_source_urls),
    exclusion_reason: str(row.exclusion_reason),
  };
}

function toLead(row: Row): ReportLead {
  const raw = obj(row.raw) ?? {};
  return {
    id: String(row.id),
    event_id: str(row.event_id),
    company_name: String(row.company_name ?? ""),
    displayed_company_name: str(row.displayed_company_name),
    normalized_company_name: str(row.normalized_company_name),
    company_website: str(row.company_website),
    booth_number: str(row.booth_number),
    hall: str(row.hall),
    profile_url: str(row.profile_url),
    evidence_text: str(row.evidence_text),
    evidence_source_url: arr(row.source_urls)[arr(row.source_urls).length - 1] ?? null,
    evidence_source_type: str(row.source_type),
    extraction_method: str(row.extraction_method),
    extraction_confidence: num(row.extraction_confidence),
    record_status: str(row.record_status),
    lead_score: num(row.lead_score) ?? 0,
    priority_tier: str(row.priority_tier),
    score_breakdown: obj(row.score_breakdown),
    estimated_project_value_low: num(row.estimated_project_value_low),
    estimated_project_value_high: num(row.estimated_project_value_high),
    recommended_services: arr(row.recommended_services),
    qualification_reasons: arr(raw.qualification_reasons),
    blocked_reasons: arr(row.blocked_reasons),
    confidence_level: str(row.confidence_level),
    decision_makers: Array.isArray(row.decision_makers)
      ? (row.decision_makers as ReportContact[])
      : [],
    account_key: str(row.account_key),
    source_urls: arr(row.source_urls),
  };
}

function toOutreach(row: Row): ReportOutreach {
  return {
    lead_id: String(row.lead_id),
    status: String(row.draft_status ?? row.status ?? "draft"),
    subject: String(row.subject ?? ""),
    body: String(row.body ?? ""),
    blocked_reasons: arr(row.blocked_reasons),
    personalization_fact: obj(row.personalization_fact),
    service_offered: str(row.service_offered),
    outreach_phase: str(row.outreach_phase),
    recommended_send_date: str(row.recommended_send_date),
    follow_up_date: str(row.follow_up_date),
    validation: row.validation ?? null,
    recipient_name: str(row.recipient_name),
    recipient_title: str(row.recipient_title),
    recipient_email: str(row.recipient_email),
  };
}

type Supa = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        range: (
          from: number,
          to: number,
        ) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
      };
    };
  };
};

async function loadReportInput(client: unknown, runId: string): Promise<ReportInput> {
  const supabase = client as Supa;
  const page = (table: string) => () => supabase.from(table).select("*").eq("run_id", runId);
  const [events, leads, outreach] = await Promise.all([
    fetchAllRows<Row>(page("events")),
    fetchAllRows<Row>(page("leads")),
    fetchAllRows<Row>(page("outreach_emails")),
  ]);
  return {
    runId,
    events: events.map(toEvent),
    leads: leads.map(toLead),
    outreach: outreach.map(toOutreach),
  };
}

/** The six spec report sections for one run. */
export const getRunReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const input = await loadReportInput(context.supabase, data.runId);
    return JSON.parse(JSON.stringify(buildReport(input))) as Json;
  });

/** CRM-ready JSON v2.0 for one run, validated before it is returned. */
export const getRunCrmExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const input = await loadReportInput(context.supabase, data.runId);
    return JSON.parse(JSON.stringify(buildCrmExport(input))) as Json;
  });
