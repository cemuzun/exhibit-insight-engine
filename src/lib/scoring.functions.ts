import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { DEFAULT_SCORING, SCORE_COMPONENTS, normalizeScoringSettings } from "./scoring";

const WeightsSchema = z.record(z.string(), z.number().min(0).max(100));

const SettingsInput = z.object({
  weights: WeightsSchema,
  tier1_min: z.number().int().min(0).max(100),
  tier2_min: z.number().int().min(0).max(100),
  tier3_min: z.number().int().min(0).max(100),
  qualified_min: z.number().int().min(0).max(100),
  tier1_requires_verified_contact: z.boolean(),
});

export const getScoringSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("scoring_settings")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return normalizeScoringSettings(data ?? DEFAULT_SCORING);
  });

export const saveScoringSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SettingsInput.parse(input))
  .handler(async ({ data, context }) => {
    const weights: Record<string, number> = {};
    for (const c of SCORE_COMPONENTS) {
      const v = Number(data.weights[c.key]);
      weights[c.key] = Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : c.defaultMax;
    }
    const { data: saved, error } = await context.supabase
      .from("scoring_settings")
      .upsert(
        {
          user_id: context.userId,
          weights,
          tier1_min: data.tier1_min,
          tier2_min: data.tier2_min,
          tier3_min: data.tier3_min,
          qualified_min: data.qualified_min,
          tier1_requires_verified_contact: data.tier1_requires_verified_contact,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return normalizeScoringSettings(saved);
  });

export const resetScoringSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("scoring_settings")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return DEFAULT_SCORING;
  });
