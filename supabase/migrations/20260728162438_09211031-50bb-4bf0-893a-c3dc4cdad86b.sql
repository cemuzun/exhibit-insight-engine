-- Phase 1: events
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_year integer,
  ADD COLUMN IF NOT EXISTS verified_status text NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN IF NOT EXISTS exhibitor_directory_status text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS days_until_event integer,
  ADD COLUMN IF NOT EXISTS official_event_url text,
  ADD COLUMN IF NOT EXISTS verification_source_urls text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS verification_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_confidence numeric,
  ADD COLUMN IF NOT EXISTS verification_notes text,
  ADD COLUMN IF NOT EXISTS event_score integer,
  ADD COLUMN IF NOT EXISTS event_score_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS scoring_mode text NOT NULL DEFAULT 'SPEC_DEFAULT',
  ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclusion_reason text,
  ADD COLUMN IF NOT EXISTS extraction_metrics jsonb;

CREATE INDEX IF NOT EXISTS events_verified_status_idx ON public.events (verified_status);
CREATE INDEX IF NOT EXISTS events_event_year_idx ON public.events (event_year);
CREATE INDEX IF NOT EXISTS events_event_score_idx ON public.events (event_score);

-- Phase 2: leads (exhibitor instances)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS displayed_company_name text,
  ADD COLUMN IF NOT EXISTS profile_url text,
  ADD COLUMN IF NOT EXISTS hall text,
  ADD COLUMN IF NOT EXISTS product_category text,
  ADD COLUMN IF NOT EXISTS company_description text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS sponsor_level text,
  ADD COLUMN IF NOT EXISTS event_year integer,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS extraction_method text,
  ADD COLUMN IF NOT EXISTS evidence_text text,
  ADD COLUMN IF NOT EXISTS evidence_locator jsonb,
  ADD COLUMN IF NOT EXISTS evidence_hash text,
  ADD COLUMN IF NOT EXISTS extraction_confidence numeric,
  ADD COLUMN IF NOT EXISTS found_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS record_status text NOT NULL DEFAULT 'UNCERTAIN',
  ADD COLUMN IF NOT EXISTS represented_brand text,
  ADD COLUMN IF NOT EXISTS exhibitor_instance_key text,
  ADD COLUMN IF NOT EXISTS account_key text,
  ADD COLUMN IF NOT EXISTS blocked_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS conflicts jsonb,
  ADD COLUMN IF NOT EXISTS crm_deal_id text;

CREATE UNIQUE INDEX IF NOT EXISTS leads_run_instance_key_uidx
  ON public.leads (run_id, exhibitor_instance_key)
  WHERE exhibitor_instance_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_event_id_idx ON public.leads (event_id);
CREATE INDEX IF NOT EXISTS leads_normalized_name_idx ON public.leads (normalized_company_name);
CREATE INDEX IF NOT EXISTS leads_booth_number_idx ON public.leads (booth_number);
CREATE INDEX IF NOT EXISTS leads_record_status_idx ON public.leads (record_status);
CREATE INDEX IF NOT EXISTS leads_account_key_idx ON public.leads (account_key);

-- Phase 3: outreach drafts
ALTER TABLE public.outreach_emails
  ADD COLUMN IF NOT EXISTS draft_status text NOT NULL DEFAULT 'LEGACY_UNVALIDATED',
  ADD COLUMN IF NOT EXISTS blocked_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS personalization_fact jsonb,
  ADD COLUMN IF NOT EXISTS service_offered text,
  ADD COLUMN IF NOT EXISTS validation jsonb,
  ADD COLUMN IF NOT EXISTS outreach_phase text,
  ADD COLUMN IF NOT EXISTS recommended_send_date text,
  ADD COLUMN IF NOT EXISTS follow_up_date text;

CREATE INDEX IF NOT EXISTS outreach_emails_draft_status_idx ON public.outreach_emails (draft_status);