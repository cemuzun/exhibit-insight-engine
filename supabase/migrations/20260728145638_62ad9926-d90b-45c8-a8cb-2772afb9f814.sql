ALTER TABLE public.events REPLICA IDENTITY FULL;
ALTER TABLE public.leads REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.events; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.leads; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;