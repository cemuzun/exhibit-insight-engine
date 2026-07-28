CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type TEXT NOT NULL DEFAULT 'run_failed',
  title TEXT NOT NULL,
  body TEXT,
  run_id UUID REFERENCES public.research_runs(id) ON DELETE CASCADE,
  last_step TEXT,
  last_step_message TEXT,
  read_at TIMESTAMPTZ,
  email_status TEXT NOT NULL DEFAULT 'skipped',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_created_idx ON public.notifications (user_id, created_at DESC);
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications owner select" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notifications owner update" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notifications owner delete" ON public.notifications FOR DELETE TO authenticated USING (auth.uid() = user_id);