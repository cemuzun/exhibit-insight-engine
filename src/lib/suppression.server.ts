/**
 * Server-only recipient health bookkeeping.
 *
 * Lovable enforces suppression at send time; this module only keeps a local,
 * convenience copy so the outreach dashboard can show why a draft will not go
 * out and so obviously-dead recipients are skipped before we even try.
 */

export type SuppressionReason =
  | "bounced"
  | "complained"
  | "unsubscribed"
  | "recipient_suppressed"
  | "invalid_recipient";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const ROLE_PREFIXES = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "postmaster",
  "mailer-daemon",
  "abuse",
]);

/** Cheap, local validity check — format plus obviously undeliverable mailboxes. */
export function isDeliverableAddress(raw: string | null | undefined): boolean {
  const email = (raw ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return false;
  const local = email.split("@")[0];
  if (ROLE_PREFIXES.has(local)) return false;
  if (email.endsWith(".invalid") || email.endsWith(".test") || email.endsWith("example.com")) return false;
  return true;
}

type MinimalClient = {
  from: (table: string) => {
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: string) => {
        in: (col: string, vals: string[]) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
};

/**
 * Mark every not-yet-sent draft for a recipient as suppressed. Idempotent, so
 * webhook redeliveries are harmless.
 */
export async function markRecipientSuppressed(
  client: MinimalClient,
  recipient: string,
  reason: SuppressionReason,
): Promise<void> {
  const email = recipient.trim().toLowerCase();
  if (!email) return;
  const { error } = await client
    .from("outreach_emails")
    .update({
      status: "suppressed",
      suppression_reason: reason,
      suppressed_at: new Date().toISOString(),
      error: `Recipient ${reason.replace(/_/g, " ")}`,
    })
    .eq("recipient_email", email)
    .in("status", ["draft", "approved", "failed"]);
  if (error) throw new Error(error.message);
}

/** Clear a local suppression mark after a resubscribe event. */
export async function clearRecipientSuppression(client: MinimalClient, recipient: string): Promise<void> {
  const email = recipient.trim().toLowerCase();
  if (!email) return;
  const { error } = await client
    .from("outreach_emails")
    .update({ status: "draft", suppression_reason: null, suppressed_at: null, error: null })
    .eq("recipient_email", email)
    .in("status", ["suppressed"]);
  if (error) throw new Error(error.message);
}
