/**
 * Server-only outreach sending boundary.
 *
 * Real delivery requires a verified sender domain for this project. Until that
 * is configured, `senderReady()` reports why so the UI can explain it instead
 * of the queue silently doing nothing.
 *
 * Suppression (bounces, complaints, unsubscribes) is enforced at send time by
 * the platform; a blocked recipient resolves `{ sent: false, reason }` rather
 * than throwing, so callers can record it as skipped instead of failed.
 */

export type SenderStatus = { ready: true } | { ready: false; reason: "sender_not_configured" };

export type SendResult = { sent: true; reason?: undefined } | { sent: false; reason: string };

export async function senderReady(): Promise<SenderStatus> {
  return { ready: false, reason: "sender_not_configured" };
}

export async function sendOutreachEmail(_args: {
  to: string;
  subject: string;
  body: string;
  idempotencyKey: string;
}): Promise<SendResult> {
  throw new Error("Email sending is not configured for this project yet.");
}
