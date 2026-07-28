CREATE TABLE IF NOT EXISTS public.scoring_settings (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  weights JSONB NOT NULL DEFAULT '{}'::jsonb,
  tier1_min INTEGER NOT NULL DEFAULT 80,
  tier2_min INTEGER NOT NULL DEFAULT 65,
  tier3_min INTEGER NOT NULL DEFAULT 50,
  qualified_min INTEGER NOT NULL DEFAULT 65,
  tier1_requires_verified_contact BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scoring_settings TO authenticated;
GRANT ALL ON public.scoring_settings TO service_role;
ALTER TABLE public.scoring_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own scoring settings" ON public.scoring_settings;
CREATE POLICY "Users manage their own scoring settings" ON public.scoring_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);