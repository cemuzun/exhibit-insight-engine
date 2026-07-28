export interface ExhibitorSample {
  company: string;
  booth: string | null;
  show: string;
  source: string;
  at: string;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/**
 * Live list of exhibitors as they are extracted, shown while a run is still
 * working so progress is visible before scoring produces ranked leads.
 */
export function LiveExhibitors({
  samples,
  total,
  lastUpdated,
}: {
  samples: ExhibitorSample[];
  total: number;
  lastUpdated?: string | null;
}) {
  if (samples.length === 0) return null;

  return (
    <section className="mb-6 rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Exhibitors found so far
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] text-success">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
            </span>
            Live
            {lastUpdated && <span className="text-success/80">· updated {ago(lastUpdated)}</span>}
          </span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          showing {samples.length} of {total}
        </span>
      </header>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b border-border bg-card text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-3">Company</th>
              <th className="p-3">Booth</th>
              <th className="p-3">Trade show</th>
              <th className="p-3">Source</th>
              <th className="p-3">Found</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((s, i) => (
              <tr key={`${s.company}-${s.at}-${i}`} className="border-b border-border/50 last:border-0">
                <td className="p-3 font-medium">{s.company}</td>
                <td className="p-3 font-mono text-xs text-muted-foreground">{s.booth ?? "—"}</td>
                <td className="p-3 text-xs text-muted-foreground">{s.show}</td>
                <td className="p-3 text-xs">
                  <a
                    href={s.source}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {hostOf(s.source)}
                  </a>
                </td>
                <td className="p-3 font-mono text-xs text-muted-foreground">{ago(s.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
