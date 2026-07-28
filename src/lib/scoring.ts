/**
 * Configurable lead-scoring model.
 *
 * The AI scores every lead against the canonical 9-component model with its
 * default maximums. User settings then rescale each component to the weights
 * they configured and apply their own tier thresholds, so changing the
 * settings changes scoring without re-prompting the model differently.
 */

export const SCORE_COMPONENTS = [
  { key: "trade_show_activity", label: "Trade show activity", defaultMax: 15 },
  { key: "booth_scale_complexity", label: "Booth scale & complexity", defaultMax: 15 },
  { key: "led_digital_fit", label: "LED / digital fit", defaultMax: 15 },
  { key: "buying_capacity", label: "Buying capacity", defaultMax: 10 },
  { key: "timing", label: "Timing", defaultMax: 10 },
  { key: "decision_maker_availability", label: "Decision-maker availability", defaultMax: 10 },
  { key: "growth_trigger_signals", label: "Growth trigger signals", defaultMax: 10 },
  { key: "service_fit", label: "Service fit", defaultMax: 10 },
  { key: "vendor_opportunity", label: "Vendor opportunity", defaultMax: 5 },
] as const;

export type ScoreComponentKey = (typeof SCORE_COMPONENTS)[number]["key"];

export type ScoringSettings = {
  weights: Record<string, number>;
  tier1_min: number;
  tier2_min: number;
  tier3_min: number;
  qualified_min: number;
  tier1_requires_verified_contact: boolean;
};

export const DEFAULT_WEIGHTS: Record<string, number> = Object.fromEntries(
  SCORE_COMPONENTS.map((c) => [c.key, c.defaultMax]),
);

export const DEFAULT_SCORING: ScoringSettings = {
  weights: { ...DEFAULT_WEIGHTS },
  tier1_min: 80,
  tier2_min: 65,
  tier3_min: 50,
  qualified_min: 65,
  tier1_requires_verified_contact: true,
};

/** Merge a stored (possibly partial) settings row with the defaults. */
export function normalizeScoringSettings(row: Partial<ScoringSettings> | null | undefined): ScoringSettings {
  const stored = (row?.weights ?? {}) as Record<string, unknown>;
  const weights: Record<string, number> = {};
  for (const c of SCORE_COMPONENTS) {
    const raw = Number(stored[c.key]);
    weights[c.key] = Number.isFinite(raw) && raw >= 0 ? Math.min(100, Math.round(raw)) : c.defaultMax;
  }
  const clamp = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
  };
  return {
    weights,
    tier1_min: clamp(row?.tier1_min, DEFAULT_SCORING.tier1_min),
    tier2_min: clamp(row?.tier2_min, DEFAULT_SCORING.tier2_min),
    tier3_min: clamp(row?.tier3_min, DEFAULT_SCORING.tier3_min),
    qualified_min: clamp(row?.qualified_min, DEFAULT_SCORING.qualified_min),
    tier1_requires_verified_contact:
      row?.tier1_requires_verified_contact ?? DEFAULT_SCORING.tier1_requires_verified_contact,
  };
}

/** Total points available under a settings object. */
export function totalWeight(settings: ScoringSettings): number {
  return SCORE_COMPONENTS.reduce((sum, c) => sum + (settings.weights[c.key] ?? 0), 0);
}

/** Maximum points for one component under the given settings. */
export function componentMax(settings: ScoringSettings, key: string): number {
  const configured = settings.weights[key];
  return Number.isFinite(configured) ? configured : (DEFAULT_WEIGHTS[key] ?? 0);
}

/**
 * Rescale the model's raw component points onto the configured weights and
 * normalize the total to a 0-100 scale.
 */
export function applyWeights(
  raw: Record<string, number>,
  settings: ScoringSettings,
): { breakdown: Record<string, number>; total: number } {
  const breakdown: Record<string, number> = {};
  let weighted = 0;
  for (const c of SCORE_COMPONENTS) {
    const points = Math.max(0, Math.min(c.defaultMax, Number(raw?.[c.key] ?? 0)));
    const ratio = c.defaultMax > 0 ? points / c.defaultMax : 0;
    const max = componentMax(settings, c.key);
    const scaled = Math.round(ratio * max);
    breakdown[c.key] = scaled;
    weighted += scaled;
  }
  const available = totalWeight(settings);
  const total = available > 0 ? Math.max(0, Math.min(100, Math.round((weighted / available) * 100))) : 0;
  return { breakdown, total };
}

/** Tier a total score using the configured thresholds. */
export function tierFor(total: number, hasVerifiedContact: boolean, settings: ScoringSettings): string {
  if (total >= settings.tier1_min && (!settings.tier1_requires_verified_contact || hasVerifiedContact)) {
    return "TIER_1_IMMEDIATE";
  }
  if (total >= settings.tier2_min) return "TIER_2_HIGH_PRIORITY";
  if (total >= settings.tier3_min) return "TIER_3_NURTURE";
  return "TIER_4_LOW_PRIORITY";
}
