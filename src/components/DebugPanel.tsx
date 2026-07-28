import { useMemo, useState } from "react";

export type ShowDebugEntry = {
  show: string;
  official_url: string | null;
  candidates: number;
  accepted: string[];
  rejected: Array<{ url: string; reason: string }>;
  pages: Array<{ url: string; added: number }>;
  exhibitors: number;
  skip_reason: string | null;
};

function shortUrl(url: string) {
  try {
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`;
    return `${u.host.replace(/^www\./, "")}${path.length > 46 ? `${path.slice(0, 46)}…` : path}`;
  } catch {
    return url;
  }
}

export function DebugPanel({
  shows,
  skipReasons,
}: {
  shows: ShowDebugEntry[];
  skipReasons: Array<{ at: string; show?: string; reason: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [onlyProblems, setOnlyProblems] = useState(false);

  const rows = useMemo(() => {
    const list = onlyProblems ? shows.filter((s) => s.exhibitors === 0 || s.skip_reason) : shows;
    return [...list].sort((a, b) => a.exhibitors - b.exhibitors);
  }, [shows, onlyProblems]);

  const totals = useMemo(
    () => ({
      shows: shows.length,
      empty: shows.filter((s) => s.exhibitors === 0).length,
      pages: shows.reduce((n, s) => n + s.pages.length, 0),
      rejected: shows.reduce((n, s) => n + s.rejected.length, 0),
      exhibitors: shows.reduce((n, s) => n + s.exhibitors, 0),
    }),
    [shows],
  );

  if (shows.length === 0 && skipReasons.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
      >
        <span className="text-xs text-muted-foreground">{open ? "▾" : "▸"}</span>
        <span className="text-sm font-medium">Extraction debug</span>
        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {totals.shows} shows · {totals.empty} with 0 exhibitors · {totals.pages} pages parsed ·{" "}
          {totals.rejected} URLs filtered
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {totals.exhibitors} exhibitors extracted
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-border p-4">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyProblems}
              onChange={(e) => setOnlyProblems(e.target.checked)}
            />
            Only shows with problems
          </label>

          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No per-show diagnostics recorded yet.</p>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border">
              {rows.map((s) => {
                const isOpen = !!expanded[s.show];
                return (
                  <div key={s.show}>
                    <button
                      onClick={() => setExpanded((e) => ({ ...e, [s.show]: !isOpen }))}
                      className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
                    >
                      <span className="text-xs text-muted-foreground">{isOpen ? "▾" : "▸"}</span>
                      <span className="text-xs font-medium">{s.show}</span>
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                          s.exhibitors > 0
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border bg-muted text-muted-foreground"
                        }`}
                      >
                        {s.exhibitors} exhibitors
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {s.candidates} candidates · {s.accepted.length} accepted · {s.rejected.length}{" "}
                        filtered · {s.pages.length} pages
                      </span>
                      {s.skip_reason && (
                        <span className="ml-auto max-w-full truncate text-[10px] text-destructive">
                          {s.skip_reason}
                        </span>
                      )}
                    </button>

                    {isOpen && (
                      <div className="space-y-3 bg-muted/20 px-3 py-3 text-[11px]">
                        {s.official_url && (
                          <div className="font-mono text-muted-foreground">
                            source:{" "}
                            <a
                              href={s.official_url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="hover:text-foreground"
                            >
                              {shortUrl(s.official_url)} ↗
                            </a>
                          </div>
                        )}

                        <div>
                          <p className="mb-1 font-medium">Pages parsed ({s.pages.length})</p>
                          {s.pages.length === 0 ? (
                            <p className="text-muted-foreground">No page was parsed for this show.</p>
                          ) : (
                            <ul className="space-y-1">
                              {s.pages.map((p, i) => (
                                <li key={`${p.url}-${i}`} className="flex items-start gap-2 font-mono">
                                  <span
                                    className={
                                      p.added > 0 ? "text-primary" : "text-muted-foreground"
                                    }
                                  >
                                    +{p.added}
                                  </span>
                                  <a
                                    href={p.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="break-all text-muted-foreground hover:text-foreground"
                                  >
                                    {shortUrl(p.url)}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div>
                          <p className="mb-1 font-medium">Filtered / rejected URLs ({s.rejected.length})</p>
                          {s.rejected.length === 0 ? (
                            <p className="text-muted-foreground">Nothing was filtered out.</p>
                          ) : (
                            <ul className="space-y-1">
                              {s.rejected.map((r, i) => (
                                <li key={`${r.url}-${i}`} className="font-mono text-muted-foreground">
                                  <span className="break-all">{shortUrl(r.url)}</span>
                                  <span className="ml-2 not-italic text-muted-foreground/80">
                                    — {r.reason}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {skipReasons.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium">Recent skip reasons</p>
              <ul className="space-y-1">
                {skipReasons.slice(0, 20).map((e, i) => (
                  <li key={`${e.at}-${i}`} className="text-[11px] text-muted-foreground">
                    <span className="font-mono">{new Date(e.at).toLocaleTimeString()}</span>
                    {e.show ? ` · ${e.show}` : ""} — {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
