export type ScoringFeedEntry = {
  at: string;
  company: string;
  show?: string;
  status: "scored" | "skipped";
  score?: number;
  tier?: string;
  confidence?: string;
  booth_confidence?: number;
  top_drivers?: { key: string; points: number; max: number }[];
  weak_spots?: { key: string; points: number; max: number }[];
  reason: string;
};

const LABELS: Record<string, string> = {
  trade_show_activity: "Show activity",
  booth_scale_complexity: "Booth scale",
  led_digital_fit: "LED / digital fit",
  buying_capacity: "Buying capacity",
  timing: "Timing",
  decision_maker_availability: "Decision-maker access",
  growth_trigger_signals: "Growth signals",
  service_fit: "Service fit",
  vendor_opportunity: "Vendor opportunity",
};

function tierTone(tier?: string) {
  if (tier === "TIER_1_IMMEDIATE") return "bg-primary/15 text-primary border-primary/30";
  if (tier === "TIER_2_HIGH_PRIORITY") return "bg-accent text-accent-foreground border-border";
  return "bg-muted text-muted-foreground border-border";
}

function Chip({ item, tone }: { item: { key: string; points: number; max: number }; tone: "up" | "down" }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] ${
        tone === "up"
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground"
      }`}
    >
      {LABELS[item.key] ?? item.key} {item.points}/{item.max}
    </span>
  );
}

export function ScoringFeed({ entries }: { entries: ScoringFeedEntry[] }) {
  if (!entries || entries.length === 0) return null;

  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">Live scoring decisions</h2>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          streaming
        </span>
      </div>

      <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
        {entries.map((e, i) => (
          <li key={`${e.at}-${i}`} className="rounded-md border border-border bg-background px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{e.company}</span>
              {e.status === "scored" ? (
                <>
                  <span className="font-mono text-xs text-muted-foreground">score {e.score}/100</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${tierTone(e.tier)}`}>
                    {(e.tier ?? "").replace(/_/g, " ").toLowerCase()}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    confidence {e.confidence}
                    {typeof e.booth_confidence === "number" ? ` · booth ${e.booth_confidence}%` : ""}
                  </span>
                </>
              ) : (
                <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
                  skipped
                </span>
              )}
              <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
                {new Date(e.at).toLocaleTimeString()}
              </span>
            </div>

            <p className="mt-1 text-xs text-muted-foreground">{e.reason}</p>

            {(e.top_drivers?.length || e.weak_spots?.length) ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {e.top_drivers?.map((d) => <Chip key={`u${d.key}`} item={d} tone="up" />)}
                {e.weak_spots?.map((d) => <Chip key={`d${d.key}`} item={d} tone="down" />)}
              </div>
            ) : null}

            {e.show ? (
              <div className="mt-1 text-[10px] text-muted-foreground/70">{e.show}</div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
