import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getRun, rerunResearch, resumeStalledRun } from "@/lib/research.functions";
import { syncRunToCrm } from "@/lib/crm.functions";
import { CrmSyncPreview } from "@/components/CrmSyncPreview";
import { RunProgress, RunTimings, type StepEntry, type RunCounters } from "@/components/RunProgress";
import { ScoringFeed, type ScoringFeedEntry } from "@/components/ScoringFeed";
import { ExhibitorsTable, type ExhibitorRow } from "@/components/ExhibitorsTable";
import {
  ResultFilters,
  DEFAULT_FILTERS,
  filterLeads,
  industryOptions,
  parseShowDate,
  type ResultFilterState,
} from "@/components/ResultFilters";

import { listEmailTemplates } from "@/lib/templates.functions";
import { renderForLead, type EmailTemplate } from "@/lib/email-template-engine";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/runs/$runId")({
  head: () => ({ meta: [{ title: "Run — BoothLens" }, { name: "robots", content: "noindex" }] }),
  component: RunDetail,
});

type Lead = {
  id: string;
  company_name: string;
  industry: string | null;
  trade_show: string | null;
  event_date: string | null;
  lead_score: number;
  priority_tier: string | null;
  estimated_project_value_low: number | null;
  estimated_project_value_high: number | null;
  recommended_services: string[];
  booth_type: string | null;
  booth_size_estimate: string | null;
  booth_analysis_confidence: number | null;
  score_breakdown: Record<string, number> | null;
  decision_makers: Array<{
    name: string | null;
    title: string;
    role_classification: string;
    contact_confidence: number;
    evidence_status: string;
    relevance_explanation: string;
    professional_profile_url: string | null;
    public_business_email: string | null;
  }>;
  recommended_outreach_date: string | null;
  recommended_next_action: string | null;
  personalized_email: string | null;
  linkedin_message: string | null;
  confidence_level: string | null;
  unknown_fields: string[];
  source_urls: string[];
  booth_number: string | null;
  company_website: string | null;
  raw: unknown;
};

function tierColor(t: string | null) {
  if (t === "TIER_1_IMMEDIATE") return "bg-tier-1/20 text-tier-1 border-tier-1/40";
  if (t === "TIER_2_HIGH_PRIORITY") return "bg-tier-2/20 text-tier-2 border-tier-2/40";
  if (t === "TIER_3_NURTURE") return "bg-tier-3/20 text-tier-3 border-tier-3/40";
  return "bg-muted text-muted-foreground border-border";
}

function tierLabel(t: string | null) {
  if (t === "TIER_1_IMMEDIATE") return "T1";
  if (t === "TIER_2_HIGH_PRIORITY") return "T2";
  if (t === "TIER_3_NURTURE") return "T3";
  return "T4";
}

function RunDetail() {
  const { runId } = Route.useParams();
  const get = useServerFn(getRun);
  const [mode, setMode] = useState<"dashboard" | "exhibitors" | "report">("dashboard");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [filters, setFilters] = useState<ResultFilterState>(DEFAULT_FILTERS);
  const resume = useServerFn(resumeStalledRun);

  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => get({ data: { runId } }),
    refetchInterval: (q) => {
      const s = q.state.data?.run?.status;
      return s === "complete" || s === "failed" ? false : 3000;
    },
  });

  // A run executes inside one server request; if that process is recycled the
  // pipeline stops silently. When the heartbeat goes quiet, ask the server to
  // pick the run back up instead of letting it sit until the stall guard fires.
  const runStatus = data?.run?.status;
  const runUpdatedAt = data?.run?.updated_at;
  const resumeAttempted = useRef<string | null>(null);
  useEffect(() => {
    if (!runUpdatedAt || runStatus === "complete" || runStatus === "failed") return;
    const check = () => {
      const quietMs = Date.now() - new Date(runUpdatedAt).getTime();
      if (quietMs < 100_000) return;
      if (resumeAttempted.current === runUpdatedAt) return;
      resumeAttempted.current = runUpdatedAt;
      resume({ data: { runId } })
        .then((r) => {
          if (r && "resumed" in r && r.resumed) toast.info("Run was interrupted — restarted automatically.");
        })
        .catch(() => {})
        .finally(() => queryClient.invalidateQueries({ queryKey: ["run", runId] }));
    };
    check();
    const t = setInterval(check, 15_000);
    return () => clearInterval(t);
  }, [runId, runStatus, runUpdatedAt, resume, queryClient]);

  // Live push updates for step-by-step progress and for results as they land.
  useEffect(() => {
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["run", runId] });
    const channel = supabase
      .channel(`run-${runId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "research_runs", filter: `id=eq.${runId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events", filter: `run_id=eq.${runId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `run_id=eq.${runId}` },
        invalidate,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [runId, queryClient]);



  if (isLoading || !data) return <main className="mx-auto max-w-7xl px-6 py-8"><p className="text-sm text-muted-foreground">Loading…</p></main>;

  if (!data.run) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <Link to="/dashboard" className="text-xs text-muted-foreground hover:text-foreground">← All runs</Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Run not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This research run no longer exists — it may have been deleted.
        </p>
      </main>
    );
  }

  const { run, events, leads } = data;
  const allLeads = leads as unknown as Lead[];
  // Filters run on the client so results keep narrowing live as rows stream in.
  const typedLeads = filterLeads(allLeads, filters);
  const industries = industryOptions(allLeads);
  const windowDays = filters.window === "all" ? null : Number(filters.window);
  const visibleEvents = events.filter((e: any) => {
    if (filters.industry !== "all" && ((e as { industry?: string | null }).industry ?? "Unspecified") !== filters.industry) return false;
    if (windowDays == null) return true;
    const d = parseShowDate(e.start_date);
    if (!d) return false;
    const diff = (d.getTime() - Date.now()) / 86_400_000;
    return diff >= -1 && diff <= windowDays;
  });
  const es = (run.executive_summary ?? null) as {
    shows_reviewed?: number;
    exhibitors_identified?: number;
    qualified_accounts?: number;
    verified_decision_makers?: number;
    tier_1_leads?: number;
    top_industries?: string[];
    top_shows?: string[];
    main_limitations?: string[];
    recommended_immediate_action?: string;
  } | null;

  const inProgress = run.status !== "complete" && run.status !== "failed";

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-6">
        <div>
          <Link to="/dashboard" className="text-xs text-muted-foreground hover:text-foreground">← All runs</Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight break-all">{run.input_url}</h1>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono uppercase">{run.status}</span>
            <span>{new Date(run.created_at).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!inProgress && (
            <>
              <RerunButton runId={runId} />
              <Link
                to="/outreach/$runId"
                params={{ runId }}
                className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
              >
                Outreach queue
              </Link>
              <CrmSyncPreview runId={runId} disabled={typedLeads.length === 0} />
              <CrmSyncButton runId={runId} disabled={typedLeads.length === 0} />
            </>
          )}
          <div className="flex rounded-md border border-border bg-card p-1 text-xs">
            <button onClick={() => setMode("dashboard")} className={`rounded px-3 py-1.5 ${mode === "dashboard" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Dashboard</button>
            <button onClick={() => setMode("exhibitors")} className={`rounded px-3 py-1.5 ${mode === "exhibitors" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Exhibitors</button>
            <button onClick={() => setMode("report")} className={`rounded px-3 py-1.5 ${mode === "report" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Report</button>
          </div>
        </div>
      </div>

      {inProgress && (
        <RunProgress
          stage={run.stage ?? null}
          message={run.progress_message ?? null}
          createdAt={run.created_at}
          updatedAt={(run as { updated_at?: string }).updated_at ?? null}
          stepLog={((run as { step_log?: unknown }).step_log ?? []) as StepEntry[]}
          counters={((run as { counters?: unknown }).counters ?? {}) as RunCounters}
          liveEvents={events.length}
          liveLeads={typedLeads.length}
        />
      )}

      {inProgress && (
        <ScoringFeed
          entries={
            (((run as { counters?: { scoring_feed?: unknown } }).counters?.scoring_feed ?? []) as ScoringFeedEntry[])
          }
        />
      )}

      <div className="mb-6">
        <DebugPanel
          shows={
            (((run as { counters?: { show_debug?: unknown } }).counters?.show_debug ?? []) as ShowDebugEntry[])
          }
          skipReasons={(
            ((run as { counters?: { scoring_feed?: unknown } }).counters?.scoring_feed ?? []) as ScoringFeedEntry[]
          )
            .filter((e) => e.status === "skipped")
            .map((e) => ({ at: e.at, show: e.show, reason: e.reason }))}
        />
      </div>


      {!inProgress && (((run as { step_log?: unknown[] }).step_log ?? []) as StepEntry[]).length > 0 && (
        <RunTimings stepLog={((run as { step_log?: unknown }).step_log ?? []) as StepEntry[]} />
      )}



      {run.status === "failed" && (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <div className="text-sm font-medium text-destructive">Run failed</div>
          <div className="mt-1 text-xs">{run.error_message ?? "Unknown error"}</div>
        </div>
      )}

      <ResultFilters
        value={filters}
        onChange={setFilters}
        industries={industries}
        shown={typedLeads.length}
        total={allLeads.length}
      />

      {mode === "dashboard" ? (
        <DashboardView run={run} events={visibleEvents} leads={typedLeads} es={es} onSelect={setSelected} />
      ) : mode === "exhibitors" ? (
        <ExhibitorsTable rows={typedLeads as unknown as ExhibitorRow[]} />
      ) : (
        <ReportView run={run} events={visibleEvents} leads={typedLeads} es={es} />
      )}

      {selected && <LeadDrawer lead={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

function RerunButton({ runId }: { runId: string }) {
  const rerun = useServerFn(rerunResearch);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!window.confirm("Re-run this research? Existing events and leads for this run will be replaced.")) return;
    setBusy(true);
    try {
      await rerun({ data: { runId } });
      toast.success("Re-run complete");
    } catch (e) {
      toast.error((e as Error).message || "Re-run failed");
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["run", runId] });
    }
  }

  return (
    <button
      onClick={go}
      disabled={busy}
      className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
      title="Run the research pipeline again for this URL, replacing existing results"
    >
      {busy ? "Re-running…" : "Re-run"}
    </button>
  );
}

function CrmSyncButton({ runId, disabled }: { runId: string; disabled?: boolean }) {
  const sync = useServerFn(syncRunToCrm);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await sync({ data: { runId, minScore: 50 } });
      toast.success(
        `CRM sync complete — ${r.companiesCreated} companies, ${r.contactsCreated} contacts created; ${r.skipped} skipped${r.failed ? `, ${r.failed} failed` : ""}.`,
      );
    } catch (e) {
      toast.error((e as Error).message || "CRM sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={run}
      disabled={busy || disabled}
      className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
      title="Push qualified leads (score ≥ 50) and evidence-verified decision-maker contacts to HubSpot"
    >
      {busy ? "Syncing to CRM…" : "Sync to CRM"}
    </button>
  );
}

function DashboardView({
  events,
  leads,
  es,
  onSelect,
}: {
  run: unknown;
  events: Array<{ id: string; event_name: string; event_opportunity_score: number | null; recommended_outreach_phase: string | null; city: string | null; start_date: string | null }>;
  leads: Lead[];
  es: { shows_reviewed?: number; exhibitors_identified?: number; qualified_accounts?: number; verified_decision_makers?: number; tier_1_leads?: number; top_industries?: string[]; main_limitations?: string[]; recommended_immediate_action?: string } | null;
  onSelect: (l: Lead) => void;
}) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-5">
        <Stat label="Shows reviewed" value={es?.shows_reviewed ?? events.length} />
        <Stat label="Exhibitors" value={es?.exhibitors_identified ?? leads.length} />
        <Stat label="Qualified" value={es?.qualified_accounts ?? leads.filter(l => l.lead_score >= 50).length} />
        <Stat label="Verified DMs" value={es?.verified_decision_makers ?? 0} />
        <Stat label="Tier 1" value={es?.tier_1_leads ?? leads.filter(l => l.priority_tier === "TIER_1_IMMEDIATE").length} accent />
      </div>

      {es?.recommended_immediate_action && (
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm">
          <div className="text-xs font-mono uppercase text-primary">Recommended next action</div>
          <div className="mt-1">{es.recommended_immediate_action}</div>
        </div>
      )}

      {(es?.main_limitations && es.main_limitations.length > 0) && (
        <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <div className="text-xs font-mono uppercase text-warning">Data limitations — review before outreach</div>
          <ul className="mt-2 list-disc pl-5 text-xs space-y-1">
            {es.main_limitations.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Ranked opportunities</h2>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-3">Rank</th>
              <th className="p-3">Company</th>
              <th className="p-3">Trade show</th>
              <th className="p-3">Industry</th>
              <th className="p-3">Score</th>
              <th className="p-3">Tier</th>
              <th className="p-3">Est. value</th>
              <th className="p-3">Contact</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No leads yet.</td></tr>
            ) : leads.map((l, i) => {
              const primary = l.decision_makers[0];
              return (
                <tr key={l.id} onClick={() => onSelect(l)} className="border-b border-border last:border-0 cursor-pointer hover:bg-accent/30">
                  <td className="p-3 font-mono text-xs text-muted-foreground">{i + 1}</td>
                  <td className="p-3 font-medium">{l.company_name}</td>
                  <td className="p-3 text-muted-foreground">{l.trade_show}</td>
                  <td className="p-3 text-muted-foreground">{l.industry ?? "—"}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-sm">{l.lead_score}</div>
                      <div className="h-1 w-16 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${l.lead_score}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <span className={`inline-block rounded border px-2 py-0.5 font-mono text-xs ${tierColor(l.priority_tier)}`}>{tierLabel(l.priority_tier)}</span>
                  </td>
                  <td className="p-3 font-mono text-xs text-muted-foreground">
                    {l.estimated_project_value_low ? `$${(l.estimated_project_value_low/1000).toFixed(0)}k–$${((l.estimated_project_value_high ?? 0)/1000).toFixed(0)}k` : "—"}
                  </td>
                  <td className="p-3 text-xs">
                    {primary ? (
                      <div>
                        <div>{primary.name ?? <span className="italic text-muted-foreground">{primary.title}</span>}</div>
                        <div className="font-mono text-muted-foreground">{primary.contact_confidence}%</div>
                      </div>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${accent ? "border-primary/40 bg-primary/10" : "border-border bg-card"}`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-2xl ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

function LeadDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [tab, setTab] = useState<"overview" | "booth" | "dm" | "outreach" | "sources" | "json">("overview");
  const listTemplates = useServerFn(listEmailTemplates);
  const { data: templates } = useQuery({ queryKey: ["email-templates"], queryFn: () => listTemplates() });
  const templated = useMemo(
    () => (templates ? renderForLead(templates as EmailTemplate[], lead) : null),
    [templates, lead],
  );
  const copyJson = () => { navigator.clipboard.writeText(JSON.stringify(lead.raw, null, 2)); toast.success("Copied to clipboard"); };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl overflow-y-auto border-l border-border bg-card p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className={`inline-block rounded border px-2 py-0.5 font-mono text-xs ${tierColor(lead.priority_tier)}`}>{tierLabel(lead.priority_tier)}</span>
              <span className="font-mono text-sm">{lead.lead_score}/100</span>
              <span className="text-xs text-muted-foreground">· {lead.confidence_level} confidence</span>
            </div>
            <h2 className="mt-2 text-xl font-semibold">{lead.company_name}</h2>
            <div className="mt-1 text-xs text-muted-foreground">{lead.trade_show} · {lead.event_date ?? ""}</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="mt-6 flex flex-wrap gap-1 border-b border-border text-xs">
          {(["overview","booth","dm","outreach","sources","json"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 -mb-px border-b-2 ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {({ overview: "Overview", booth: "Booth & services", dm: "Decision makers", outreach: "Outreach", sources: "Sources", json: "JSON" } as const)[t]}
            </button>
          ))}
        </div>

        <div className="mt-4 text-sm">
          {tab === "overview" && (
            <div className="space-y-4">
              <KV label="Industry" value={lead.industry} />
              <KV label="Website" value={lead.company_website} />
              <KV label="Booth #" value={lead.booth_number} />
              <KV label="Estimated project value" value={lead.estimated_project_value_low ? `$${lead.estimated_project_value_low.toLocaleString()} – $${(lead.estimated_project_value_high ?? 0).toLocaleString()} (estimate)` : null} />
              <KV label="Recommended services" value={lead.recommended_services.join(", ")} />
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Score breakdown</div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {lead.score_breakdown && Object.entries(lead.score_breakdown).map(([k, v]) => (
                    <div key={k} className="rounded border border-border bg-background p-2 text-xs">
                      <div className="text-muted-foreground">{k.replace(/_/g, " ")}</div>
                      <div className="mt-0.5 font-mono">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
              {lead.unknown_fields.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-warning">Unknown / not verified</div>
                  <div className="mt-1 text-xs text-muted-foreground">{lead.unknown_fields.join(" · ")}</div>
                </div>
              )}
            </div>
          )}
          {tab === "booth" && (
            <div className="space-y-3">
              <KV label="Booth type" value={lead.booth_type} />
              <KV label="Booth size" value={lead.booth_size_estimate} />
              <KV label="Analysis confidence" value={`${lead.booth_analysis_confidence ?? 0}%`} />
              <KV label="Services to offer" value={lead.recommended_services.join(", ")} />
              <p className="mt-2 rounded border border-border bg-background p-3 text-xs text-muted-foreground">
                All booth observations are estimates based on public source material unless a photograph or vendor case study confirms them.
              </p>
            </div>
          )}
          {tab === "dm" && (
            <div className="space-y-3">
              {lead.decision_makers.length === 0 && <p className="text-muted-foreground">No decision makers identified.</p>}
              {lead.decision_makers.map((dm, i) => (
                <div key={i} className="rounded border border-border bg-background p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      {dm.name ? (
                        <div className="font-medium">{dm.name}</div>
                      ) : (
                        <div className="font-medium italic text-muted-foreground">Recommended target</div>
                      )}
                      <div className="text-xs text-muted-foreground">{dm.title}</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono text-xs ${dm.contact_confidence >= 70 ? "text-success" : "text-warning"}`}>{dm.contact_confidence}%</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{dm.role_classification} · {dm.evidence_status}</div>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{dm.relevance_explanation}</p>
                  {dm.contact_confidence >= 70 && dm.evidence_status === "CONFIRMED" && (
                    <div className="mt-2 flex gap-3 text-xs">
                      {dm.professional_profile_url && <a href={dm.professional_profile_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Profile</a>}
                      {dm.public_business_email && <a href={`mailto:${dm.public_business_email}`} className="text-primary hover:underline">{dm.public_business_email}</a>}
                    </div>
                  )}
                  {dm.contact_confidence < 70 && (
                    <div className="mt-2 rounded bg-warning/10 p-2 text-xs text-warning">
                      Person not verified. Search LinkedIn for this title at {lead.company_name} before contacting.
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {tab === "outreach" && (
            <div className="space-y-4">
              <div className="rounded border border-warning/40 bg-warning/10 p-3 text-xs">
                Review before sending. All drafts are prepared for human review — do not send without verifying the recipient and personalization.
              </div>
              {lead.recommended_next_action && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Recommended next action</div>
                  <div className="mt-1">{lead.recommended_next_action}</div>
                </div>
              )}
              {lead.recommended_outreach_date && (
                <KV label="Recommended outreach date" value={lead.recommended_outreach_date} />
              )}
              {templated && (
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      Your template — {templated.template.name}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        evidence {templated.evidence}
                      </span>
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={() => {
                          navigator.clipboard.writeText(`Subject: ${templated.subject}\n\n${templated.body}`);
                          toast.success("Template draft copied");
                        }}
                      >
                        Copy
                      </button>
                      <Link to="/templates" className="text-xs text-primary hover:underline">Edit</Link>
                    </div>
                  </div>
                  <div className="mt-1 text-sm font-medium">{templated.subject}</div>
                  <pre className="mt-1 whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs font-sans">{templated.body}</pre>
                  {templated.missing.length > 0 && (
                    <p className="mt-1 text-xs text-warning">
                      Unverified fields left as placeholders: {templated.missing.join(", ")}
                    </p>
                  )}
                </div>
              )}
              {!templated && (
                <p className="text-xs text-muted-foreground">
                  No saved email template matches this lead.{" "}
                  <Link to="/templates" className="text-primary hover:underline">Create one</Link>.
                </p>
              )}
              {lead.personalized_email && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">AI email draft</div>
                  <pre className="mt-1 whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs font-sans">{lead.personalized_email}</pre>
                </div>
              )}
              {lead.linkedin_message && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">LinkedIn message</div>
                  <pre className="mt-1 whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs font-sans">{lead.linkedin_message}</pre>
                </div>
              )}
            </div>
          )}
          {tab === "sources" && (
            <div className="space-y-2">
              {lead.source_urls.length === 0 && <p className="text-muted-foreground">No sources recorded.</p>}
              {lead.source_urls.map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noreferrer" className="block break-all text-xs text-primary hover:underline">{u}</a>
              ))}
            </div>
          )}
          {tab === "json" && (
            <div>
              <button onClick={copyJson} className="mb-2 rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">Copy JSON</button>
              <pre className="overflow-x-auto rounded border border-border bg-background p-3 text-[10px]">{JSON.stringify(lead.raw, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value ?? <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

function ReportView({
  run,
  events,
  leads,
  es,
}: {
  run: { input_url: string; created_at: string; target_market: string | null };
  events: Array<{ id: string; event_name: string; event_opportunity_score: number | null; recommended_outreach_phase: string | null; city: string | null; start_date: string | null; industry: string | null }>;
  leads: Lead[];
  es: { shows_reviewed?: number; exhibitors_identified?: number; qualified_accounts?: number; verified_decision_makers?: number; tier_1_leads?: number; top_industries?: string[]; top_shows?: string[]; main_limitations?: string[]; recommended_immediate_action?: string } | null;
}) {
  const json = useMemo(() => ({
    research_run: {
      run_date: run.created_at,
      input_source: run.input_url,
      target_market: run.target_market,
      limitations: es?.main_limitations ?? [],
    },
    events: events.map((e) => ({
      event_name: e.event_name,
      industry: e.industry,
      start_date: e.start_date,
      city: e.city,
      event_opportunity_score: e.event_opportunity_score,
      recommended_outreach_phase: e.recommended_outreach_phase,
    })),
    leads: leads.map((l) => l.raw),
  }), [run, events, leads, es]);

  const copyJson = () => { navigator.clipboard.writeText(JSON.stringify(json, null, 2)); toast.success("Copied"); };
  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `boothlens-run-${run.created_at}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <article className="prose prose-invert max-w-none">
      <section>
        <h2 className="text-xl font-semibold">Section 1 — Executive summary</h2>
        <ul className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-sm list-none p-0">
          <li>Shows reviewed: <span className="font-mono">{es?.shows_reviewed ?? events.length}</span></li>
          <li>Exhibitors identified: <span className="font-mono">{es?.exhibitors_identified ?? leads.length}</span></li>
          <li>Qualified accounts: <span className="font-mono">{es?.qualified_accounts ?? 0}</span></li>
          <li>Verified DMs: <span className="font-mono">{es?.verified_decision_makers ?? 0}</span></li>
          <li>Tier 1 leads: <span className="font-mono text-tier-1">{es?.tier_1_leads ?? 0}</span></li>
        </ul>
        {es?.recommended_immediate_action && <p className="mt-3"><strong>Next action:</strong> {es.recommended_immediate_action}</p>}
        {es?.main_limitations && es.main_limitations.length > 0 && (
          <><h3 className="mt-4 text-sm">Limitations</h3><ul className="text-sm">{es.main_limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Section 2 — Ranked opportunities</h2>
        <table className="mt-3 w-full text-xs">
          <thead className="border-b border-border text-left uppercase text-muted-foreground">
            <tr><th className="py-2">#</th><th>Company</th><th>Show</th><th>Score</th><th>Tier</th><th>Est. value</th><th>Contact target</th></tr>
          </thead>
          <tbody>
            {leads.map((l, i) => {
              const p = l.decision_makers[0];
              return (
                <tr key={l.id} className="border-b border-border">
                  <td className="py-2 font-mono">{i + 1}</td>
                  <td>{l.company_name}</td>
                  <td className="text-muted-foreground">{l.trade_show}</td>
                  <td className="font-mono">{l.lead_score}</td>
                  <td><span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] ${tierColor(l.priority_tier)}`}>{tierLabel(l.priority_tier)}</span></td>
                  <td className="font-mono text-muted-foreground">{l.estimated_project_value_low ? `$${(l.estimated_project_value_low/1000).toFixed(0)}k–$${((l.estimated_project_value_high ?? 0)/1000).toFixed(0)}k` : "—"}</td>
                  <td>{p ? (p.name ?? p.title) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Section 3 — Detailed lead records</h2>
        <div className="space-y-6 mt-4">
          {leads.map((l) => (
            <div key={l.id} className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold m-0">{l.company_name}</h3>
                <span className={`inline-block rounded border px-2 py-0.5 font-mono text-xs ${tierColor(l.priority_tier)}`}>{tierLabel(l.priority_tier)} · {l.lead_score}</span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{l.industry} · {l.trade_show} · {l.event_date}</div>
              {l.personalized_email && (
                <>
                  <div className="mt-3 text-xs uppercase text-muted-foreground">Draft email</div>
                  <pre className="whitespace-pre-wrap text-xs font-sans mt-1">{l.personalized_email}</pre>
                </>
              )}
              {l.decision_makers.length > 0 && (
                <>
                  <div className="mt-3 text-xs uppercase text-muted-foreground">Decision makers</div>
                  <ul className="text-xs mt-1 list-none p-0 space-y-1">
                    {l.decision_makers.map((dm, i) => (
                      <li key={i}>{dm.name ?? "[target]"} — {dm.title} <span className="text-muted-foreground">({dm.role_classification} · {dm.contact_confidence}%)</span></li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Section 4 — CRM-ready JSON</h2>
          <div className="flex gap-2">
            <button onClick={copyJson} className="rounded bg-secondary px-3 py-1 text-xs">Copy</button>
            <button onClick={downloadJson} className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground">Download</button>
          </div>
        </div>
        <pre className="mt-3 overflow-x-auto rounded border border-border bg-background p-3 text-[10px] max-h-96">{JSON.stringify(json, null, 2)}</pre>
      </section>
    </article>
  );
}
