CREATE TABLE public.outreach_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  recipient_name text,
  recipient_title text,
  recipient_email text NOT NULL,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  template_name text,
  lead_score integer NOT NULL DEFAULT 0,
  priority_tier text,
  status text NOT NULL DEFAULT 'draft',
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, lead_id, recipient_email)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outreach_emails TO authenticated;
GRANT ALL ON public.outreach_emails TO service_role;

ALTER TABLE public.outreach_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outreach owner select" ON public.outreach_emails FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "outreach owner insert" ON public.outreach_emails FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "outreach owner update" ON public.outreach_emails FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "outreach owner delete" ON public.outreach_emails FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX outreach_emails_run_idx ON public.outreach_emails(run_id, status);