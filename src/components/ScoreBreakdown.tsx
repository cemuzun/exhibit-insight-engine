import {
  SCORE_COMPONENTS,
  componentMax,
  totalWeight,
  type ScoringSettings,
} from "@/lib/scoring";

export type ScoreBreakdownLead = {
  lead_score: number;
  priority_tier: string | null;
  score_breakdown: Record<string, number> | null;
  decision_makers: { contact_confidence?: number | null; evidence_status?: string | null }[];
};

const TIER_LABEL: Record<string, string> = {
  TIER_1_IMMEDIATE: "Tier 1 — Immediate",
  TIER_2_HIGH_PRIORITY: "Tier 2 — High priority",
  TIER_3_NURTURE: "Tier 3 — Nurture",
  TIER_4_LOW_PRIORITY: "Tier 4 — Low priority",
};

/**
 * Full audit of how one lead's score was produced: every component's earned
 * points against its configured weight, the normalization math, and the exact
 * threshold rule that selected the tier.
 */
export function ScoreBreakdown({
  lead,
  scoring,
}: {
  lead: ScoreBreakdownLead;
  scoring: ScoringSettings;
}) {
  const b = lead.score_breakdown ?? {};
  const rows = SCORE_COMPONENTS.map((c) => {
    const max = componentMax(scoring, c.key);
    const points = Math.max(0, Number(b[c.key] ?? 0));
    return {
      key: c.key as string,
      label: c.label,
      points,
      max,
      ratio: max > 0 ? points / max : 0,
      disabled: max === 0,
    };
  });

  const earned = rows.reduce((s, r) => s + r.points, 0);
  const available = totalWeight(scoring);
  const normalized = lead.lead_score;

  const hasVerified = (lead.decision_makers ?? []).some(
    (dm) => (dm.contact_confidence ?? 0) >= 70 && dm.evidence_status === "CONFIRMED",
  );

  const tier = lead.priority_tier ?? "TIER_4_LOW_PRIORITY";
  const tierReason = (() => {
    if (tier === "TIER_1_IMMEDIATE") {
      return `Score ${normalized} ≥ Tier 1 threshold (${scoring.tier1_min})${
        scoring.tier1_requires_verified_contact ? " and a confirmed decision-maker contact exists" : ""
      }.`;
    }
    if (normalized >= scoring.tier1_min && scoring.tier1_requires_verified_contact && !hasVerified) {
      return `Score ${normalized} clears the Tier 1 threshold (${scoring.tier1_min}) but no decision maker is confirmed at ≥70% contact confidence, so Tier 1 is withheld.`;
    }
    if (tier === "TIER_2_HIGH_PRIORITY") {
      return `Score ${normalized} is between the Tier 2 (${scoring.tier2_min}) and Tier 1 (${scoring.tier1_min}) thresholds.`;
    }
    if (tier === "TIER_3_NURTURE") {
      return `Score ${normalized} is between the Tier 3 (${scoring.tier3_min}) and Tier 2 (${scoring.tier2_min}) thresholds.`;
    }
    return `Score ${normalized} is below the Tier 3 threshold (${scoring.tier3_min}).`;
  })();

  const ranked = [...rows].filter((r) => !r.disabled).sort((a, c) => c.ratio - a.ratio);
  const drivers = ranked.slice(0, 3).filter((r) => r.points > 0);
  const gaps = [...ranked].reverse().slice(0, 3).filter((r) => r.ratio < 1);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Final score</span>
          <span className="font-mono text-2xl">{normalized}/100</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {earned} of {available} weighted points earned
          {available > 0 && available !== 100 && (
            <> · normalized to 100 ({earned} ÷ {available} × 100)</>
          )}
        </div>
        <div className="mt-3 text-sm font-medium">{TIER_LABEL[tier] ?? tier}</div>
        <p className="mt-1 text-xs text-muted-foreground">{tierReason}</p>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Factors and weights</div>
        {rows.map((r) => (
          <div key={r.key} className={`rounded border border-border p-2 ${r.disabled ? "opacity-50" : ""}`}>
            <div className="flex items-center justify-between text-xs">
              <span>{r.label}</span>
              <span className="font-mono">
                {r.disabled ? "disabled (weight 0)" : `${r.points} / ${r.max} pts`}
              </span>
            </div>
            {!r.disabled && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-muted">
                <div
                  className="h-full rounded bg-primary"
                  style={{ width: `${Math.min(100, Math.round(r.ratio * 100))}%` }}
                />
              </div>
            )}
            {!r.disabled && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                {Math.round(r.ratio * 100)}% of this factor · {available > 0 ? Math.round((r.max / available) * 100) : 0}% of the total model
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-border p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Strongest drivers</div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {drivers.length === 0 && <li className="text-muted-foreground">None — no factor scored points.</li>}
            {drivers.map((d) => (
              <li key={d.key}>{d.label} — {d.points}/{d.max}</li>
            ))}
          </ul>
        </div>
        <div className="rounded border border-border p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Biggest gaps</div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {gaps.length === 0 && <li className="text-muted-foreground">No gaps — every factor is maxed.</li>}
            {gaps.map((d) => (
              <li key={d.key}>{d.label} — {d.points}/{d.max} (missing {d.max - d.points})</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Weights and tier thresholds come from your scoring settings; changing them changes how future runs are tiered.
      </p>
    </div>
  );
}
