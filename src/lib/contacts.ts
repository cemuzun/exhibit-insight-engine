/**
 * Decision-maker classification and verification (spec Phase 3.1/3.2).
 */

export type ContactClassification = "PRIMARY" | "SECONDARY" | "INFLUENCER" | "INFERRED_TARGET_TITLE";

export type ContactVerificationStatus =
  | "VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "INFERRED"
  | "STALE"
  | "REJECTED";

export type Contact = {
  full_name: string | null;
  current_title: string;
  department: string | null;
  location: string | null;
  profile_url: string | null;
  public_business_email: string | null;
  public_business_phone: string | null;
  classification: ContactClassification;
  relevance_explanation: string | null;
  evidence_source_url: string | null;
  employment_verified_at: string | null;
  contact_confidence: number;
  verification_status: ContactVerificationStatus;
};

const PRIMARY_TITLES = [
  /director of events/i,
  /director of event marketing/i,
  /director of experiential marketing/i,
  /head of events/i,
  /global events (director|manager)/i,
  /trade ?show manager/i,
  /exhibitions? manager/i,
  /corporate events manager/i,
  /event marketing manager/i,
  /experiential marketing manager/i,
  /field marketing (director|manager)/i,
];

const SECONDARY_TITLES = [
  /vice president of marketing|vp,? marketing/i,
  /chief marketing officer|cmo\b/i,
  /marketing director|director of marketing/i,
  /brand marketing director/i,
  /marketing operations director/i,
  /product marketing director/i,
  /demand generation director/i,
  /corporate communications director/i,
];

const INFLUENCER_TITLES = [
  /event coordinator/i,
  /marketing manager/i,
  /brand manager/i,
  /creative director/i,
  /procurement manager/i,
  /strategic sourcing manager/i,
  /event agency/i,
];

const PROCUREMENT = /procurement|sourcing|purchasing/i;

/**
 * Map a job title onto the four spec classifications. Procurement never becomes
 * PRIMARY unless there is explicit evidence it owns exhibit-vendor selection.
 */
export function classifyTitle(
  title: string | null | undefined,
  opts: { hasPerson?: boolean; procurementOwnsVendorSelection?: boolean } = {},
): ContactClassification {
  const hasPerson = opts.hasPerson ?? true;
  if (!hasPerson) return "INFERRED_TARGET_TITLE";
  const value = String(title ?? "").trim();
  if (!value) return "INFERRED_TARGET_TITLE";

  if (PROCUREMENT.test(value)) {
    return opts.procurementOwnsVendorSelection ? "PRIMARY" : "INFLUENCER";
  }
  if (PRIMARY_TITLES.some((re) => re.test(value))) return "PRIMARY";
  if (SECONDARY_TITLES.some((re) => re.test(value))) return "SECONDARY";
  if (INFLUENCER_TITLES.some((re) => re.test(value))) return "INFLUENCER";
  return "INFLUENCER";
}

/** Map legacy `role_classification`/`evidence_status` values onto the new model. */
export function mapLegacyContact(raw: Record<string, unknown>): Contact {
  const name = (raw.name ?? raw.full_name ?? null) as string | null;
  const title = String(raw.title ?? raw.current_title ?? "Unknown");
  const legacyStatus = String(raw.evidence_status ?? raw.verification_status ?? "").toUpperCase();
  const confidence = Number(raw.contact_confidence ?? 0) || 0;
  const hasPerson = !!name && name.trim().length > 1;

  const classification: ContactClassification = raw.classification
    ? (String(raw.classification) as ContactClassification)
    : classifyTitle(title, { hasPerson });

  let verification: ContactVerificationStatus;
  if (!hasPerson) verification = "INFERRED";
  else if (legacyStatus === "CONFIRMED" && confidence >= 70) verification = "VERIFIED";
  else if (legacyStatus === "CONFIRMED") verification = "PARTIALLY_VERIFIED";
  else if (legacyStatus === "REJECTED") verification = "REJECTED";
  else if (legacyStatus === "STALE") verification = "STALE";
  else verification = "INFERRED";

  return {
    full_name: hasPerson ? name : null,
    current_title: title,
    department: (raw.department as string | null) ?? null,
    location: (raw.location as string | null) ?? null,
    profile_url: (raw.professional_profile_url ?? raw.profile_url ?? null) as string | null,
    public_business_email: (raw.public_business_email as string | null) ?? null,
    public_business_phone: (raw.public_business_phone as string | null) ?? null,
    classification: hasPerson ? classification : "INFERRED_TARGET_TITLE",
    relevance_explanation: (raw.relevance_explanation as string | null) ?? null,
    evidence_source_url: (raw.evidence_source_url as string | null) ?? null,
    employment_verified_at: (raw.employment_verified_at as string | null) ?? null,
    contact_confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    verification_status: verification,
  };
}

/** Build the fallback record when no real person could be verified. */
export function inferredTargetTitle(args: {
  title: string;
  department?: string | null;
  reason: string;
}): Contact {
  return {
    full_name: null,
    current_title: args.title,
    department: args.department ?? null,
    location: null,
    profile_url: null,
    public_business_email: null,
    public_business_phone: null,
    classification: "INFERRED_TARGET_TITLE",
    relevance_explanation: args.reason,
    evidence_source_url: null,
    employment_verified_at: null,
    contact_confidence: 40,
    verification_status: "INFERRED",
  };
}

/** Recommended target title based on company size (spec Step 5 fallback). */
export function recommendedTargetTitle(employeeRange: string | null | undefined): string {
  const text = String(employeeRange ?? "");
  const numbers = Array.from(text.matchAll(/\d[\d,]*/g)).map((m) => Number(m[0].replace(/,/g, "")));
  const size = numbers.length > 0 ? Math.max(...numbers) : null;
  if (size !== null && size < 50) return "Head of Marketing";
  if (size !== null && size <= 500) return "Event Marketing Manager";
  if (size !== null) return "Director of Events";
  return "Event Marketing Manager";
}

export function sortContacts(contacts: Contact[]): Contact[] {
  const rank: Record<ContactClassification, number> = {
    PRIMARY: 0,
    SECONDARY: 1,
    INFLUENCER: 2,
    INFERRED_TARGET_TITLE: 3,
  };
  return [...contacts].sort(
    (a, b) => rank[a.classification] - rank[b.classification] || b.contact_confidence - a.contact_confidence,
  );
}
