/**
 * Email generation gate, personalization facts and outreach timing
 * (spec Phase 3.3, 3.4, 3.7).
 */

export type PersonalizationFactType =
  | "CONFIRMED_EXHIBITOR"
  | "BOOTH_NUMBER"
  | "PRODUCT_LAUNCH"
  | "EVENT_ANNOUNCEMENT"
  | "VERIFIED_BOOTH_CHARACTERISTIC"
  | "REPEATED_PARTICIPATION"
  | "NEW_MARKET_EXPANSION"
  | "CONFIRMED_LED_OR_DIGITAL";

export type PersonalizationFact = {
  type: PersonalizationFactType;
  value: string;
  source_url: string;
  confidence: number;
};

export type EmailGateReason =
  | "EVENT_NOT_VERIFIED"
  | "EXHIBITOR_NOT_CONFIRMED"
  | "NO_EXHIBITOR_EVIDENCE"
  | "NO_CONTACT_OR_TARGET_TITLE"
  | "NO_VERIFIED_PERSONALIZATION"
  | "NO_SERVICE_MATCH";

export type EmailGateInput = {
  eventVerifiedStatus: string;
  exhibitorRecordStatus: string;
  hasExhibitorEvidence: boolean;
  hasContactOrTargetTitle: boolean;
  personalizationFacts: PersonalizationFact[];
  matchedServices: string[];
};

export type EmailGateResult =
  | { status: "READY"; fact: PersonalizationFact; service: string }
  | { status: "BLOCKED"; reasons: EmailGateReason[] };

/** All six conditions must hold before a draft may be generated. */
export function evaluateEmailGate(input: EmailGateInput): EmailGateResult {
  const reasons: EmailGateReason[] = [];
  if (input.eventVerifiedStatus !== "CONFIRMED") reasons.push("EVENT_NOT_VERIFIED");
  if (input.exhibitorRecordStatus !== "CONFIRMED") reasons.push("EXHIBITOR_NOT_CONFIRMED");
  if (!input.hasExhibitorEvidence) reasons.push("NO_EXHIBITOR_EVIDENCE");
  if (!input.hasContactOrTargetTitle) reasons.push("NO_CONTACT_OR_TARGET_TITLE");

  const facts = (input.personalizationFacts ?? []).filter(
    (f) => f && f.value?.trim() && f.source_url?.trim() && (f.confidence ?? 0) > 0,
  );
  if (facts.length === 0) reasons.push("NO_VERIFIED_PERSONALIZATION");

  const service = (input.matchedServices ?? []).find((s) => s && s.trim());
  if (!service) reasons.push("NO_SERVICE_MATCH");

  if (reasons.length > 0) return { status: "BLOCKED", reasons };
  const best = [...facts].sort((a, b) => b.confidence - a.confidence)[0];
  return { status: "READY", fact: best, service: service as string };
}

export type OutreachPhase =
  | "EARLY_PLANNING"
  | "VENDOR_SELECTION"
  | "DESIGN_AND_BUDGET"
  | "PRODUCTION_SUPPORT"
  | "URGENT_SUPPORT"
  | "POST_SHOW_NURTURE";

export type OutreachTimingConfig = {
  earlyPlanningMinDays: number;
  vendorSelectionMinDays: number;
  designBudgetMinDays: number;
  productionSupportMinDays: number;
};

export const DEFAULT_OUTREACH_TIMING: OutreachTimingConfig = {
  earlyPlanningMinDays: 270, // 9 months
  vendorSelectionMinDays: 180, // 6 months
  designBudgetMinDays: 90, // 3 months
  productionSupportMinDays: 30, // 1 month
};

export function outreachPhase(
  daysUntilEvent: number | null,
  config: OutreachTimingConfig = DEFAULT_OUTREACH_TIMING,
): OutreachPhase {
  if (daysUntilEvent === null) return "EARLY_PLANNING";
  if (daysUntilEvent < 0) return "POST_SHOW_NURTURE";
  if (daysUntilEvent >= config.earlyPlanningMinDays) return "EARLY_PLANNING";
  if (daysUntilEvent >= config.vendorSelectionMinDays) return "VENDOR_SELECTION";
  if (daysUntilEvent >= config.designBudgetMinDays) return "DESIGN_AND_BUDGET";
  if (daysUntilEvent >= config.productionSupportMinDays) return "PRODUCTION_SUPPORT";
  return "URGENT_SUPPORT";
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Send now, follow up a week later (or sooner when the show is close). */
export function outreachDates(
  daysUntilEvent: number | null,
  now = new Date(),
): { recommended_send_date: string; follow_up_date: string } {
  const send = new Date(now.getTime());
  const followUpDays = daysUntilEvent !== null && daysUntilEvent < 30 ? 3 : 7;
  const follow = new Date(send.getTime() + followUpDays * 86_400_000);
  return { recommended_send_date: isoDate(send), follow_up_date: isoDate(follow) };
}

/** Match our service catalogue against what the record supports. */
export function matchServices(input: {
  boothType?: string | null;
  boothSize?: string | null;
  ledSignal?: boolean;
  recommendedServices?: string[] | null;
}): string[] {
  const out = new Set<string>();
  for (const s of input.recommendedServices ?? []) if (s?.trim()) out.add(s.trim());
  if (input.ledSignal) out.add("LED video walls");
  if (/island|20x20|30x30|40x40|large/i.test(String(input.boothSize ?? input.boothType ?? ""))) {
    out.add("custom island exhibit design and fabrication");
  }
  if (out.size === 0) out.add("custom and modular exhibit design and fabrication");
  return Array.from(out);
}
