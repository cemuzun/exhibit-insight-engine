import { describe, it, expect } from "vitest";
import {
  EventSchema,
  EventListSchema,
  ExhibitorListSchema,
  ScoreBreakdownSchema,
  ExecSummarySchema,
} from "@/lib/pipeline-schemas";

describe("EventSchema", () => {
  const base = {
    event_name: "CES 2026",
    event_opportunity_score: 88,
    recommended_outreach_phase: "PRE_SHOW",
    rationale: "Large LED-heavy show",
  };

  it("accepts a minimal valid event", () => {
    expect(EventSchema.parse(base)).toMatchObject({ event_name: "CES 2026" });
  });

  it("tolerates out-of-range scores (clamped later in the pipeline)", () => {
    expect(EventSchema.parse({ ...base, event_opportunity_score: 101 }).event_opportunity_score).toBe(101);
    expect(EventSchema.parse({ ...base, event_opportunity_score: "77" }).event_opportunity_score).toBe(77);
  });

  it("defaults a missing score and outreach phase instead of failing", () => {
    const { event_opportunity_score: _s, recommended_outreach_phase: _p, ...rest } = base;
    const parsed = EventSchema.parse(rest);
    expect(parsed.event_opportunity_score).toBe(50);
    expect(parsed.recommended_outreach_phase).toBe("EARLY_PLANNING");
  });
});

describe("EventListSchema", () => {
  it("parses a directory response", () => {
    const parsed = EventListSchema.parse({
      source_classification: "DIRECTORY",
      is_directory: true,
      events: [],
      limitations: ["no dates"],
    });
    expect(parsed.is_directory).toBe(true);
    expect(parsed.events).toEqual([]);
  });
});

describe("ExhibitorListSchema", () => {
  it("validates nested exhibitors and tolerates sparse shapes", () => {
    const ok = ExhibitorListSchema.parse({
      exhibitors: [{ company_name: "Acme", normalized_company_name: "acme" }],
      total_found: 1,
      extraction_complete: true,
      limitations: [],
    });
    expect(ok.exhibitors[0].company_name).toBe("Acme");

    const sparse = ExhibitorListSchema.parse({
      exhibitors: [{ company_name: "Acme" }],
      total_found: 1,
      extraction_complete: true,
      limitations: [],
    });
    expect(sparse.exhibitors).toHaveLength(1);
  });
});

describe("ScoreBreakdownSchema", () => {
  it("parses all 9 components and defaults missing ones to 0", () => {
    const full = {
      trade_show_activity: 10,
      booth_scale_complexity: 10,
      led_digital_fit: 10,
      buying_capacity: 10,
      timing: 10,
      decision_maker_availability: 10,
      growth_trigger_signals: 10,
      service_fit: 10,
      vendor_opportunity: 10,
    };
    expect(ScoreBreakdownSchema.parse(full)).toEqual(full);
    const { timing: _t, ...missing } = full;
    expect(ScoreBreakdownSchema.parse(missing).timing).toBe(0);
  });
});

describe("ExecSummarySchema", () => {
  it("parses a valid exec summary", () => {
    const parsed = ExecSummarySchema.parse({
      shows_reviewed: 1,
      exhibitors_identified: 10,
      qualified_accounts: 5,
      verified_decision_makers: 3,
      tier_1_leads: 2,
      top_industries: ["AV"],
      top_shows: ["CES"],
      main_limitations: [],
      recommended_immediate_action: "Email tier-1 leads",
    });
    expect(parsed.tier_1_leads).toBe(2);
  });
});
