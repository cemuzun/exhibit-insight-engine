// Single source of truth for the runtime packages this app requires beyond
// framework defaults. Consumed by scripts/preflight.mjs and
// scripts/install-required.sh.
export const REQUIRED = [
  "ai",
  "@ai-sdk/openai-compatible",
  "zod",
  "@supabase/supabase-js",
  "lucide-react",
  "sonner",
  "recharts",
  "date-fns",
  "react-hook-form",
  "@hookform/resolvers",
];

export default REQUIRED;
