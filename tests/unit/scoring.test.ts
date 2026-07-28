import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCORING,
  applyWeights,
  normalizeScoringSettings,
  tierFor,
  totalWeight,
} from "../../src/lib/scoring";

const perfect = {
  trade_show_activity: 15,
  booth_scale_complexity: 15,
  led_digital_fit: 15,
  buying_capacity: 10,
  timing: 10,
  decision_maker_availability: 10,
  growth_trigger_signals: 10,
  service_fit: 10,
  vendor_opportunity: 5,
};

describe("scoring settings", () => {
  it("defaults total to 100 points", () => {
    expect(totalWeight(DEFAULT_SCORING)).toBe(100);
    expect(applyWeights(perfect, DEFAULT_SCORING).total).toBe(100);
  });

  it("fills missing weights with defaults", () => {
    const s = normalizeScoringSettings({ weights: { timing: 30 } });
    expect(s.weights.timing).toBe(30);
    expect(s.weights.service_fit).toBe(10);
  });

  it("rescales components to custom weights", () => {
    const s = normalizeScoringSettings({ weights: { ...DEFAULT_SCORING.weights, timing: 40 } });
    const { breakdown, total } = applyWeights({ ...perfect, timing: 5 }, s);
    expect(breakdown.timing).toBe(20);
    expect(total).toBeLessThan(100);
  });

  it("tiers by configured thresholds", () => {
    const s = normalizeScoringSettings({ tier1_min: 70, tier2_min: 60, tier3_min: 40 });
    expect(tierFor(75, true, s)).toBe("TIER_1_IMMEDIATE");
    expect(tierFor(75, false, s)).toBe("TIER_2_HIGH_PRIORITY");
    expect(tierFor(45, false, s)).toBe("TIER_3_NURTURE");
    expect(tierFor(10, false, s)).toBe("TIER_4_LOW_PRIORITY");
    const relaxed = normalizeScoringSettings({ tier1_min: 70, tier1_requires_verified_contact: false });
    expect(tierFor(75, false, relaxed)).toBe("TIER_1_IMMEDIATE");
  });
});
