CREATE TABLE public.firecrawl_cache (
  cache_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  request JSONB NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX firecrawl_cache_expires_idx ON public.firecrawl_cache (expires_at);
GRANT ALL ON public.firecrawl_cache TO service_role;
ALTER TABLE public.firecrawl_cache ENABLE ROW LEVEL SECURITY;