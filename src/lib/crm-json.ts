/**
 * CRM-ready JSON (spec Phase 4.7) with runtime validation, plus the gated
 * HubSpot deal pipeline (spec 4.9) and stable sync keys (spec 4.10).
 */

import { z } from "zod";

export const CRM_SCHEMA_VERSION = "2.0";

export const CrmTradeShowSchema = z.object({
  name: z.string(),
  event_year: z.number().nullable(),
  official_url: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  location: z.string(),
  event_score: z.number(),
  event_score_breakdown: z.record(z.string(), z.number()).nullable(),
  verified_status: z.string(),
  verification_confidence: z.number().nullable(),
  exhibitor_directory_status: z.string(),
  verification_source_urls: z.array(z.string()),
});

export const CrmExhibitorSchema = z.object({
  company_name: z.string(),
  displayed_company_name: z.string().nullable(),
  normalized_company_name: z.string().nullable(),
  company_website: z.string().nullable(),
  booth_number: z.string().nullable(),
  hall: z.string().nullable(),
  profile_url: z.string().nullable(),
  evidence_text: z.string().nullable(),
  source_url: z.string().nullable(),
  source_type: z.string().nullable(),
  extraction_method: z.string().nullable(),
  extraction_confidence: z.number().nullable(),
  record_status: z.string(),
});

export const CrmLeadSchema = z.object({
  lead_score: z.number(),
  priority_tier: z.string(),
  score_breakdown: z.record(z.string(), z.number()).nullable(),
  estimated_project_value_low: z.number(),
  estimated_project_value_high: z.number(),
  recommended_services: z.array(z.string()),
  qualification_reasons: z.array(z.string()),
  blocked_reasons: z.array(z.string()),
  data_confidence: z.string().nullable(),
});

export const CrmContactSchema = z.object({
  name: z.string().nullable(),
  title: z.string(),
  department: z.string().nullable(),
  classification: z.string(),
  professional_profile_url: z.string().nullable(),
  business_email: z.string().nullable(),
  contact_confidence: z.number(),
  verification_status: z.string(),
  relevance_explanation: z.string().nullable(),
  source_urls: z.array(z.string()),
});

export const CrmOutreachSchema = z.object({
  status: z.string(),
  blocked_reasons: z.array(z.string()),
  subject: z.string(),
  email_body: z.string(),
  personalization_fact: z
    .object({
      type: z.string(),
      value: z.string(),
      source_url: z.string(),
      confidence: z.number(),
    })
    .nullable(),
  service_offered: z.string().nullable(),
  outreach_phase: z.string().nullable(),
  recommended_send_date: z.string().nullable(),
  follow_up_date: z.string().nullable(),
  validation: z.unknown().nullable(),
});

export const CrmRecordSchema = z.object({
  schema_version: z.literal(CRM_SCHEMA_VERSION),
  trade_show: CrmTradeShowSchema,
  exhibitor: CrmExhibitorSchema,
  lead: CrmLeadSchema,
  contacts: z.array(CrmContactSchema),
  outreach: CrmOutreachSchema.nullable(),
});

export const CrmRunExportSchema = z.object({
  schema_version: z.literal(CRM_SCHEMA_VERSION),
  run_id: z.string(),
  generated_at: z.string(),
  records: z.array(CrmRecordSchema),
});

export type CrmRecord = z.infer<typeof CrmRecordSchema>;
export type CrmRunExport = z.infer<typeof CrmRunExportSchema>;

/** HubSpot deal pipeline (spec 4.9), in advancement order. */
export const DEAL_STAGES = [
  "Trade Show Identified",
  "Exhibitors Extracted",
  "Company Qualified",
  "Decision Maker Found",
  "Contact Verified",
  "Email Prepared",
  "Outreach Sent",
  "Response Received",
  "Meeting Scheduled",
  "Design Requested",
  "Proposal Sent",
  "Negotiation",
  "Won",
  "Lost",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export type StageConditions = {
  hasEvent: boolean;
  hasExhibitorRecord: boolean;
  isQualified: boolean;
  hasContactOrTargetTitle: boolean;
  hasVerifiedContact: boolean;
  hasValidEmailDraft: boolean;
  outreachSent: boolean;
};

/**
 * Highest stage whose prerequisites are all satisfied. Stages never advance
 * past the first unmet condition.
 */
export function allowedDealStage(c: StageConditions): DealStage {
  if (!c.hasEvent) return "Trade Show Identified";
  if (!c.hasExhibitorRecord) return "Trade Show Identified";
  if (!c.isQualified) return "Exhibitors Extracted";
  if (!c.hasContactOrTargetTitle) return "Company Qualified";
  if (!c.hasVerifiedContact) return "Decision Maker Found";
  if (!c.hasValidEmailDraft) return "Contact Verified";
  if (!c.outreachSent) return "Email Prepared";
  return "Outreach Sent";
}

/** Stable, non-name-based synchronization keys (spec 4.10). */
export function companySyncKey(input: { companyWebsite?: string | null; accountKey?: string | null }): string {
  if (input.companyWebsite) {
    try {
      return new URL(input.companyWebsite).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      // fall through
    }
  }
  return String(input.accountKey ?? "").toLowerCase();
}

export function contactSyncKey(input: {
  companyId: string;
  profileUrl?: string | null;
  email?: string | null;
}): string {
  const identity = (input.email ?? input.profileUrl ?? "").trim().toLowerCase();
  return `${input.companyId}|${identity}`;
}

export function dealSyncKey(input: { companyId: string; eventId: string; eventYear: number | null }): string {
  return `${input.companyId}|${input.eventId}|${input.eventYear ?? "unknown"}`;
}
