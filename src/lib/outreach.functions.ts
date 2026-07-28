import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  renderForLead,
  type EmailTemplate,
  type TemplateLead,
  type TemplateDecisionMaker,
} from "./email-template-engine";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type OutreachEmailRow = {
  id: string;
  run_id: string;
  lead_id: string;
  company_name: string;
  recipient_name: string | null;
  recipient_title: string | null;
  recipient_email: string;
  subject: string;
  body: string;
  template_name: string | null;
  lead_score: number;
  priority_tier: string | null;
  status: string;
  error: string | null;
  sent_at: string | null;
};

/**
 * Turn a run's qualified leads into one draft email per decision maker that has
 * a public business email. Existing drafts are left untouched so edits and
 * approvals survive a rebuild.
 */
export const buildOutreachQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        runId: z.string().uuid(),
        minScore: z.number().int().min(0).max(100).default(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: leads, error } = await supabase
      .from("leads")
      .select("*")
      .eq("run_id", data.runId)
      .gte("lead_score", data.minScore);
    if (error) throw new Error(error.message);

    const { data: templates } = await supabase
      .from("email_templates")
      .select("*")
      .eq("user_id", userId);

    const { data: existing } = await supabase
      .from("outreach_emails")
      .select("lead_id, recipient_email")
      .eq("run_id", data.runId);
    const seen = new Set(
      (existing ?? []).map((r) => `${r.lead_id}::${(r.recipient_email ?? "").toLowerCase()}`),
    );

    const rows: Array<Record<string, unknown>> = [];
    let noContact = 0;

    for (const lead of leads ?? []) {
      const dms = (lead.decision_makers ?? []) as TemplateDecisionMaker[];
      const contacts = dms.filter((dm) =>
        EMAIL_RE.test((dm.public_business_email ?? "").trim()),
      );
      if (!contacts.length) {
        noContact += 1;
        continue;
      }

      for (const dm of contacts) {
        const email = (dm.public_business_email ?? "").trim().toLowerCase();
        if (seen.has(`${lead.id}::${email}`)) continue;
        seen.add(`${lead.id}::${email}`);

        const templateLead: TemplateLead = { ...(lead as unknown as TemplateLead), decision_makers: [dm] };
        const rendered = renderForLead((templates ?? []) as EmailTemplate[], templateLead);

        rows.push({
          user_id: userId,
          run_id: data.runId,
          lead_id: lead.id,
          company_name: lead.company_name,
          recipient_name: dm.name ?? null,
          recipient_title: dm.title ?? null,
          recipient_email: email,
          subject: rendered?.subject || `Booth support for ${lead.company_name} at ${lead.trade_show ?? "your next show"}`,
          body: rendered?.body || lead.personalized_email || "",
          template_name: rendered?.template.name ?? null,
          lead_score: lead.lead_score ?? 0,
          priority_tier: lead.priority_tier ?? null,
          status: "draft",
        });
      }
    }

    if (rows.length) {
      const { error: insertError } = await supabase.from("outreach_emails").insert(rows);
      if (insertError) throw new Error(insertError.message);
    }

    return {
      created: rows.length,
      leadsConsidered: leads?.length ?? 0,
      leadsWithoutContact: noContact,
    };
  });

export const listOutreach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("outreach_emails")
      .select("*")
      .eq("run_id", data.runId)
      .order("lead_score", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (rows ?? []) as OutreachEmailRow[];
  });

export const updateOutreachDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        subject: z.string().max(300).optional(),
        body: z.string().max(20_000).optional(),
        status: z.enum(["draft", "approved"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.subject !== undefined) patch.subject = data.subject;
    if (data.body !== undefined) patch.body = data.body;
    if (data.status !== undefined) patch.status = data.status;

    const { error } = await context.supabase
      .from("outreach_emails")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setOutreachStatusBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(500),
        status: z.enum(["draft", "approved"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("outreach_emails")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .in("id", data.ids)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { updated: data.ids.length };
  });

/**
 * Send approved drafts. Sending goes through the project's own verified sender
 * domain; until that is configured the call reports back instead of failing
 * silently.
 */
export const sendApprovedOutreach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ runId: z.string().uuid(), ids: z.array(z.string().uuid()).max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("outreach_emails")
      .select("*")
      .eq("run_id", data.runId)
      .eq("status", "approved");
    if (data.ids?.length) query = query.in("id", data.ids);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    if (!rows?.length) return { sent: 0, failed: 0, pending: 0, reason: "nothing_approved" as const };

    const sender = await import("./outreach-send.server");
    const ready = await sender.senderReady();
    if (!ready.ready) {
      return { sent: 0, failed: 0, pending: rows.length, reason: ready.reason };
    }

    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await sender.sendOutreachEmail({
          to: row.recipient_email,
          subject: row.subject,
          body: row.body,
          idempotencyKey: `outreach-${row.id}`,
        });
        await context.supabase
          .from("outreach_emails")
          .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
          .eq("id", row.id);
        sent += 1;
      } catch (e) {
        failed += 1;
        await context.supabase
          .from("outreach_emails")
          .update({ status: "failed", error: (e as Error).message })
          .eq("id", row.id);
      }
    }
    return { sent, failed, pending: 0, reason: "ok" as const };
  });
