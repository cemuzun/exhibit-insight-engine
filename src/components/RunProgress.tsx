import { useEffect, useState } from "react";

const STAGES = [
  { key: "queued", label: "Queued" },
  { key: "scrape_source", label: "Fetching source" },
  { key: "extract_events", label: "Identifying trade shows" },
  { key: "extract_exhibitors", label: "Extracting exhibitors" },
  { key: "enrich_leads", label: "Enriching & scoring leads" },
  { key: "summarize", label: "Executive summary" },
];

export type StepEntry = {
  key: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  message: string | null;
};

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

function fmtMs(ms: number) {
  return fmt(Math.max(0, Math.round(ms / 1000)));
}

function labelFor(key: string) {
  return STAGES.find((s) => s.key === key)?.label ?? key;
}

export type RunCounters = {
  discovered?: number;
  filtered_too_soon?: number;
  eligible?: number;
  kept?: number;
  deep_dive_total?: number;
  deep_dive_done?: number;
  exhibitors_found?: number;
  leads_scored?: number;
};

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "muted" }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="font-mono text-lg leading-tight text-foreground">{value}</div>
      <div className={`text-[10px] uppercase tracking-wide ${tone === "muted" ? "text-muted-foreground/70" : "text-muted-foreground"}`}>
        {label}
      </div>
    </div>
  );
}

export function RunProgress({
  stage,
  message,
  createdAt,
  updatedAt,
  stepLog = [],
  counters = {},
  liveEvents = 0,
  liveLeads = 0,
}: {
  stage: string | null;
  message: string | null;
  createdAt: string;
  updatedAt: string | null;
  stepLog?: StepEntry[];
  counters?: RunCounters;
  liveEvents?: number;
  liveLeads?: number;
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

  const totalKnown = stepLog.reduce((a, s) => a + (s.duration_ms ?? 0), 0);

  const discovered = counters.discovered ?? 0;
  const filtered = counters.filtered_too_soon ?? 0;
  const kept = counters.kept ?? liveEvents;
  const ddTotal = counters.deep_dive_total ?? 0;
  const ddDone = counters.deep_dive_done ?? 0;
  const leads = counters.leads_scored ?? liveLeads;
  const exhibitors = counters.exhibitors_found ?? 0;

  // Weighted overall completion: stage position blended with deep-dive progress.
  const stagePct = ((idx + (idx >= 4 && ddTotal > 0 ? ddDone / ddTotal : 0.5)) / STAGES.length) * 100;
  const overall = Math.min(99, Math.max(2, Math.round(stagePct)));

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
              style={{ width: `${overall}%` }}
            />
          </div>
          <div className="mt-1 text-right font-mono text-[10px] text-muted-foreground">{overall}%</div>

          {(discovered > 0 || liveEvents > 0 || liveLeads > 0) && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Shows found" value={discovered || liveEvents} />
              <Stat label="Skipped (too soon)" value={filtered} tone="muted" />
              <Stat label="Shows kept" value={kept} />
              <Stat
                label="Deep-dived"
                value={ddTotal > 0 ? `${ddDone}/${ddTotal}` : ddDone}
              />
              <Stat label="Leads scored" value={leads} />
            </div>
          )}
          {exhibitors > 0 && (
            <div className="mt-2 text-[11px] text-muted-foreground">
              {exhibitors} exhibitor{exhibitors === 1 ? "" : "s"} queued for scoring · {leads} scored so far
            </div>
          )}

          {stepLog.length > 0 ? (
            <ul className="mt-4 space-y-1.5">
              {stepLog.map((s, i) => {
                const running = !s.ended_at;
                const ms = s.duration_ms ?? now - new Date(s.started_at).getTime();
                const share = totalKnown > 0 && s.duration_ms ? Math.round((s.duration_ms / totalKnown) * 100) : null;
                return (
                  <li key={`${s.key}-${i}`} className="flex items-baseline gap-2 text-[11px]">
                    <span className={running ? "text-primary" : "text-muted-foreground"}>
                      {running ? "▸" : "✓"}
                    </span>
                    <span className={running ? "font-medium text-foreground" : "text-muted-foreground"}>
                      {labelFor(s.key)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
                      {s.message ?? ""}
                    </span>
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {fmtMs(ms)}
                      {share !== null && <span className="text-muted-foreground/60"> · {share}%</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
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
          )}

          <p className="mt-3 text-[11px] text-muted-foreground">
            {slow
              ? "This step is taking a while — deep research on large directories can run several minutes. The page updates automatically."
              : "This page updates live as each step completes. You can safely leave and come back."}
          </p>
        </div>
      </div>
    </div>
  );
}

export function RunTimings({ stepLog }: { stepLog: StepEntry[] }) {
  const total = stepLog.reduce((a, s) => a + (s.duration_ms ?? 0), 0);
  return (
    <div className="mb-6 rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-medium">Step timings</div>
        <div className="font-mono text-xs text-muted-foreground">{fmtMs(total)} total</div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {stepLog.map((s, i) => {
          const ms = s.duration_ms ?? 0;
          const share = total > 0 ? Math.round((ms / total) * 100) : 0;
          return (
            <li key={`${s.key}-${i}`} className="text-[11px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{labelFor(s.key)}</span>
                <span className="shrink-0 font-mono text-muted-foreground">
                  {fmtMs(ms)} · {share}%
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${share}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
