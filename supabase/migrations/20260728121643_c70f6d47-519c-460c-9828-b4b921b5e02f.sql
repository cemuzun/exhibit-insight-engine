CREATE TABLE public.email_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  industry TEXT,
  trade_show TEXT,
  min_evidence_level TEXT NOT NULL DEFAULT 'ANY',
  min_lead_score INTEGER NOT NULL DEFAULT 0,
  subject_template TEXT NOT NULL DEFAULT '',
  body_template TEXT NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_templates TO authenticated;
GRANT ALL ON public.email_templates TO service_role;

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "templates owner select" ON public.email_templates FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "templates owner insert" ON public.email_templates FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "templates owner update" ON public.email_templates FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "templates owner delete" ON public.email_templates FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX email_templates_user_idx ON public.email_templates (user_id, created_at DESC);