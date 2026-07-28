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
  try {
    // App emails require a verified sender domain + scaffolded templates.
    // Until those exist this resolves to "skipped" and only the in-app alert fires.
    const mod = await import("@/lib/email-templates/send-email").catch(() => null);
    const send = (mod as { sendTemplateEmail?: Function } | null)?.sendTemplateEmail;
    if (typeof send !== "function") return "skipped";

    const { data: user } = await admin.auth.admin.getUserById(info.userId);
    const email = user?.user?.email;
    if (!email) return "skipped";

    const res = await send("run-failed", email, {
      templateData: {
        inputUrl: info.inputUrl,
        lastStep: info.stepLabel,
        lastStepMessage: info.stepMessage,
        errorMessage: info.errorMessage,
        runId: info.runId,
      },
      idempotencyKey: `run-failed-${info.runId}-${Date.now()}`,
    });
    return res?.sent ? "sent" : "skipped";
  } catch {
    return "failed";
  }
}
