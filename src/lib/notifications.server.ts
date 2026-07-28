import type { SupabaseClient } from "@supabase/supabase-js";

type StepEntry = {
  key?: string;
  started_at?: string;
  ended_at?: string | null;
  duration_ms?: number | null;
  message?: string | null;
};

const STEP_LABELS: Record<string, string> = {
  queued: "Queued",
  scrape_source: "Fetching source page",
  extract_events: "Identifying trade shows",
  scrape_event: "Fetching event pages",
  extract_exhibitors: "Extracting exhibitors",
  enrich_leads: "Enriching & scoring leads",
  summary: "Executive summary",
  complete: "Complete",
};

export function stepLabel(key?: string | null): string {
  if (!key) return "Unknown step";
  return STEP_LABELS[key] ?? key.replace(/_/g, " ");
}

/** The last step that finished, else the step that was in-flight when it broke. */
export function lastCompletedStep(stepLog: unknown): { key: string | null; message: string | null } {
  const steps = Array.isArray(stepLog) ? (stepLog as StepEntry[]) : [];
  const finished = [...steps].reverse().find((s) => s.ended_at);
  const chosen = finished ?? steps[steps.length - 1];
  return { key: chosen?.key ?? null, message: chosen?.message ?? null };
}
/** Look up who owns a run (notifications are always addressed to the owner). */
export async function runOwner(
  admin: SupabaseClient,
  runId: string,
): Promise<{ userId: string | null; inputUrl: string | null }> {
  const { data } = await admin
    .from("research_runs")
    .select("user_id, input_url")
    .eq("id", runId)
    .maybeSingle();
  return { userId: data?.user_id ?? null, inputUrl: data?.input_url ?? null };
}

/** Qualified-lead counts that are worth interrupting the user for. */
export const LEAD_MILESTONES = [5, 10, 25, 50, 100, 200, 500];

/** Highest milestone crossed when the qualified count moves from → to. */
export function crossedMilestone(from: number, to: number): number | null {
  const crossed = LEAD_MILESTONES.filter((m) => from < m && to >= m);
  return crossed.length ? crossed[crossed.length - 1] : null;
}

/** Run finished successfully. */
export async function notifyRunComplete(
  admin: SupabaseClient,
  params: {
    runId: string;
    userId: string;
    inputUrl: string;
    leads: number;
    qualified: number;
    tier1: number;
    shows: number;
  },
): Promise<void> {
  try {
    const body = `${params.inputUrl} finished — ${params.shows} shows reviewed, ${params.leads} leads scored, ${params.qualified} qualified (${params.tier1} Tier 1).`;
    const emailStatus = await sendAlertEmail();
    await admin.from("notifications").insert({
      user_id: params.userId,
      type: "run_complete",
      title: "Research run complete",
      body,
      run_id: params.runId,
      last_step: "complete",
      last_step_message: null,
      email_status: emailStatus,
    });
  } catch {
    // never break the pipeline over a notification
  }
}

/** Qualified-lead count crossed a milestone while the run is still working. */
export async function notifyLeadMilestone(
  admin: SupabaseClient,
  params: { runId: string; userId: string; inputUrl: string; milestone: number; qualified: number },
): Promise<void> {
  try {
    const emailStatus = await sendAlertEmail();
    await admin.from("notifications").insert({
      user_id: params.userId,
      type: "lead_milestone",
      title: `${params.milestone}+ qualified leads found`,
      body: `${params.inputUrl} has produced ${params.qualified} qualified leads (score 65+) so far — the run is still working.`,
      run_id: params.runId,
      last_step: "enrich_leads",
      last_step_message: null,
      email_status: emailStatus,
    });
  } catch {
    // non-fatal
  }
}

/**
 * Email delivery for alerts. Requires a verified sender domain + app email
 * templates; until those exist alerts are recorded in-app only.
 */
async function sendAlertEmail(): Promise<"sent" | "skipped" | "failed"> {
  return "skipped";
}


/**
 * Record a run failure: writes an in-app notification and (when app emails are
 * configured for the project) sends an email alert to the run's owner.
 */
export async function notifyRunFailure(
  admin: SupabaseClient,
  params: { runId: string; userId: string; errorMessage: string },
): Promise<void> {
  try {
    const { data: run } = await admin
      .from("research_runs")
      .select("input_url, step_log")
      .eq("id", params.runId)
      .maybeSingle();

    const last = lastCompletedStep(run?.step_log);
    const label = stepLabel(last.key);
    const title = "Research run failed";
    const body = `${run?.input_url ?? "Run"} failed after "${label}"${
      last.message ? ` (${last.message})` : ""
    }. Error: ${params.errorMessage}`;

    const emailStatus = await sendFailureEmail(admin, {
      userId: params.userId,
      runId: params.runId,
      inputUrl: run?.input_url ?? "",
      stepLabel: label,
      stepMessage: last.message,
      errorMessage: params.errorMessage,
    });

    await admin.from("notifications").insert({
      user_id: params.userId,
      type: "run_failed",
      title,
      body,
      run_id: params.runId,
      last_step: last.key,
      last_step_message: last.message,
      email_status: emailStatus,
    });
  } catch {
    // notifications must never mask the original failure
  }
}

async function sendFailureEmail(
  admin: SupabaseClient,
  info: {
    userId: string;
    runId: string;
    inputUrl: string;
    stepLabel: string;
    stepMessage: string | null;
    errorMessage: string;
  },
): Promise<"sent" | "skipped" | "failed"> {
  // Email alerts require a verified sender domain + scaffolded app-email
  // templates. Until those exist we record the alert in-app only.
  void admin;
  void info;
  return "skipped";
}
