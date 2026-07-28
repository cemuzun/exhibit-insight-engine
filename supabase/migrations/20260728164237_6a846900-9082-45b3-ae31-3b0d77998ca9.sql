ALTER TABLE public.outreach_emails
  ADD COLUMN IF NOT EXISTS suppression_reason text,
  ADD COLUMN IF NOT EXISTS suppressed_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS outreach_emails_recipient_email_idx
  ON public.outreach_emails (lower(recipient_email));