import { z } from "zod";

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
  event_opportunity_score: z.number().min(0).max(100),
  recommended_outreach_phase: z.string(),
  estimated_exhibitor_count: z.number().nullable().optional(),
  rationale: z.string(),
});

export const EventListSchema = z.object({
  source_classification: z.string(),
  is_directory: z.boolean(),
  events: z.array(EventSchema),
  limitations: z.array(z.string()),
});

export const ExhibitorSchema = z.object({
  company_name: z.string(),
  normalized_company_name: z.string(),
  company_website: z.string().nullable().optional(),
  booth_number: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
});

export const ExhibitorListSchema = z.object({
  exhibitors: z.array(ExhibitorSchema),
  total_found: z.number(),
  extraction_complete: z.boolean(),
  limitations: z.array(z.string()),
});

export const DecisionMakerSchema = z.object({
  name: z.string().nullable(),
  title: z.string(),
  role_classification: z.enum(["PRIMARY", "SECONDARY", "INFLUENCER", "RECOMMENDED_TARGET"]),
  professional_profile_url: z.string().nullable(),
  public_business_email: z.string().nullable(),
  contact_confidence: z.number().min(0).max(100),
  evidence_status: z.enum(["CONFIRMED", "INFERRED", "ESTIMATED", "UNKNOWN"]),
  relevance_explanation: z.string(),
});

export const ScoreBreakdownSchema = z.object({
  trade_show_activity: z.number(),
  booth_scale_complexity: z.number(),
  led_digital_fit: z.number(),
  buying_capacity: z.number(),
  timing: z.number(),
  decision_maker_availability: z.number(),
  growth_trigger_signals: z.number(),
  service_fit: z.number(),
  vendor_opportunity: z.number(),
});

export const LeadSchema = z.object({
  company_name: z.string(),
  normalized_company_name: z.string(),
  parent_company: z.string().nullable(),
  company_website: z.string().nullable(),
  industry: z.string().nullable(),
  employee_range: z.string().nullable(),
  revenue_range: z.string().nullable(),
  booth_type: z.string().nullable(),
  booth_size_estimate: z.string().nullable(),
  booth_analysis_confidence: z.number().min(0).max(100),
  recommended_services: z.array(z.string()),
  estimated_project_value_low: z.number(),
  estimated_project_value_high: z.number(),
  score_breakdown: ScoreBreakdownSchema,
  decision_makers: z.array(DecisionMakerSchema),
  recommended_outreach_date: z.string().nullable(),
  recommended_next_action: z.string(),
  personalized_email_subject: z.string(),
  personalized_email_body: z.string(),
  linkedin_message: z.string(),
  confidence_level: z.enum(["HIGH", "MEDIUM", "LOW"]),
  unknown_fields: z.array(z.string()),
  buying_triggers: z.array(z.string()),
  risks_and_uncertainties: z.array(z.string()),
  rationale: z.string(),
});

export const ExecSummarySchema = z.object({
  shows_reviewed: z.number(),
  exhibitors_identified: z.number(),
  qualified_accounts: z.number(),
  verified_decision_makers: z.number(),
  tier_1_leads: z.number(),
  top_industries: z.array(z.string()),
  top_shows: z.array(z.string()),
  main_limitations: z.array(z.string()),
  recommended_immediate_action: z.string(),
});

export type EventRecord = z.infer<typeof EventSchema>;
export type ExhibitorRecord = z.infer<typeof ExhibitorSchema>;
export type LeadRecord = z.infer<typeof LeadSchema>;
export type DecisionMakerRecord = z.infer<typeof DecisionMakerSchema>;
