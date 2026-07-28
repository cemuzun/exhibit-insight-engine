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

        let companyId = await findCompanyByDomain(domain);
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

        const dms = (lead.decision_makers ?? []) as DecisionMaker[];
        const contactIds: string[] = [];
        for (const dm of dms) {
          const email = dm.public_business_email?.trim().toLowerCase();
          // Verified fields only: needs a valid, evidence-backed business email.
          if (!isValidEmail(email) || !isVerified(dm.evidence_status)) continue;

          const existing = await findContactByEmail(email);
          if (existing) {
            skipped++;
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
