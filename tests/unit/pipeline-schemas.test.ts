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

  it("rejects scores out of range", () => {
    expect(() => EventSchema.parse({ ...base, event_opportunity_score: 101 })).toThrow();
    expect(() => EventSchema.parse({ ...base, event_opportunity_score: -1 })).toThrow();
  });

  it("requires rationale", () => {
    const { rationale: _r, ...rest } = base;
    expect(() => EventSchema.parse(rest)).toThrow();
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
  it("validates nested exhibitors and rejects bad shapes", () => {
    const ok = ExhibitorListSchema.parse({
      exhibitors: [{ company_name: "Acme", normalized_company_name: "acme" }],
      total_found: 1,
      extraction_complete: true,
      limitations: [],
    });
    expect(ok.exhibitors[0].company_name).toBe("Acme");

    expect(() =>
      ExhibitorListSchema.parse({
        exhibitors: [{ company_name: "Acme" }],
        total_found: 1,
        extraction_complete: true,
        limitations: [],
      }),
    ).toThrow();
  });
});

describe("ScoreBreakdownSchema", () => {
  it("requires all 9 components", () => {
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
    expect(() => ScoreBreakdownSchema.parse(missing)).toThrow();
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
