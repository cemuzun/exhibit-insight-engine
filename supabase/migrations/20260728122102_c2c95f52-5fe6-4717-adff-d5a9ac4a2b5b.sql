CREATE TABLE public.digest_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Lead digest',
  recipient_email text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  days_of_week smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  hour_of_day smallint NOT NULL DEFAULT 8,
  timezone text NOT NULL DEFAULT 'UTC',
  min_lead_score integer NOT NULL DEFAULT 60,
  only_tier_1 boolean NOT NULL DEFAULT false,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.digest_schedules TO authenticated;
GRANT ALL ON public.digest_schedules TO service_role;

ALTER TABLE public.digest_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "digests owner select" ON public.digest_schedules FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "digests owner insert" ON public.digest_schedules FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "digests owner update" ON public.digest_schedules FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "digests owner delete" ON public.digest_schedules FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX digest_schedules_enabled_idx ON public.digest_schedules (enabled, hour_of_day);