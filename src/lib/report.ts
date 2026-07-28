/**
 * Spec-compliant output builder (Phase 4): the six report sections and the
 * CRM-ready JSON v2.0 export.
 */

import {
  CRM_SCHEMA_VERSION,
  CrmRunExportSchema,
  allowedDealStage,
  type CrmRecord,
  type CrmRunExport,
  type DealStage,
} from "./crm-json";

type Json = Record<string, unknown>;

export type ReportEvent = {
  id: string;
  event_name: string;
  official_url: string | null;
  event_year: number | null;
  start_date: string | null;
  end_date: string | null;
  city: string | null;
  state: string | null;
  venue: string | null;
  event_opportunity_score: number | null;
  event_score_breakdown: Json | null;
  verified_status: string | null;
  verification_confidence: number | null;
  exhibitor_directory_status: string | null;
  verification_source_urls: string[] | null;
  exclusion_reason: string | null;
};

export type ReportContact = {
  name?: string | null;
  title?: string | null;
  department?: string | null;
  contact_classification?: string | null;
  professional_profile_url?: string | null;
  public_business_email?: string | null;
  contact_confidence?: number | null;
  evidence_status?: string | null;
  relevance_explanation?: string | null;
  source_urls?: string[] | null;
};

export type ReportLead = {
  id: string;
  event_id: string | null;
  company_name: string;
  displayed_company_name: string | null;
  normalized_company_name: string | null;
  company_website: string | null;
  booth_number: string | null;
  hall: string | null;
  profile_url: string | null;
  evidence_text: string | null;
  evidence_source_url: string | null;
  evidence_source_type: string | null;
  extraction_method: string | null;
  extraction_confidence: number | null;
  record_status: string | null;
  lead_score: number;
  priority_tier: string | null;
  score_breakdown: Json | null;
  estimated_project_value_low: number | null;
  estimated_project_value_high: number | null;
  recommended_services: string[] | null;
  qualification_reasons: string[] | null;
  blocked_reasons: string[] | null;
  confidence_level: string | null;
  decision_makers: ReportContact[] | null;
  account_key: string | null;
  source_urls: string[] | null;
};

export type ReportOutreach = {
  lead_id: string;
  status: string;
  subject: string;
  body: string;
  blocked_reasons: string[] | null;
  personalization_fact: Json | null;
  service_offered: string | null;
  outreach_phase: string | null;
  recommended_send_date: string | null;
  follow_up_date: string | null;
  validation: unknown;
  recipient_name: string | null;
  recipient_title: string | null;
  recipient_email: string | null;
};

export type ReportInput = {
  runId: string;
  events: ReportEvent[];
  leads: ReportLead[];
  outreach: ReportOutreach[];
  generatedAt?: string;
};

const CONFIRMED = "CONFIRMED";

function eventLocation(e: ReportEvent): string {
  return [e.city, e.state].filter(Boolean).join(", ");
}

function toNumberRecord(value: Json | null): Record<string, number> | null {
  if (!value) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Section 1 — Executive summary. */
export function buildExecutiveSummary(input: ReportInput) {
  const verified = input.events.filter((e) => e.verified_status === CONFIRMED);
  const confirmedLeads = input.leads.filter((l) => l.record_status === CONFIRMED);
  const contacts = confirmedLeads.flatMap((l) => l.decision_makers ?? []);
  const verifiedContacts = contacts.filter((c) => (c.contact_classification ?? "") !== "INFERRED_TITLE_ONLY");
  const emails = input.outreach.filter((o) => o.status !== "blocked");

  const showCounts = new Map<string, number>();
  for (const lead of confirmedLeads) {
    const ev = input.events.find((e) => e.id === lead.event_id);
    if (!ev) continue;
    showCounts.set(ev.event_name, (showCounts.get(ev.event_name) ?? 0) + 1);
  }

  return {
    shows_reviewed: input.events.length,
    shows_verified: verified.length,
    shows_excluded: input.events.filter((e) => e.exclusion_reason).length,
    exhibitors_confirmed: confirmedLeads.length,
    qualified_accounts: confirmedLeads.filter((l) => (l.priority_tier ?? "") !== "UNQUALIFIED").length,
    tier_1_leads: confirmedLeads.filter((l) => l.priority_tier === "TIER_1").length,
    verified_decision_makers: verifiedContacts.length,
    emails_ready: emails.length,
    emails_blocked: input.outreach.length - emails.length,
    top_shows: Array.from(showCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ event_name: name, exhibitors: count })),
  };
}

/** Section 2 — Verified trade shows with scores. */
export function buildTradeShowSection(input: ReportInput) {
  return input.events
    .slice()
    .sort((a, b) => (b.event_opportunity_score ?? 0) - (a.event_opportunity_score ?? 0))
    .map((e) => ({
      event_name: e.event_name,
      event_year: e.event_year,
      official_url: e.official_url,
      dates: { start_date: e.start_date, end_date: e.end_date },
      location: eventLocation(e),
      venue: e.venue,
      event_score: e.event_opportunity_score ?? 0,
      event_score_breakdown: toNumberRecord(e.event_score_breakdown),
      verified_status: e.verified_status ?? "UNVERIFIED",
      verification_confidence: e.verification_confidence,
      exhibitor_directory_status: e.exhibitor_directory_status ?? "UNKNOWN",
      verification_source_urls: e.verification_source_urls ?? [],
      exclusion_reason: e.exclusion_reason,
    }));
}

/** Section 3 — Confirmed exhibitors with evidence. */
export function buildExhibitorSection(input: ReportInput) {
  return input.leads.map((l) => {
    const ev = input.events.find((e) => e.id === l.event_id);
    return {
      company_name: l.company_name,
      displayed_company_name: l.displayed_company_name,
      event_name: ev?.event_name ?? null,
      event_year: ev?.event_year ?? null,
      booth_number: l.booth_number,
      hall: l.hall,
      company_website: l.company_website,
      profile_url: l.profile_url,
      evidence_text: l.evidence_text,
      evidence_source_url: l.evidence_source_url,
      evidence_source_type: l.evidence_source_type,
      extraction_method: l.extraction_method,
      extraction_confidence: l.extraction_confidence,
      record_status: l.record_status ?? "UNVERIFIED",
    };
  });
}

/** Section 4 — Qualified leads with score breakdowns. */
export function buildQualifiedLeadSection(input: ReportInput) {
  return input.leads
    .filter((l) => l.record_status === CONFIRMED && (l.priority_tier ?? "UNQUALIFIED") !== "UNQUALIFIED")
    .sort((a, b) => b.lead_score - a.lead_score)
    .map((l) => {
      const ev = input.events.find((e) => e.id === l.event_id);
      return {
        company_name: l.company_name,
        event_name: ev?.event_name ?? null,
        lead_score: l.lead_score,
        priority_tier: l.priority_tier,
        score_breakdown: toNumberRecord(l.score_breakdown),
        estimated_project_value: {
          low: l.estimated_project_value_low ?? 0,
          high: l.estimated_project_value_high ?? 0,
        },
        recommended_services: l.recommended_services ?? [],
        qualification_reasons: l.qualification_reasons ?? [],
        data_confidence: l.confidence_level,
      };
    });
}

/** Section 5 — Decision makers. */
export function buildDecisionMakerSection(input: ReportInput) {
  const rows: Array<Record<string, unknown>> = [];
  for (const lead of input.leads) {
    for (const c of lead.decision_makers ?? []) {
      rows.push({
        company_name: lead.company_name,
        name: c.name ?? null,
        title: c.title ?? "Unknown",
        department: c.department ?? null,
        classification: c.contact_classification ?? "INFERRED_TITLE_ONLY",
        professional_profile_url: c.professional_profile_url ?? null,
        business_email: c.public_business_email ?? null,
        contact_confidence: c.contact_confidence ?? 0,
        verification_status: c.evidence_status ?? "UNVERIFIED",
        relevance_explanation: c.relevance_explanation ?? null,
        source_urls: c.source_urls ?? [],
      });
    }
  }
  return rows;
}

/** Section 6 — Outreach package. */
export function buildOutreachSection(input: ReportInput) {
  return input.outreach.map((o) => {
    const lead = input.leads.find((l) => l.id === o.lead_id);
    const ev = lead ? input.events.find((e) => e.id === lead.event_id) : undefined;
    return {
      company_name: lead?.company_name ?? "",
      event_name: ev?.event_name ?? null,
      recipient: { name: o.recipient_name, title: o.recipient_title, email: o.recipient_email },
      status: o.status,
      blocked_reasons: o.blocked_reasons ?? [],
      subject: o.subject,
      body: o.body,
      personalization_fact: o.personalization_fact,
      service_offered: o.service_offered,
      outreach_phase: o.outreach_phase,
      recommended_send_date: o.recommended_send_date,
      follow_up_date: o.follow_up_date,
      validation: o.validation ?? null,
    };
  });
}

export function buildReport(input: ReportInput) {
  return {
    schema_version: CRM_SCHEMA_VERSION,
    run_id: input.runId,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    section_1_executive_summary: buildExecutiveSummary(input),
    section_2_trade_shows: buildTradeShowSection(input),
    section_3_exhibitors: buildExhibitorSection(input),
    section_4_qualified_leads: buildQualifiedLeadSection(input),
    section_5_decision_makers: buildDecisionMakerSection(input),
    section_6_outreach: buildOutreachSection(input),
  };
}

export type BoothLensReport = ReturnType<typeof buildReport>;

/** Deal stage a record may occupy, derived from what is actually verified. */
export function dealStageFor(lead: ReportLead, event: ReportEvent | undefined, outreach?: ReportOutreach): DealStage {
  const contacts = lead.decision_makers ?? [];
  return allowedDealStage({
    hasEvent: Boolean(event),
    hasExhibitorRecord: Boolean(lead.record_status),
    isQualified: (lead.priority_tier ?? "UNQUALIFIED") !== "UNQUALIFIED",
    hasContactOrTargetTitle: contacts.length > 0,
    hasVerifiedContact: contacts.some((c) => (c.contact_classification ?? "") !== "INFERRED_TITLE_ONLY"),
    hasValidEmailDraft: Boolean(outreach && outreach.status !== "blocked"),
    outreachSent: outreach?.status === "sent",
  });
}

/** CRM-ready JSON v2.0, validated before it leaves the system. */
export function buildCrmExport(input: ReportInput): CrmRunExport {
  const records: CrmRecord[] = input.leads.map((lead) => {
    const ev = input.events.find((e) => e.id === lead.event_id);
    const o = input.outreach.find((x) => x.lead_id === lead.id);
    const fact = (o?.personalization_fact ?? null) as CrmRecord["outreach"] extends null
      ? never
      : Record<string, unknown> | null;

    return {
      schema_version: CRM_SCHEMA_VERSION,
      trade_show: {
        name: ev?.event_name ?? "",
        event_year: ev?.event_year ?? null,
        official_url: ev?.official_url ?? null,
        start_date: ev?.start_date ?? null,
        end_date: ev?.end_date ?? null,
        location: ev ? eventLocation(ev) : "",
        event_score: ev?.event_opportunity_score ?? 0,
        event_score_breakdown: toNumberRecord(ev?.event_score_breakdown ?? null),
        verified_status: ev?.verified_status ?? "UNVERIFIED",
        verification_confidence: ev?.verification_confidence ?? null,
        exhibitor_directory_status: ev?.exhibitor_directory_status ?? "UNKNOWN",
        verification_source_urls: ev?.verification_source_urls ?? [],
      },
      exhibitor: {
        company_name: lead.company_name,
        displayed_company_name: lead.displayed_company_name,
        normalized_company_name: lead.normalized_company_name,
        company_website: lead.company_website,
        booth_number: lead.booth_number,
        hall: lead.hall,
        profile_url: lead.profile_url,
        evidence_text: lead.evidence_text,
        source_url: lead.evidence_source_url,
        source_type: lead.evidence_source_type,
        extraction_method: lead.extraction_method,
        extraction_confidence: lead.extraction_confidence,
        record_status: lead.record_status ?? "UNVERIFIED",
      },
      lead: {
        lead_score: lead.lead_score,
        priority_tier: lead.priority_tier ?? "UNQUALIFIED",
        score_breakdown: toNumberRecord(lead.score_breakdown),
        estimated_project_value_low: lead.estimated_project_value_low ?? 0,
        estimated_project_value_high: lead.estimated_project_value_high ?? 0,
        recommended_services: lead.recommended_services ?? [],
        qualification_reasons: lead.qualification_reasons ?? [],
        blocked_reasons: lead.blocked_reasons ?? [],
        data_confidence: lead.confidence_level,
      },
      contacts: (lead.decision_makers ?? []).map((c) => ({
        name: c.name ?? null,
        title: c.title ?? "Unknown",
        department: c.department ?? null,
        classification: c.contact_classification ?? "INFERRED_TITLE_ONLY",
        professional_profile_url: c.professional_profile_url ?? null,
        business_email: c.public_business_email ?? null,
        contact_confidence: c.contact_confidence ?? 0,
        verification_status: c.evidence_status ?? "UNVERIFIED",
        relevance_explanation: c.relevance_explanation ?? null,
        source_urls: c.source_urls ?? [],
      })),
      outreach: o
        ? {
            status: o.status,
            blocked_reasons: o.blocked_reasons ?? [],
            subject: o.subject,
            email_body: o.body,
            personalization_fact:
              fact && typeof fact === "object"
                ? {
                    type: String((fact as Json).type ?? ""),
                    value: String((fact as Json).value ?? ""),
                    source_url: String((fact as Json).source_url ?? ""),
                    confidence: Number((fact as Json).confidence ?? 0),
                  }
                : null,
            service_offered: o.service_offered,
            outreach_phase: o.outreach_phase,
            recommended_send_date: o.recommended_send_date,
            follow_up_date: o.follow_up_date,
            validation: o.validation ?? null,
          }
        : null,
    };
  });

  return CrmRunExportSchema.parse({
    schema_version: CRM_SCHEMA_VERSION,
    run_id: input.runId,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    records,
  });
}
