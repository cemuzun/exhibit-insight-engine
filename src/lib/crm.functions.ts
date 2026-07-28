import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SyncInput = z.object({
  runId: z.string().uuid(),
  leadIds: z.array(z.string().uuid()).max(500).optional(),
  minScore: z.number().int().min(0).max(100).default(50),
});

type DecisionMaker = {
  name?: string | null;
  title?: string | null;
  public_business_email?: string | null;
  evidence_status?: string | null;
  professional_profile_url?: string | null;
};

function isVerified(status: string | null | undefined) {
  const s = (status ?? "").toLowerCase();
  return s.includes("verified") || s.includes("confirmed");
}

export const syncRunToCrm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SyncInput.parse(input))
  .handler(async ({ data, context }) => {
    const {
      domainFromUrl,
      isValidEmail,
      findCompanyByDomain,
      findContactByEmail,
      createCompany,
      createContact,
      associateContactToCompany,
    } = await import("./hubspot.server");

    // RLS scopes this to the caller's own run.
    let query = context.supabase.from("leads").select("*").eq("run_id", data.runId);
    if (data.leadIds?.length) query = query.in("id", data.leadIds);
    const { data: leads, error } = await query;
    if (error) throw new Error(error.message);
    if (!leads?.length) return { companiesCreated: 0, contactsCreated: 0, skipped: 0, failed: 0, processed: 0 };

    const qualified = leads.filter(
      (l) => (data.leadIds?.length ? true : (l.lead_score ?? 0) >= data.minScore),
    );

    let companiesCreated = 0;
    let contactsCreated = 0;
    let skipped = 0;
    let failed = 0;

    // In-run dedupe caches so the same domain/email is only pushed once.
    const domainCache = new Map<string, string>();
    const emailCache = new Map<string, string>();

    for (const lead of qualified) {
      try {
        const domain = domainFromUrl(lead.company_website);
        if (!domain) {
          // No verified domain -> cannot dedupe reliably; do not push.
          skipped++;
          await context.supabase
            .from("leads")
            .update({ crm_status: "skipped", crm_error: "No verified company domain" })
            .eq("id", lead.id);
          continue;
        }

        let companyId = domainCache.get(domain) ?? (await findCompanyByDomain(domain));
        let companyExisted = true;
        if (!companyId) {
          companyExisted = false;
          const props: Record<string, string> = {
            name: lead.company_name,
            domain,
          };
          if (lead.company_website) props.website = lead.company_website;
          if (lead.industry) props.description = `Industry: ${lead.industry}`;
          companyId = await createCompany(props);
          companiesCreated++;
        }
        domainCache.set(domain, companyId);

        const dms = (lead.decision_makers ?? []) as DecisionMaker[];
        const contactIds: string[] = [];
        for (const dm of dms) {
          const email = dm.public_business_email?.trim().toLowerCase();
          // Verified fields only: needs a valid, evidence-backed business email.
          if (!isValidEmail(email) || !isVerified(dm.evidence_status)) continue;

          const existing = emailCache.get(email) ?? (await findContactByEmail(email));
          if (existing) {
            skipped++;
            emailCache.set(email, existing);
            contactIds.push(existing);
            continue;
          }

          const props: Record<string, string> = { email };
          if (dm.name) {
            const parts = dm.name.trim().split(/\s+/);
            props.firstname = parts[0];
            if (parts.length > 1) props.lastname = parts.slice(1).join(" ");
          }
          if (dm.title) props.jobtitle = dm.title;
          if (dm.professional_profile_url) props.website = dm.professional_profile_url;
          props.company = lead.company_name;

          const contactId = await createContact(props);
          contactsCreated++;
          contactIds.push(contactId);
          await associateContactToCompany(contactId, companyId);
        }

        if (companyExisted && contactIds.length === 0) skipped++;

        await context.supabase
          .from("leads")
          .update({
            crm_status: "synced",
            crm_company_id: companyId,
            crm_contact_ids: contactIds,
            crm_synced_at: new Date().toISOString(),
            crm_error: null,
          })
          .eq("id", lead.id);
      } catch (e) {
        failed++;
        console.error("CRM sync failed for lead", lead.id, e);
        await context.supabase
          .from("leads")
          .update({ crm_status: "error", crm_error: (e as Error).message.slice(0, 500) })
          .eq("id", lead.id);
      }
    }

    return {
      processed: qualified.length,
      companiesCreated,
      contactsCreated,
      skipped,
      failed,
    };
  });

const PreviewInput = z.object({
  runId: z.string().uuid(),
  minScore: z.number().int().min(0).max(100).default(50),
});

export type CrmPreviewCompany = {
  leadId: string;
  companyName: string;
  domain: string | null;
  action: "insert" | "skip";
  reason: string;
  contacts: Array<{
    name: string | null;
    email: string | null;
    action: "insert" | "skip";
    reason: string;
  }>;
};

/** Read-only dry run: performs dedupe lookups in HubSpot but writes nothing. */
export const previewCrmSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PreviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const { domainFromUrl, isValidEmail, findCompanyByDomain, findContactByEmail } =
      await import("./hubspot.server");

    const { data: leads, error } = await context.supabase
      .from("leads")
      .select("*")
      .eq("run_id", data.runId);
    if (error) throw new Error(error.message);

    const qualified = (leads ?? []).filter((l) => (l.lead_score ?? 0) >= data.minScore);

    const domainCache = new Map<string, string | null>();
    const emailCache = new Map<string, string | null>();
    const seenDomains = new Set<string>();
    const seenEmails = new Set<string>();

    const rows: CrmPreviewCompany[] = [];

    for (const lead of qualified) {
      const domain = domainFromUrl(lead.company_website);
      const row: CrmPreviewCompany = {
        leadId: lead.id,
        companyName: lead.company_name,
        domain,
        action: "skip",
        reason: "",
        contacts: [],
      };

      if (!domain) {
        row.reason = "No verified company domain — cannot dedupe";
      } else if (seenDomains.has(domain)) {
        row.reason = `Duplicate domain within this run (${domain})`;
      } else {
        if (!domainCache.has(domain)) domainCache.set(domain, await findCompanyByDomain(domain));
        const existing = domainCache.get(domain);
        if (existing) {
          row.reason = `Company already in CRM for ${domain}`;
        } else {
          row.action = "insert";
          row.reason = `New company (${domain})`;
        }
        seenDomains.add(domain);
      }

      const dms = (lead.decision_makers ?? []) as DecisionMaker[];
      for (const dm of dms) {
        const email = dm.public_business_email?.trim().toLowerCase() ?? null;
        if (!isValidEmail(email)) {
          row.contacts.push({
            name: dm.name ?? null,
            email,
            action: "skip",
            reason: "No valid business email",
          });
          continue;
        }
        if (!isVerified(dm.evidence_status)) {
          row.contacts.push({
            name: dm.name ?? null,
            email,
            action: "skip",
            reason: "Contact not evidence-verified",
          });
          continue;
        }
        if (seenEmails.has(email)) {
          row.contacts.push({
            name: dm.name ?? null,
            email,
            action: "skip",
            reason: "Duplicate email within this run",
          });
          continue;
        }
        seenEmails.add(email);
        if (!emailCache.has(email)) emailCache.set(email, await findContactByEmail(email));
        if (emailCache.get(email)) {
          row.contacts.push({
            name: dm.name ?? null,
            email,
            action: "skip",
            reason: "Contact already in CRM",
          });
        } else {
          row.contacts.push({
            name: dm.name ?? null,
            email,
            action: "insert",
            reason: "New contact",
          });
        }
      }

      rows.push(row);
    }

    return {
      rows,
      totals: {
        leadsConsidered: qualified.length,
        companiesToInsert: rows.filter((r) => r.action === "insert").length,
        companiesSkipped: rows.filter((r) => r.action === "skip").length,
        contactsToInsert: rows.reduce(
          (n, r) => n + r.contacts.filter((c) => c.action === "insert").length,
          0,
        ),
        contactsSkipped: rows.reduce(
          (n, r) => n + r.contacts.filter((c) => c.action === "skip").length,
          0,
        ),
      },
    };
  });
