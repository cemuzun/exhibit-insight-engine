import { useMemo, useState } from "react";

export type ExhibitorRow = {
  id: string;
  company_name: string;
  company_website: string | null;
  trade_show: string | null;
  event_date: string | null;
  booth_number: string | null;
  booth_type: string | null;
  booth_size_estimate: string | null;
  confidence_level: string | null;
  lead_score: number;
  source_urls: string[];
};

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Picks the URL that most looks like the directory the exhibitor came from. */
function directorySource(urls: string[]) {
  if (!urls?.length) return null;
  const scored = urls
    .map((u) => {
      const l = u.toLowerCase();
      let s = 0;
      if (/exhibitor|directory|floorplan|floor-plan|booth|exhibit/.test(l)) s += 3;
      if (/mapyourshow|expocad|a2zinc|10times|swapcard|eventscribe/.test(l)) s += 2;
      if (l.endsWith(".pdf")) s += 1;
      return { u, s };
    })
    .sort((a, b) => b.s - a.s);
  return scored[0].u;
}

export function ExhibitorsTable({ rows }: { rows: ExhibitorRow[] }) {
  const [query, setQuery] = useState("");
  const [onlyBooth, setOnlyBooth] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, ExhibitorRow[]>();
    for (const r of rows) {
      if (onlyBooth && !r.booth_number) continue;
      if (q && !(`${r.company_name} ${r.trade_show ?? ""} ${r.booth_number ?? ""}`.toLowerCase().includes(q))) continue;
      const key = r.trade_show?.trim() || "Unattributed show";
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([show, list]) => {
        const sources = new Map<string, string>();
        for (const r of list) {
          const src = directorySource(r.source_urls ?? []);
          if (src) sources.set(hostOf(src), src);
        }
        return {
          show,
          list: list.sort((a, b) => a.company_name.localeCompare(b.company_name)),
          sources: [...sources.entries()],
          withBooth: list.filter((r) => r.booth_number).length,
        };
      })
      .sort((a, b) => b.list.length - a.list.length);
  }, [rows, query, onlyBooth]);

  const totalShown = groups.reduce((n, g) => n + g.list.length, 0);
  const totalBooths = groups.reduce((n, g) => n + g.withBooth, 0);

  function exportCsv() {
    const header = [
      "company_name",
      "booth_number",
      "show_name",
      "event_date",
      "booth_type",
      "booth_size_estimate",
      "company_website",
      "confidence_level",
      "lead_score",
      "source_url",
      "all_source_urls",
    ];
    const lines = [header.join(",")];
    for (const g of groups) {
      for (const r of g.list) {
        lines.push(
          [
            r.company_name,
            r.booth_number ?? "",
            g.show,
            r.event_date ?? "",
            r.booth_type ?? "",
            r.booth_size_estimate ?? "",
            r.company_website ?? "",
            r.confidence_level ?? "",
            String(r.lead_score ?? 0),
            directorySource(r.source_urls ?? []) ?? "",
            (r.source_urls ?? []).join(" | "),
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `exhibitors-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }


  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company, show or booth…"
          className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-xs"
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={onlyBooth} onChange={(e) => setOnlyBooth(e.target.checked)} />
          Only with booth number
        </label>
        <button
          type="button"
          onClick={exportCsv}
          disabled={totalShown === 0}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/40 disabled:opacity-50"
        >
          Export CSV
        </button>
        <div className="ml-auto text-xs text-muted-foreground">
          <span className="font-mono text-foreground">{totalShown}</span> exhibitors ·{" "}
          <span className="font-mono text-foreground">{totalBooths}</span> with booth ·{" "}
          <span className="font-mono text-foreground">{groups.length}</span> shows
        </div>
      </div>


      {groups.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No exhibitors extracted yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {groups.map((g) => {
            const isOpen = !collapsed[g.show];
            return (
              <div key={g.show}>
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [g.show]: isOpen }))}
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                >
                  <span className="text-xs text-muted-foreground">{isOpen ? "▾" : "▸"}</span>
                  <span className="text-sm font-medium">{g.show}</span>
                  <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {g.list.length} exhibitors · {g.withBooth} booths
                  </span>
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {g.sources.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground">no source recorded</span>
                    ) : (
                      g.sources.map(([host, url]) => (
                        <a
                          key={host}
                          href={url}
                          target="_blank"
                          rel="noreferrer noopener"
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {host} ↗
                        </a>
                      ))
                    )}
                  </span>
                </button>

                {isOpen && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2 font-medium">Company</th>
                          <th className="px-4 py-2 font-medium">Booth</th>
                          <th className="px-4 py-2 font-medium">Booth type / size</th>
                          <th className="px-4 py-2 font-medium">Confidence</th>
                          <th className="px-4 py-2 font-medium">Source page</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.list.map((r) => {
                          const src = directorySource(r.source_urls ?? []);
                          return (
                            <tr key={r.id} className="border-t border-border/60">
                              <td className="px-4 py-2">
                                {r.company_website ? (
                                  <a href={r.company_website} target="_blank" rel="noreferrer noopener" className="hover:underline">
                                    {r.company_name}
                                  </a>
                                ) : (
                                  r.company_name
                                )}
                              </td>
                              <td className="px-4 py-2 font-mono text-xs">
                                {r.booth_number ?? <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="px-4 py-2 text-xs text-muted-foreground">
                                {[r.booth_type, r.booth_size_estimate].filter(Boolean).join(" · ") || "—"}
                              </td>
                              <td className="px-4 py-2 text-xs text-muted-foreground">{r.confidence_level ?? "—"}</td>
                              <td className="px-4 py-2 text-xs">
                                {src ? (
                                  <a href={src} target="_blank" rel="noreferrer noopener" className="font-mono text-muted-foreground hover:text-foreground">
                                    {hostOf(src)} ↗
                                  </a>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
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
