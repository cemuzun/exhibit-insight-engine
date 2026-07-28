import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const TemplateInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  industry: z.string().max(120).nullable().optional(),
  trade_show: z.string().max(200).nullable().optional(),
  min_evidence_level: z.enum(["ANY", "ESTIMATED", "INFERRED", "VERIFIED"]).default("ANY"),
  min_lead_score: z.number().int().min(0).max(100).default(0),
  subject_template: z.string().max(500).default(""),
  body_template: z.string().max(20000).default(""),
  is_default: z.boolean().default(false),
});

export const listEmailTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("email_templates")
      .select("*")
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TemplateInput.parse(input))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      name: data.name,
      industry: data.industry?.trim() || null,
      trade_show: data.trade_show?.trim() || null,
      min_evidence_level: data.min_evidence_level,
      min_lead_score: data.min_lead_score,
      subject_template: data.subject_template,
      body_template: data.body_template,
      is_default: data.is_default,
      updated_at: new Date().toISOString(),
    };

    const saved = data.id
      ? await context.supabase.from("email_templates").update(row).eq("id", data.id).select("*").single()
      : await context.supabase.from("email_templates").insert(row).select("*").single();

    if (saved.error) throw new Error(saved.error.message);

    // Only one default template per user.
    if (data.is_default) {
      await context.supabase
        .from("email_templates")
        .update({ is_default: false })
        .eq("user_id", context.userId)
        .neq("id", saved.data.id);
    }
    return saved.data;
  });

export const deleteEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("email_templates").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
