// Single source of truth for runtime environment variables required by the
// BoothLens app. Consumed by scripts/preflight.mjs.
export const REQUIRED_ENV = [
  {
    name: "SUPABASE_URL",
    description: "Supabase project URL (e.g. https://<project>.supabase.co)",
    required: true,
  },
  {
    name: "SUPABASE_PUBLISHABLE_KEY",
    description: "Supabase publishable/anon key for authenticated client access",
    required: true,
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    description: "Supabase service role key for privileged server operations",
    required: true,
  },
  {
    name: "LOVABLE_API_KEY",
    description: "Lovable AI Gateway / connector gateway key",
    required: true,
  },
  {
    name: "FIRECRAWL_API_KEY",
    description: "Firecrawl API key for scraping trade show directories",
    required: true,
  },
  {
    name: "HUBSPOT_API_KEY",
    description: "HubSpot private app token (optional, only needed for CRM sync)",
    required: false,
  },
];

export default REQUIRED_ENV;
