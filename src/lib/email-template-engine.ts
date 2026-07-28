/**
 * Client-safe outreach email template engine.
 *
 * Templates are matched to a lead by industry, trade show, lead score and the
 * evidence strength of the lead's best decision-maker, then rendered with
 * verified lead fields only. Unknown fields render as an explicit placeholder
 * so nothing is fabricated in outreach copy.
 */

export const EVIDENCE_LEVELS = ["ANY", "ESTIMATED", "INFERRED", "VERIFIED"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export type EmailTemplate = {
  id: string;
  name: string;
  industry: string | null;
  trade_show: string | null;
  min_evidence_level: string;
  min_lead_score: number;
  subject_template: string;
  body_template: string;
  is_default: boolean;
};

export type TemplateDecisionMaker = {
  name?: string | null;
  title?: string | null;
  evidence_status?: string | null;
  contact_confidence?: number | null;
  public_business_email?: string | null;
};

export type TemplateLead = {
  company_name: string;
  industry?: string | null;
  trade_show?: string | null;
  event_date?: string | null;
  booth_number?: string | null;
  booth_type?: string | null;
  booth_size_estimate?: string | null;
  recommended_services?: string[] | null;
  estimated_project_value_low?: number | null;
  estimated_project_value_high?: number | null;
  lead_score?: number | null;
  priority_tier?: string | null;
  company_website?: string | null;
  source_urls?: string[] | null;
  decision_makers?: TemplateDecisionMaker[] | null;
};

export const UNKNOWN_PLACEHOLDER = "[unknown]";

function rank(level: string | null | undefined): number {
  const l = (level ?? "").toUpperCase();
  if (l.includes("VERIFIED") || l.includes("CONFIRMED")) return 3;
  if (l.includes("INFERRED")) return 2;
  if (l.includes("ESTIMATED")) return 1;
  return 0;
}

export function evidenceRank(level: string | null | undefined) {
  return rank(level);
}

/** Strongest evidence status across a lead's decision makers. */
export function leadEvidenceLevel(lead: TemplateLead): EvidenceLevel {
  const best = (lead.decision_makers ?? []).reduce((acc, dm) => Math.max(acc, rank(dm.evidence_status)), 0);
  return (["ANY", "ESTIMATED", "INFERRED", "VERIFIED"] as const)[best];
}

export function bestDecisionMaker(lead: TemplateLead): TemplateDecisionMaker | null {
  const list = lead.decision_makers ?? [];
  if (!list.length) return null;
  return [...list].sort(
    (a, b) =>
      rank(b.evidence_status) - rank(a.evidence_status) ||
      (b.contact_confidence ?? 0) - (a.contact_confidence ?? 0),
  )[0];
}

function money(low?: number | null, high?: number | null) {
  if (low == null && high == null) return null;
  const f = (n: number) => `$${n.toLocaleString("en-US")}`;
  if (low != null && high != null) return `${f(low)}–${f(high)}`;
  return f((low ?? high) as number);
}

export const TEMPLATE_VARIABLES: Array<{ key: string; description: string }> = [
  { key: "company_name", description: "Exhibiting company name" },
  { key: "industry", description: "Company / show industry" },
  { key: "trade_show", description: "Trade show name" },
  { key: "event_date", description: "Show date" },
  { key: "booth_number", description: "Booth number from the directory" },
  { key: "booth_type", description: "Booth type (island, inline, …)" },
  { key: "booth_size", description: "Estimated booth size" },
  { key: "recommended_services", description: "Recommended services list" },
  { key: "estimated_value", description: "Estimated project value range" },
  { key: "lead_score", description: "Lead score 0–100" },
  { key: "priority_tier", description: "Priority tier" },
  { key: "contact_name", description: "Best decision maker's name" },
  { key: "contact_first_name", description: "Best decision maker's first name" },
  { key: "contact_title", description: "Best decision maker's title" },
  { key: "contact_email", description: "Public business email, if verified" },
  { key: "evidence_status", description: "Evidence strength for that contact" },
  { key: "company_website", description: "Company website" },
  { key: "source_url", description: "Primary source URL" },
];

export function templateValues(lead: TemplateLead): Record<string, string | null> {
  const dm = bestDecisionMaker(lead);
  const name = dm?.name ?? null;
  return {
    company_name: lead.company_name || null,
    industry: lead.industry ?? null,
    trade_show: lead.trade_show ?? null,
    event_date: lead.event_date ?? null,
    booth_number: lead.booth_number ?? null,
    booth_type: lead.booth_type ?? null,
    booth_size: lead.booth_size_estimate ?? null,
    recommended_services: lead.recommended_services?.length ? lead.recommended_services.join(", ") : null,
    estimated_value: money(lead.estimated_project_value_low, lead.estimated_project_value_high),
    lead_score: lead.lead_score != null ? String(lead.lead_score) : null,
    priority_tier: lead.priority_tier ?? null,
    contact_name: name,
    contact_first_name: name ? name.trim().split(/\s+/)[0] : null,
    contact_title: dm?.title ?? null,
    contact_email: dm?.public_business_email ?? null,
    evidence_status: dm?.evidence_status ?? leadEvidenceLevel(lead),
    company_website: lead.company_website ?? null,
    source_url: lead.source_urls?.[0] ?? null,
  };
}

/**
 * Replaces {{variable}} tokens. Supports {{var|fallback text}} so writers can
 * avoid the [unknown] placeholder where a graceful phrase reads better.
 */
export function renderTemplateString(template: string, lead: TemplateLead): string {
  const values = templateValues(lead);
  return template.replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (_m, key: string, fallback?: string) => {
    const value = values[key.toLowerCase()];
    if (value != null && value !== "") return value;
    return (fallback ?? "").trim() || UNKNOWN_PLACEHOLDER;
  });
}

export function missingVariables(template: string, lead: TemplateLead): string[] {
  const values = templateValues(lead);
  const out = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi)) {
    const key = m[1].toLowerCase();
    if (!(key in values)) out.add(`${key} (unknown variable)`);
    else if (values[key] == null || values[key] === "") out.add(key);
  }
  return [...out];
}

function norm(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase();
}

export function templateMatches(t: EmailTemplate, lead: TemplateLead): boolean {
  if ((lead.lead_score ?? 0) < (t.min_lead_score ?? 0)) return false;
  if (rank(leadEvidenceLevel(lead)) < rank(t.min_evidence_level)) return false;
  if (t.industry && !norm(lead.industry).includes(norm(t.industry))) return false;
  if (t.trade_show && !norm(lead.trade_show).includes(norm(t.trade_show))) return false;
  return true;
}

/** Higher = more specific, so the tightest matching template wins. */
export function templateSpecificity(t: EmailTemplate): number {
  return (
    (t.industry ? 4 : 0) +
    (t.trade_show ? 4 : 0) +
    (rank(t.min_evidence_level) > 0 ? 2 : 0) +
    (t.min_lead_score > 0 ? 1 : 0)
  );
}

export function pickTemplate(templates: EmailTemplate[], lead: TemplateLead): EmailTemplate | null {
  const matching = templates.filter((t) => templateMatches(t, lead));
  if (!matching.length) return templates.find((t) => t.is_default) ?? null;
  return [...matching].sort(
    (a, b) =>
      templateSpecificity(b) - templateSpecificity(a) ||
      Number(b.is_default) - Number(a.is_default) ||
      a.name.localeCompare(b.name),
  )[0];
}

export function renderForLead(templates: EmailTemplate[], lead: TemplateLead) {
  const template = pickTemplate(templates, lead);
  if (!template) return null;
  return {
    template,
    subject: renderTemplateString(template.subject_template, lead),
    body: renderTemplateString(template.body_template, lead),
    missing: [
      ...new Set([
        ...missingVariables(template.subject_template, lead),
        ...missingVariables(template.body_template, lead),
      ]),
    ],
    evidence: leadEvidenceLevel(lead),
  };
}

export const SAMPLE_LEAD: TemplateLead = {
  company_name: "Northwind Medical",
  industry: "Medical Devices",
  trade_show: "MD&M West 2026",
  event_date: "2026-02-10",
  booth_number: "3412",
  booth_type: "Island",
  booth_size_estimate: "20x30",
  recommended_services: ["Custom booth design", "LED video wall", "Installation & dismantle"],
  estimated_project_value_low: 60000,
  estimated_project_value_high: 95000,
  lead_score: 82,
  priority_tier: "TIER_1_IMMEDIATE",
  company_website: "https://northwindmedical.com",
  source_urls: ["https://example.com/exhibitor-list"],
  decision_makers: [
    {
      name: "Dana Reyes",
      title: "Director of Marketing",
      evidence_status: "VERIFIED",
      contact_confidence: 88,
      public_business_email: "dana.reyes@northwindmedical.com",
    },
  ],
};
