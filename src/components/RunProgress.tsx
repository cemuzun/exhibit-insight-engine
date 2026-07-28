import { useEffect, useState } from "react";

const STAGES = [
  { key: "queued", label: "Queued" },
  { key: "scrape_source", label: "Fetching source" },
  { key: "extract_events", label: "Identifying trade shows" },
  { key: "extract_exhibitors", label: "Extracting exhibitors" },
  { key: "enrich_leads", label: "Enriching & scoring leads" },
  { key: "summarize", label: "Executive summary" },
];

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export function RunProgress({
  stage,
  message,
  createdAt,
  updatedAt,
}: {
  stage: string | null;
  message: string | null;
  createdAt: string;
  updatedAt: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsed = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
  const sinceUpdate = updatedAt
    ? Math.max(0, Math.floor((now - new Date(updatedAt).getTime()) / 1000))
    : null;

  const current = stage ?? "queued";
  let idx = STAGES.findIndex((s) => s.key === current);
  if (idx < 0) idx = 0;
  const pct = Math.round(((idx + 0.5) / STAGES.length) * 100);
  const slow = sinceUpdate !== null && sinceUpdate > 45;

  return (
    <div className="mb-6 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-warning" />
        <div className="flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm font-medium">{STAGES[idx].label}</div>
            <div className="font-mono text-xs text-muted-foreground">
              {fmt(elapsed)} elapsed
              {sinceUpdate !== null && <span> · updated {fmt(sinceUpdate)} ago</span>}
            </div>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{message ?? "Working…"}</div>

          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {STAGES.map((s, i) => (
              <span
                key={s.key}
                className={
                  i < idx
                    ? "text-muted-foreground line-through"
                    : i === idx
                      ? "font-medium text-foreground"
                      : "text-muted-foreground/60"
                }
              >
                {i < idx ? "✓ " : i === idx ? "▸ " : "· "}
                {s.label}
              </span>
            ))}
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground">
            {slow
              ? "This step is taking a while — deep research on large directories can run several minutes. The page updates automatically."
              : "This page refreshes automatically every few seconds. You can safely leave and come back."}
          </p>
        </div>
      </div>
    </div>
  );
}
