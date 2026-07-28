import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ScheduleInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120).default("Lead digest"),
  recipient_email: z.string().email(),
  enabled: z.boolean().default(true),
  days_of_week: z.array(z.number().int().min(0).max(6)).min(1),
  hour_of_day: z.number().int().min(0).max(23),
  timezone: z.string().min(1).max(64).default("UTC"),
  min_lead_score: z.number().int().min(0).max(100).default(60),
  only_tier_1: z.boolean().default(false),
});

export const listDigestSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("digest_schedules")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveDigestSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ScheduleInput.parse(input))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      name: data.name,
      recipient_email: data.recipient_email.trim().toLowerCase(),
      enabled: data.enabled,
      days_of_week: data.days_of_week,
      hour_of_day: data.hour_of_day,
      timezone: data.timezone,
      min_lead_score: data.min_lead_score,
      only_tier_1: data.only_tier_1,
      updated_at: new Date().toISOString(),
    };

    const saved = data.id
      ? await context.supabase
          .from("digest_schedules")
          .update(row)
          .eq("id", data.id)
          .select("*")
          .single()
      : await context.supabase.from("digest_schedules").insert(row).select("*").single();

    if (saved.error) throw new Error(saved.error.message);
    return saved.data;
  });

export const deleteDigestSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("digest_schedules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Preview: which qualified leads would be included in the next digest. */
export const previewDigest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: schedule, error: sErr } = await context.supabase
      .from("digest_schedules")
      .select("*")
      .eq("id", data.id)
      .single();
    if (sErr) throw new Error(sErr.message);

    const since =
      schedule.last_sent_at ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    let q = context.supabase
      .from("leads")
      .select(
        "id, run_id, company_name, trade_show, booth_number, lead_score, priority_tier, recommended_next_action, created_at",
      )
      .gte("created_at", since)
      .gte("lead_score", schedule.min_lead_score)
      .order("lead_score", { ascending: false })
      .limit(50);

    if (schedule.only_tier_1) q = q.eq("priority_tier", "TIER_1_IMMEDIATE");

    const { data: leads, error } = await q;
    if (error) throw new Error(error.message);
    return { since, leads: leads ?? [] };
  });
