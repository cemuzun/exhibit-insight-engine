/**
 * Server-only outreach sending boundary.
 *
 * Real delivery requires a verified sender domain for this project. Until that
 * is configured, `senderReady()` reports why so the UI can explain it instead
 * of the queue silently doing nothing.
 */

export type SenderStatus = { ready: true } | { ready: false; reason: "sender_not_configured" };

export async function senderReady(): Promise<SenderStatus> {
  return { ready: false, reason: "sender_not_configured" };
}

export async function sendOutreachEmail(_args: {
  to: string;
  subject: string;
  body: string;
  idempotencyKey: string;
}): Promise<{ sent: boolean }> {
  throw new Error("Email sending is not configured for this project yet.");
}
