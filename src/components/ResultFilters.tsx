/**
 * Live filters for run results. Options are derived from whatever leads have
 * streamed in so far, so the controls stay useful while a run is still working.
 */

export type ResultFilterState = {
  window: string; // "all" | "30" | "60" | "90" | "180"
  tier: string; // "all" | tier value | "qualified"
  industry: string; // "all" | industry name
};

export const DEFAULT_FILTERS: ResultFilterState = { window: "all", tier: "all", industry: "all" };

const WINDOWS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Any date" },
  { value: "30", label: "Next 30 days" },
  { value: "60", label: "Next 60 days" },
  { value: "90", label: "Next 90 days" },
  { value: "180", label: "Next 6 months" },
];

const TIERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All tiers" },
  { value: "qualified", label: "Qualified (65+)" },
  { value: "TIER_1_IMMEDIATE", label: "Tier 1 — immediate" },
  { value: "TIER_2_HIGH_PRIORITY", label: "Tier 2 — high priority" },
  { value: "TIER_3_NURTURE", label: "Tier 3 — nurture" },
];

/** Tolerant date parse for free-text show dates ("Mar 4-6, 2026", "2026-03-04"). */
export function parseShowDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const text = String(raw).trim();
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Take the first day mentioned in ranges like "March 4-6, 2026".
  const cleaned = text.replace(/(\d{1,2})\s*[–—-]\s*\d{1,2}/, "$1");
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d;
}

type FilterableLead = {
  industry: string | null;
  event_date: string | null;
  lead_score: number;
  priority_tier: string | null;
};

export function filterLeads<T extends FilterableLead>(leads: T[], f: ResultFilterState): T[] {
  const now = Date.now();
  const days = f.window === "all" ? null : Number(f.window);
  return leads.filter((l) => {
    if (f.tier === "qualified" && l.lead_score < 65) return false;
    if (f.tier !== "all" && f.tier !== "qualified" && l.priority_tier !== f.tier) return false;
    if (f.industry !== "all" && (l.industry ?? "Unspecified") !== f.industry) return false;
    if (days != null) {
      const d = parseShowDate(l.event_date);
      if (!d) return false;
      const diff = (d.getTime() - now) / 86_400_000;
      if (diff < -1 || diff > days) return false;
    }
    return true;
  });
}

export function industryOptions(leads: FilterableLead[]): string[] {
  const set = new Set<string>();
  for (const l of leads) set.add(l.industry ?? "Unspecified");
  return [...set].sort((a, b) => a.localeCompare(b));
}

const selectClass =
  "h-9 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

export function ResultFilters({
  value,
  onChange,
  industries,
  shown,
  total,
}: {
  value: ResultFilterState;
  onChange: (next: ResultFilterState) => void;
  industries: string[];
  shown: number;
  total: number;
}) {
  const active = value.window !== "all" || value.tier !== "all" || value.industry !== "all";
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
      <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Filters</span>

      <select
        aria-label="Show date window"
        className={selectClass}
        value={value.window}
        onChange={(e) => onChange({ ...value, window: e.target.value })}
      >
        {WINDOWS.map((w) => (
          <option key={w.value} value={w.value}>{w.label}</option>
        ))}
      </select>

      <select
        aria-label="Qualification tier"
        className={selectClass}
        value={value.tier}
        onChange={(e) => onChange({ ...value, tier: e.target.value })}
      >
        {TIERS.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      <select
        aria-label="Industry"
        className={selectClass}
        value={value.industry}
        onChange={(e) => onChange({ ...value, industry: e.target.value })}
      >
        <option value="all">All industries</option>
        {industries.map((i) => (
          <option key={i} value={i}>{i}</option>
        ))}
      </select>

      {active && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="h-9 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-accent/40"
        >
          Clear
        </button>
      )}

      <span className="ml-auto text-xs text-muted-foreground">
        Showing <span className="font-mono text-foreground">{shown}</span> of{" "}
        <span className="font-mono">{total}</span> leads
      </span>
    </div>
  );
}
