import { useMemo, useState } from "react";

export type ExplorerLead = {
  id: string;
  company_name: string;
  company_website: string | null;
  trade_show: string | null;
  event_date: string | null;
  booth_number: string | null;
  industry: string | null;
  lead_score: number;
  priority_tier: string | null;
  estimated_project_value_low: number | null;
  estimated_project_value_high: number | null;
  decision_makers: Array<{ name?: string | null; title?: string | null; email?: string | null }>;
  source_urls: string[];
};

export type ExplorerEvent = {
  id: string;
  event_name: string;
  event_opportunity_score: number | null;
  recommended_outreach_phase: string | null;
  city: string | null;
  start_date: string | null;
  official_url?: string | null;
};

function csvCell(v: string) {
  const s = v ?? "";
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name: string, lines: string[]) {
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const HEADER = [
  "trade_show",
  "event_date",
  "city",
  "company_name",
  "booth_number",
  "industry",
  "lead_score",
  "priority_tier",
  "est_value_low",
  "est_value_high",
  "primary_contact",
  "primary_contact_title",
  "primary_contact_email",
  "company_website",
  "source_url",
];

function rowsFor(show: string, city: string | null, leads: ExplorerLead[]) {
  return leads.map((l) => {
    const dm = l.decision_makers?.[0];
    return [
      show,
      l.event_date ?? "",
      city ?? "",
      l.company_name,
      l.booth_number ?? "",
      l.industry ?? "",
      String(l.lead_score ?? 0),
      l.priority_tier ?? "",
      l.estimated_project_value_low != null ? String(l.estimated_project_value_low) : "",
      l.estimated_project_value_high != null ? String(l.estimated_project_value_high) : "",
      dm?.name ?? "",
      dm?.title ?? "",
      dm?.email ?? "",
      l.company_website ?? "",
      l.source_urls?.[0] ?? "",
    ]
      .map(csvCell)
      .join(",");
  });
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "show";
}

function tierTone(t?: string | null) {
  if (t === "TIER_1_IMMEDIATE") return "border-tier-1/40 bg-tier-1/10 text-tier-1";
  if (t === "TIER_2_HIGH_PRIORITY") return "border-tier-2/40 bg-tier-2/10 text-tier-2";
  return "border-border bg-muted/40 text-muted-foreground";
}

export function ShowsExplorer({
  events,
  leads,
  onSelect,
}: {
  events: ExplorerEvent[];
  leads: ExplorerLead[];
  onSelect: (l: ExplorerLead) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<"exhibitors" | "score" | "date" | "name">("exhibitors");

  const shows = useMemo(() => {
    const byShow = new Map<string, ExplorerLead[]>();
    for (const l of leads) {
      const key = l.trade_show?.trim() || "Unattributed show";
      const list = byShow.get(key) ?? [];
      list.push(l);
      byShow.set(key, list);
    }
    const eventByName = new Map(events.map((e) => [e.event_name.trim().toLowerCase(), e]));

    const keys = new Set<string>([...byShow.keys(), ...events.map((e) => e.event_name.trim())]);
    const out = [...keys].map((show) => {
      const list = (byShow.get(show) ?? []).sort((a, b) => b.lead_score - a.lead_score);
      const ev = eventByName.get(show.toLowerCase()) ?? null;
      return {
        show,
        ev,
        list,
        tier1: list.filter((l) => l.priority_tier === "TIER_1_IMMEDIATE").length,
        qualified: list.filter((l) => l.lead_score >= 50).length,
        booths: list.filter((l) => l.booth_number).length,
      };
    });

    const q = query.trim().toLowerCase();
    const filtered = q
      ? out
          .map((g) => ({
            ...g,
            list: g.show.toLowerCase().includes(q)
              ? g.list
              : g.list.filter((l) => l.company_name.toLowerCase().includes(q)),
          }))
          .filter((g) => g.show.toLowerCase().includes(q) || g.list.length > 0)
      : out;

    return filtered.sort((a, b) => {
      if (sort === "name") return a.show.localeCompare(b.show);
      if (sort === "score") return (b.ev?.event_opportunity_score ?? 0) - (a.ev?.event_opportunity_score ?? 0);
      if (sort === "date") return (a.ev?.start_date ?? "9999").localeCompare(b.ev?.start_date ?? "9999");
      return b.list.length - a.list.length;
    });
  }, [events, leads, query, sort]);

  const totalExhibitors = shows.reduce((n, g) => n + g.list.length, 0);

  function exportAll() {
    const lines = [HEADER.join(",")];
    for (const g of shows) lines.push(...rowsFor(g.show, g.ev?.city ?? null, g.list));
    download(`trade-shows-${new Date().toISOString().slice(0, 10)}.csv`, lines);
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Trade shows</h2>
        <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          {shows.length} shows · {totalExhibitors} exhibitors
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search trade show or company…"
            className="w-72 rounded-md border border-border bg-background px-3 py-1.5 text-xs"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="exhibitors">Most exhibitors</option>
            <option value="score">Event score</option>
            <option value="date">Soonest date</option>
            <option value="name">Name A–Z</option>
          </select>
          <button
            type="button"
            onClick={() => setOpen(Object.fromEntries(shows.map((g) => [g.show, true])))}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/40"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => setOpen({})}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/40"
          >
            Collapse
          </button>
          <button
            type="button"
            onClick={exportAll}
            disabled={totalExhibitors === 0}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Export all CSV
          </button>
        </div>
      </div>

      {shows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No trade shows match “{query}”.
        </div>
      ) : (
        <div className="space-y-2">
          {shows.map((g) => {
            const isOpen = !!open[g.show];
            return (
              <div key={g.show} className="overflow-hidden rounded-lg border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [g.show]: !isOpen }))}
                  className="flex w-full flex-wrap items-center gap-3 p-4 text-left transition-colors hover:bg-accent/30"
                >
                  <span className={`text-xs text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{g.show}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {g.ev?.start_date && <span>{g.ev.start_date}</span>}
                      {g.ev?.city && <span>· {g.ev.city}</span>}
                      {g.ev?.recommended_outreach_phase && <span>· {g.ev.recommended_outreach_phase.replace(/_/g, " ").toLowerCase()}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    {g.ev?.event_opportunity_score != null && (
                      <span className="rounded border border-border px-2 py-0.5 font-mono text-muted-foreground">
                        event {g.ev.event_opportunity_score}
                      </span>
                    )}
                    <span className="rounded border border-border px-2 py-0.5 font-mono text-foreground">
                      {g.list.length} exhibitors
                    </span>
                    <span className="rounded border border-border px-2 py-0.5 font-mono text-muted-foreground">
                      {g.booths} booths
                    </span>
                    {g.tier1 > 0 && (
                      <span className="rounded border border-tier-1/40 bg-tier-1/10 px-2 py-0.5 font-mono text-tier-1">
                        {g.tier1} tier 1
                      </span>
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        download(`${slug(g.show)}-exhibitors.csv`, [HEADER.join(","), ...rowsFor(g.show, g.ev?.city ?? null, g.list)]);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    >
                      Export
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border">
                    {g.list.length === 0 ? (
                      <p className="p-6 text-center text-xs text-muted-foreground">No exhibitors extracted for this show yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                            <tr>
                              <th className="px-4 py-2 font-medium">Company</th>
                              <th className="px-4 py-2 font-medium">Booth</th>
                              <th className="px-4 py-2 font-medium">Industry</th>
                              <th className="px-4 py-2 font-medium">Score</th>
                              <th className="px-4 py-2 font-medium">Tier</th>
                              <th className="px-4 py-2 font-medium">Contact</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.list.map((l) => {
                              const dm = l.decision_makers?.[0];
                              return (
                                <tr
                                  key={l.id}
                                  onClick={() => onSelect(l)}
                                  className="cursor-pointer border-t border-border/60 hover:bg-accent/30"
                                >
                                  <td className="px-4 py-2 font-medium">{l.company_name}</td>
                                  <td className="px-4 py-2 font-mono text-xs">
                                    {l.booth_number ?? <span className="text-muted-foreground">—</span>}
                                  </td>
                                  <td className="px-4 py-2 text-xs text-muted-foreground">{l.industry ?? "—"}</td>
                                  <td className="px-4 py-2">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-xs">{l.lead_score}</span>
                                      <span className="h-1 w-14 overflow-hidden rounded-full bg-muted">
                                        <span className="block h-full bg-primary" style={{ width: `${l.lead_score}%` }} />
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-2">
                                    <span className={`inline-block rounded border px-2 py-0.5 font-mono text-[11px] ${tierTone(l.priority_tier)}`}>
                                      {(l.priority_tier ?? "—").replace("TIER_", "T").replace(/_.*/, "")}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 text-xs text-muted-foreground">
                                    {dm?.name ?? dm?.title ?? "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
