// Single source of truth for the database schema BoothLens expects.
// Consumed by scripts/preflight.mjs (schema check) — keep in sync with the
// migrations in supabase/migrations.
export const REQUIRED_TABLES = [
  {
    name: "profiles",
    columns: ["id", "display_name", "created_at"],
    migration: "profiles table (user display names, keyed to auth user id)",
  },
  {
    name: "research_runs",
    columns: [
      "id",
      "user_id",
      "input_url",
      "input_source_type",
      "status",
      "stage",
      "executive_summary",
      "limitations",
      "error_message",
    ],
    migration: "research_runs table (one row per research run, owner-scoped RLS)",
  },
  {
    name: "events",
    columns: [
      "id",
      "run_id",
      "event_name",
      "official_url",
      "industry",
      "event_opportunity_score",
      "source_urls",
    ],
    migration: "events table (trade shows discovered by a run)",
  },
  {
    name: "leads",
    columns: [
      "id",
      "run_id",
      "event_id",
      "company_name",
      "lead_score",
      "priority_tier",
      "score_breakdown",
      "decision_makers",
      "crm_status",
      "crm_company_id",
      "crm_contact_ids",
      "crm_synced_at",
      "crm_error",
    ],
    migration: "leads table incl. CRM sync columns (crm_status, crm_company_id, ...)",
  },
  {
    name: "email_templates",
    columns: [
      "id",
      "user_id",
      "name",
      "industry",
      "trade_show",
      "min_evidence_level",
      "min_lead_score",
      "subject_template",
      "body_template",
      "is_default",
    ],
    migration: "email_templates table (per-industry / per-show outreach templates)",
  },
  {
    name: "digest_schedules",
    columns: [
      "id",
      "user_id",
      "recipient_email",
      "enabled",
      "days_of_week",
      "hour_of_day",
      "timezone",
      "min_lead_score",
      "only_tier_1",
      "last_sent_at",
    ],
    migration: "digest_schedules table (scheduled qualified-lead digests)",
  },
];

// Database functions that must be callable/present.
export const REQUIRED_FUNCTIONS = [
  {
    name: "handle_new_user",
    kind: "trigger",
    migration: "handle_new_user() trigger function that seeds public.profiles on signup",
  },
];

export default { REQUIRED_TABLES, REQUIRED_FUNCTIONS };
