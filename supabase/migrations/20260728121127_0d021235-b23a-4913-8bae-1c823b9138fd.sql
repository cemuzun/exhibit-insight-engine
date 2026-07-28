ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS crm_status text NOT NULL DEFAULT 'not_synced',
  ADD COLUMN IF NOT EXISTS crm_company_id text,
  ADD COLUMN IF NOT EXISTS crm_contact_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS crm_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS crm_error text;