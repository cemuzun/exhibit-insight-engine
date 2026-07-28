import { z } from "zod";

// NOTE: Keep these schemas free of numeric bounds, string formats, and long enums.
// Structured-output models frequently violate in-schema constraints, which fails
// post-hoc validation ("response did not match schema"). Clamp/normalize in code instead.

export const EventSchema = z.object({
  event_name: z.string(),
  official_url: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  venue: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  event_opportunity_score: z.coerce.number().catch(50).default(50),
  recommended_outreach_phase: z.string().catch("EARLY_PLANNING").default("EARLY_PLANNING"),
  estimated_exhibitor_count: z.coerce.number().nullable().optional(),
  rationale: z.string().nullable().optional(),
});

export const EventListSchema = z.object({
  source_classification: z.string().nullable().optional(),
  is_directory: z.coerce.boolean().catch(false).default(false),
  events: z.array(EventSchema).catch([]).default([]),
  limitations: z.array(z.string()).nullable().optional(),
});

export const ExhibitorSchema = z.object({
  company_name: z.string(),
  normalized_company_name: z.string().nullable().optional(),
  company_website: z.string().nullable().optional(),
  booth_number: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
});

export const ExhibitorListSchema = z.object({
  exhibitors: z.array(ExhibitorSchema).catch([]).default([]),
  total_found: z.coerce.number().nullable().optional(),
  extraction_complete: z.boolean().nullable().optional(),
  limitations: z.array(z.string()).nullable().optional(),
});

export const DecisionMakerSchema = z.object({
  name: z.string().nullable().optional(),
  title: z.string().catch("Unknown").default("Unknown"),
  role_classification: z.string().nullable().optional(),
  professional_profile_url: z.string().nullable().optional(),
  public_business_email: z.string().nullable().optional(),
  contact_confidence: z.coerce.number().nullable().optional(),
  evidence_status: z.string().nullable().optional(),
  relevance_explanation: z.string().nullable().optional(),
});

export const ScoreBreakdownSchema = z.object({
  trade_show_activity: z.coerce.number().catch(0).default(0),
  booth_scale_complexity: z.coerce.number().catch(0).default(0),
  led_digital_fit: z.coerce.number().catch(0).default(0),
  buying_capacity: z.coerce.number().catch(0).default(0),
  timing: z.coerce.number().catch(0).default(0),
  decision_maker_availability: z.coerce.number().catch(0).default(0),
  growth_trigger_signals: z.coerce.number().catch(0).default(0),
  service_fit: z.coerce.number().catch(0).default(0),
  vendor_opportunity: z.coerce.number().catch(0).default(0),
});

export const LeadSchema = z.object({
  company_name: z.string(),
  normalized_company_name: z.string().nullable().optional(),
  parent_company: z.string().nullable().optional(),
  company_website: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  employee_range: z.string().nullable().optional(),
  revenue_range: z.string().nullable().optional(),
  booth_type: z.string().nullable().optional(),
  booth_size_estimate: z.string().nullable().optional(),
  booth_analysis_confidence: z.coerce.number().nullable().optional(),
  recommended_services: z.array(z.string()).nullable().optional(),
  estimated_project_value_low: z.coerce.number().nullable().optional(),
  estimated_project_value_high: z.coerce.number().nullable().optional(),
  score_breakdown: ScoreBreakdownSchema.catch({} as never).default({} as never),
  decision_makers: z.array(DecisionMakerSchema).nullable().optional(),
  recommended_outreach_date: z.string().nullable().optional(),
  recommended_next_action: z.string().nullable().optional(),
  personalized_email_subject: z.string().nullable().optional(),
  personalized_email_body: z.string().nullable().optional(),
  linkedin_message: z.string().nullable().optional(),
  confidence_level: z.string().nullable().optional(),
  unknown_fields: z.array(z.string()).nullable().optional(),
  buying_triggers: z.array(z.string()).nullable().optional(),
  risks_and_uncertainties: z.array(z.string()).nullable().optional(),
  rationale: z.string().nullable().optional(),
});

export const ExecSummarySchema = z.object({
  shows_reviewed: z.coerce.number().catch(0).default(0),
  exhibitors_identified: z.coerce.number().catch(0).default(0),
  qualified_accounts: z.coerce.number().catch(0).default(0),
  verified_decision_makers: z.coerce.number().catch(0).default(0),
  tier_1_leads: z.coerce.number().catch(0).default(0),
  top_industries: z.array(z.string()).nullable().optional(),
  top_shows: z.array(z.string()).nullable().optional(),
  main_limitations: z.array(z.string()).nullable().optional(),
  recommended_immediate_action: z.string().catch("").default(""),
});

export type EventRecord = z.infer<typeof EventSchema>;
export type ExhibitorRecord = z.infer<typeof ExhibitorSchema>;
export type LeadRecord = z.infer<typeof LeadSchema>;
export type DecisionMakerRecord = z.infer<typeof DecisionMakerSchema>;
