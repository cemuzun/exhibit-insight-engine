-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles self read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Research runs
CREATE TABLE public.research_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  input_url text NOT NULL,
  input_source_type text NOT NULL DEFAULT 'directory',
  target_market text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  stage text,
  progress_message text,
  executive_summary jsonb,
  limitations text[] NOT NULL DEFAULT ARRAY[]::text[],
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_runs TO authenticated;
GRANT ALL ON public.research_runs TO service_role;
ALTER TABLE public.research_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "runs owner select" ON public.research_runs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "runs owner insert" ON public.research_runs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "runs owner update" ON public.research_runs FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "runs owner delete" ON public.research_runs FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_runs_user_created ON public.research_runs(user_id, created_at DESC);

-- Events
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  official_url text,
  industry text,
  start_date text,
  end_date text,
  venue text,
  city text,
  state text,
  country text,
  event_opportunity_score int,
  recommended_outreach_phase text,
  source_urls text[] NOT NULL DEFAULT ARRAY[]::text[],
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events owner select" ON public.events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.research_runs r WHERE r.id = events.run_id AND r.user_id = auth.uid()));
CREATE POLICY "events owner write" ON public.events FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.research_runs r WHERE r.id = events.run_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.research_runs r WHERE r.id = events.run_id AND r.user_id = auth.uid()));
CREATE INDEX idx_events_run ON public.events(run_id);

-- Leads
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  company_name text NOT NULL,
  normalized_company_name text,
  parent_company text,
  company_website text,
  industry text,
  employee_range text,
  revenue_range text,
  trade_show text,
  event_date text,
  booth_number text,
  booth_type text,
  booth_size_estimate text,
  booth_analysis_confidence int,
  recommended_services text[] NOT NULL DEFAULT ARRAY[]::text[],
  estimated_project_value_low int,
  estimated_project_value_high int,
  budget_currency text DEFAULT 'USD',
  lead_score int NOT NULL DEFAULT 0,
  priority_tier text,
  score_breakdown jsonb,
  decision_makers jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_outreach_date text,
  recommended_next_action text,
  personalized_email text,
  linkedin_message text,
  confidence_level text,
  unknown_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  source_urls text[] NOT NULL DEFAULT ARRAY[]::text[],
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads owner select" ON public.leads FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.research_runs r WHERE r.id = leads.run_id AND r.user_id = auth.uid()));
CREATE POLICY "leads owner write" ON public.leads FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.research_runs r WHERE r.id = leads.run_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.research_runs r WHERE r.id = leads.run_id AND r.user_id = auth.uid()));
CREATE INDEX idx_leads_run_score ON public.leads(run_id, lead_score DESC);