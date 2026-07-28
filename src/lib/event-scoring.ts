/**
 * Spec-compliant Event Opportunity Score (Phase 1.6).
 *
 * Eight fixed components summing to 100 in SPEC_DEFAULT mode. CUSTOM mode
 * keeps the same component names but rescales them onto configured weights.
 */

export type EventScoringMode = "SPEC_DEFAULT" | "CUSTOM";

export const EVENT_SCORE_COMPONENTS = [
  { key: "exhibitor_volume", label: "Exhibitor volume", max: 20 },
  { key: "average_company_size", label: "Average company size", max: 15 },
  { key: "booth_spend", label: "Likely booth spending", max: 20 },
  { key: "led_digital_potential", label: "LED & digital potential", max: 15 },
  { key: "exhibitor_list_availability", label: "Exhibitor-list availability", max: 10 },
  { key: "time_remaining", label: "Time remaining", max: 10 },
  { key: "geographic_serviceability", label: "Geographic serviceability", max: 5 },
  { key: "recurring_opportunity", label: "Recurring opportunity", max: 5 },
] as const;

export type EventScoreComponentKey = (typeof EVENT_SCORE_COMPONENTS)[number]["key"];

export type EventScoreBreakdown = Record<EventScoreComponentKey, number> & { total: number };

export type EventScoreInput = {
  exhibitorCount: number | null;
  /** Rough average headcount of exhibiting companies, when known. */
  averageCompanySize: number | null;
  industry: string | null;
  directoryStatus: "PUBLIC" | "GATED" | "PDF_ONLY" | "NONE" | "UNKNOWN";
  daysUntilEvent: number | null;
  serviceable: boolean | null;
  recurring: boolean | null;
};

const HIGH_SPEND_INDUSTRIES =
  /tech|software|manufactur|automotive|vehicle|health|medical|pharma|beauty|cosmetic|retail|finance|bank|energy|oil|gaming|aviation|aerospace|industrial|semiconductor/i;

const HIGH_LED_INDUSTRIES = /tech|software|gaming|automotive|vehicle|media|entertainment|electronics|retail|beauty/i;

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value)));
}

/** Raw 0-100 spec components. Unknown inputs score conservatively, never null. */
export function scoreEventComponents(input: EventScoreInput): Record<EventScoreComponentKey, number> {
  const exhibitors = input.exhibitorCount ?? null;
  const exhibitor_volume =
    exhibitors === null ? 8 : clamp(Math.log10(Math.max(1, exhibitors)) * 8, 20);

  const size = input.averageCompanySize ?? null;
  const average_company_size =
    size === null ? 7 : clamp(Math.log10(Math.max(1, size)) * 4.5, 15);

  const industry = input.industry ?? "";
  const booth_spend = clamp(
    (HIGH_SPEND_INDUSTRIES.test(industry) ? 14 : 8) + (exhibitors !== null && exhibitors >= 300 ? 6 : 2),
    20,
  );

  const led_digital_potential = clamp(HIGH_LED_INDUSTRIES.test(industry) ? 12 : 6, 15);

  const availability =
    input.directoryStatus === "PUBLIC"
      ? 10
      : input.directoryStatus === "PDF_ONLY"
        ? 8
        : input.directoryStatus === "GATED"
          ? 4
          : input.directoryStatus === "NONE"
            ? 0
            : 3;

  const days = input.daysUntilEvent;
  let time_remaining: number;
  if (days === null) time_remaining = 5;
  else if (days < 0) time_remaining = 0;
  else if (days < 30) time_remaining = 3;
  else if (days < 90) time_remaining = 7;
  else if (days <= 365) time_remaining = 10;
  else time_remaining = 6;

  const geographic_serviceability = input.serviceable === false ? 0 : input.serviceable === true ? 5 : 3;
  const recurring_opportunity = input.recurring === true ? 5 : input.recurring === false ? 0 : 2;

  return {
    exhibitor_volume,
    average_company_size,
    booth_spend,
    led_digital_potential,
    exhibitor_list_availability: availability,
    time_remaining,
    geographic_serviceability,
    recurring_opportunity,
  };
}

export type EventScoringConfig = {
  mode: EventScoringMode;
  /** Only used in CUSTOM mode; must be normalizable to 100. */
  weights?: Partial<Record<EventScoreComponentKey, number>>;
};

export const SPEC_EVENT_SCORING: EventScoringConfig = { mode: "SPEC_DEFAULT" };

export class InvalidEventScoringConfig extends Error {}

/** Normalize custom weights to a 100-point budget, rejecting unusable configs. */
export function normalizeEventWeights(
  weights: Partial<Record<EventScoreComponentKey, number>>,
): Record<EventScoreComponentKey, number> {
  const raw = EVENT_SCORE_COMPONENTS.map((c) => {
    const value = Number(weights[c.key]);
    if (!Number.isFinite(value) || value < 0) {
      throw new InvalidEventScoringConfig(`Invalid weight for ${c.key}`);
    }
    return [c.key, value] as const;
  });
  const sum = raw.reduce((acc, [, v]) => acc + v, 0);
  if (sum <= 0) throw new InvalidEventScoringConfig("Custom event weights must sum to more than zero");
  const out = {} as Record<EventScoreComponentKey, number>;
  for (const [key, value] of raw) out[key] = (value / sum) * 100;
  return out;
}

/** Compute the score plus the stored component breakdown. */
export function scoreEvent(
  input: EventScoreInput,
  config: EventScoringConfig = SPEC_EVENT_SCORING,
): { breakdown: EventScoreBreakdown; mode: EventScoringMode } {
  const raw = scoreEventComponents(input);

  if (config.mode === "SPEC_DEFAULT") {
    const breakdown = { ...raw, total: 0 } as EventScoreBreakdown;
    breakdown.total = EVENT_SCORE_COMPONENTS.reduce((sum, c) => sum + breakdown[c.key], 0);
    return { breakdown, mode: "SPEC_DEFAULT" };
  }

  const weights = normalizeEventWeights(config.weights ?? {});
  const breakdown = { total: 0 } as EventScoreBreakdown;
  let total = 0;
  for (const c of EVENT_SCORE_COMPONENTS) {
    const ratio = c.max > 0 ? raw[c.key] / c.max : 0;
    const scaled = Math.round(ratio * weights[c.key]);
    breakdown[c.key] = scaled;
    total += scaled;
  }
  breakdown.total = Math.max(0, Math.min(100, total));
  return { breakdown, mode: "CUSTOM" };
}

/** Recommended action label used in the Trade Shows report section. */
export function recommendedAction(score: number, status: string): string {
  if (status === "CANCELED") return "Exclude — canceled";
  if (status === "STALE") return "Exclude — past edition";
  if (status !== "CONFIRMED") return "Verify the official event page before researching exhibitors";
  if (score >= 80) return "Immediate research";
  if (score >= 65) return "High priority";
  if (score >= 50) return "Secondary";
  return "Low priority";
}
