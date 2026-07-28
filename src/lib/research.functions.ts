import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const CreateInput = z.object({
  inputUrl: z.string().url(),
  inputSourceType: z.enum(["directory", "event", "exhibitor_list"]).default("directory"),
  targetMarket: z.string().max(200).nullable().optional(),
  minProjectValue: z.number().int().min(0).max(10_000_000).nullable().optional(),
  maxLeadsPerShow: z.number().int().min(1).max(30).default(10),
  startDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  startDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  maxEvents: z.number().int().min(1).max(2000).default(500),
  maxDirectoryPages: z.number().int().min(1).max(50).default(25),
  maxDeepDiveShows: z.number().int().min(1).max(25).default(4),
  minLeadTimeDays: z.number().int().min(0).max(365).default(45),
  priorityIndustries: z.array(z.string().max(100)).max(20).default([]),
  targetServices: z.array(z.string().max(100)).max(20).default([]),
});

export const createResearchRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("research_runs")
      .insert({
        user_id: context.userId,
        input_url: data.inputUrl,
        input_source_type: data.inputSourceType,
        target_market: data.targetMarket ?? null,
        filters: {
          minProjectValue: data.minProjectValue ?? null,
          maxLeadsPerShow: data.maxLeadsPerShow,
          startDateFrom: data.startDateFrom ?? null,
          startDateTo: data.startDateTo ?? null,
          maxEvents: data.maxEvents,
          maxDirectoryPages: data.maxDirectoryPages,
          maxDeepDiveShows: data.maxDeepDiveShows,
          minLeadTimeDays: data.minLeadTimeDays,
          priorityIndustries: data.priorityIndustries,
          targetServices: data.targetServices,
        },
        status: "queued",
        stage: "queued",
        progress_message: "Waiting to start",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const runResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // Verify ownership
    const { data: run, error } = await context.supabase
      .from("research_runs")
      .select("*")
      .eq("id", data.runId)
      .maybeSingle();
    if (error || !run) throw new Error("Run not found");
    if (run.status === "complete") return { ok: true, alreadyComplete: true };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runPipeline } = await import("./pipeline.server");

    try {
      await runPipeline(
        data.runId,
        {
          inputUrl: run.input_url,
          targetMarket: run.target_market,
          filters: (run.filters ?? {}) as {
            minProjectValue?: number;
            maxLeadsPerShow?: number;
            startDateFrom?: string | null;
            startDateTo?: string | null;
            maxEvents?: number;
            maxDirectoryPages?: number;
            maxDeepDiveShows?: number;
            minLeadTimeDays?: number;
            priorityIndustries?: string[];
            targetServices?: string[];
          },
        },
        supabaseAdmin,
      );
    } catch (e) {
      await supabaseAdmin
        .from("research_runs")
        .update({ status: "failed", error_message: (e as Error).message })
        .eq("id", data.runId);
      const { notifyRunFailure } = await import("./notifications.server");
      await notifyRunFailure(supabaseAdmin, {
        runId: data.runId,
        userId: context.userId,
        errorMessage: (e as Error).message,
      });
      throw e;
    }
    return { ok: true };
  });

export const rerunResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase
      .from("research_runs")
      .select("*")
      .eq("id", data.runId)
      .maybeSingle();
    if (error || !run) throw new Error("Run not found");

    // Clear prior results and reset the run before re-running the pipeline.
    await context.supabase.from("leads").delete().eq("run_id", data.runId);
    await context.supabase.from("events").delete().eq("run_id", data.runId);
    const { error: resetErr } = await context.supabase
      .from("research_runs")
      .update({
        status: "queued",
        stage: "queued",
        progress_message: "Re-running research",
        error_message: null,
        executive_summary: null,
        step_log: [],
        completed_at: null,
      })
      .eq("id", data.runId);
    if (resetErr) throw new Error(resetErr.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runPipeline } = await import("./pipeline.server");

    try {
      await runPipeline(
        data.runId,
        {
          inputUrl: run.input_url,
          targetMarket: run.target_market,
          filters: (run.filters ?? {}) as {
            minProjectValue?: number;
            maxLeadsPerShow?: number;
            startDateFrom?: string | null;
            startDateTo?: string | null;
            maxEvents?: number;
            maxDirectoryPages?: number;
            maxDeepDiveShows?: number;
            minLeadTimeDays?: number;
            priorityIndustries?: string[];
            targetServices?: string[];
          },
        },
        supabaseAdmin,
      );
    } catch (e) {
      await supabaseAdmin
        .from("research_runs")
        .update({ status: "failed", error_message: (e as Error).message })
        .eq("id", data.runId);
      const { notifyRunFailure } = await import("./notifications.server");
      await notifyRunFailure(supabaseAdmin, {
        runId: data.runId,
        userId: context.userId,
        errorMessage: (e as Error).message,
      });
      throw e;
    }
    return { ok: true };
  });

/**
 * A run executes inside one long-lived server request. If that server process is
 * recycled mid-run the pipeline just stops — no error, no further progress. This
 * restarts a run whose heartbeat has gone quiet; cached scrapes make the replay
 * cheap. Capped so a genuinely broken run still fails instead of looping.
 */
const RESUME_AFTER_MS = 100 * 1000;
const MAX_RESUMES = 3;

export const resumeStalledRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase
      .from("research_runs")
      .select("*")
      .eq("id", data.runId)
      .maybeSingle();
    if (error || !run) return { resumed: false, reason: "not_found" as const };
    if (run.status === "complete" || run.status === "failed") {
      return { resumed: false, reason: "finished" as const };
    }
    const quietFor = Date.now() - new Date(run.updated_at as string).getTime();
    if (quietFor < RESUME_AFTER_MS) return { resumed: false, reason: "still_working" as const };

    const counters = (run.counters ?? {}) as Record<string, number>;
    const resumes = Number(counters.resumes ?? 0);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (resumes >= MAX_RESUMES) {
      const message =
        "Run kept stopping after restarts — the source is likely too large or the scrape provider is rate limiting. Try fewer directory pages or fewer deep-dive shows.";
      await supabaseAdmin
        .from("research_runs")
        .update({ status: "failed", error_message: message })
        .eq("id", data.runId);
      const { notifyRunFailure } = await import("./notifications.server");
      await notifyRunFailure(supabaseAdmin, {
        runId: data.runId,
        userId: context.userId,
        errorMessage: message,
      });
      return { resumed: false, reason: "gave_up" as const };
    }

    await supabaseAdmin
      .from("research_runs")
      .update({
        counters: { ...counters, resumes: resumes + 1 },
        progress_message: `Restarting after an interrupted step (attempt ${resumes + 2})`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.runId);

    // The pipeline replays from the start, so drop partial results first.
    await supabaseAdmin.from("leads").delete().eq("run_id", data.runId);
    await supabaseAdmin.from("events").delete().eq("run_id", data.runId);

    const { runPipeline } = await import("./pipeline.server");
    try {
      await runPipeline(
        data.runId,
        {
          inputUrl: run.input_url,
          targetMarket: run.target_market,
          filters: (run.filters ?? {}) as {
            minProjectValue?: number;
            maxLeadsPerShow?: number;
            startDateFrom?: string | null;
            startDateTo?: string | null;
            maxEvents?: number;
            maxDirectoryPages?: number;
            maxDeepDiveShows?: number;
            minLeadTimeDays?: number;
            priorityIndustries?: string[];
            targetServices?: string[];
          },
        },
        supabaseAdmin,
      );
    } catch (e) {
      await supabaseAdmin
        .from("research_runs")
        .update({ status: "failed", error_message: (e as Error).message })
        .eq("id", data.runId);
      const { notifyRunFailure } = await import("./notifications.server");
      await notifyRunFailure(supabaseAdmin, {
        runId: data.runId,
        userId: context.userId,
        errorMessage: (e as Error).message,
      });
      return { resumed: false, reason: "failed" as const };
    }
    return { resumed: true as const };
  });

/** Runs with no progress update for this long are considered dead. */
const STALL_MS = 5 * 60 * 1000;


async function failStalledRuns(supabase: {
  from: (t: string) => any;
}): Promise<void> {
  const cutoff = new Date(Date.now() - STALL_MS).toISOString();
  const stallMessage =
    "Run stalled — no progress for over 5 minutes. The scrape or model call likely timed out. Use Re-run to try again.";
  const { data: stalled } = await supabase
    .from("research_runs")
    .update({ status: "failed", error_message: stallMessage })
    .not("status", "in", "(complete,failed)")
    .lt("updated_at", cutoff)
    .select("id, user_id");

  // Alert the owner of each run we just auto-failed.
  if (Array.isArray(stalled) && stalled.length > 0) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { notifyRunFailure } = await import("./notifications.server");
      for (const run of stalled as { id: string; user_id: string }[]) {
        await notifyRunFailure(supabaseAdmin, {
          runId: run.id,
          userId: run.user_id,
          errorMessage: stallMessage,
        });
      }
    } catch {
      // non-fatal
    }
  }
}


export const listRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await failStalledRuns(context.supabase);
    const { data, error } = await context.supabase
      .from("research_runs")
      .select("id, input_url, status, stage, progress_message, created_at, completed_at, executive_summary")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await failStalledRuns(context.supabase);
    const [{ data: run, error: runErr }, { data: events }, { data: leads }] = await Promise.all([
      context.supabase.from("research_runs").select("*").eq("id", data.runId).maybeSingle(),
      context.supabase.from("events").select("*").eq("run_id", data.runId).order("event_opportunity_score", { ascending: false }),
      context.supabase.from("leads").select("*").eq("run_id", data.runId).order("lead_score", { ascending: false }),
    ]);
    if (runErr) throw new Error(runErr.message);
    if (!run) return { run: null, events: [], leads: [] };
    return { run, events: events ?? [], leads: leads ?? [] };
  });

export const deleteRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("research_runs").delete().eq("id", data.runId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
