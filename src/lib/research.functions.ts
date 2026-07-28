import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const CreateInput = z.object({
  inputUrl: z.string().url(),
  inputSourceType: z.enum(["directory", "event", "exhibitor_list"]).default("directory"),
  targetMarket: z.string().max(200).nullable().optional(),
  minProjectValue: z.number().int().min(0).max(10_000_000).nullable().optional(),
  maxLeadsPerShow: z.number().int().min(1).max(30).default(10),
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
      .single();
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
      throw e;
    }
    return { ok: true };
  });

export const listRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
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
    const [{ data: run, error: runErr }, { data: events }, { data: leads }] = await Promise.all([
      context.supabase.from("research_runs").select("*").eq("id", data.runId).single(),
      context.supabase.from("events").select("*").eq("run_id", data.runId).order("event_opportunity_score", { ascending: false }),
      context.supabase.from("leads").select("*").eq("run_id", data.runId).order("lead_score", { ascending: false }),
    ]);
    if (runErr) throw new Error(runErr.message);
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
