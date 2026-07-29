import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listRuns, deleteRun } from "@/lib/research.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Runs — BoothLens" },
      { name: "description", content: "Your BoothLens research runs: every trade show analyzed, with exhibitor counts, lead tiers, and outreach status in one dashboard." },
      { property: "og:title", content: "Research runs dashboard — BoothLens" },
      { property: "og:description", content: "Review every trade show you've analyzed and jump into ranked exhibitor leads." },
      { name: "robots", content: "noindex" },
    ],
  }),

  component: Dashboard,
});

function tierColor(t?: string | null) {
  if (t === "TIER_1_IMMEDIATE") return "text-tier-1";
  if (t === "TIER_2_HIGH_PRIORITY") return "text-tier-2";
  return "text-muted-foreground";
}

function Dashboard() {
  const list = useServerFn(listRuns);
  const del = useServerFn(deleteRun);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["runs"], queryFn: () => list() });

  const delMut = useMutation({
    mutationFn: (runId: string) => del({ data: { runId } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["runs"] }); toast.success("Run deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Research runs</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every trade show you've analyzed.</p>
        </div>
        <div className="flex gap-2">
        <Link to="/digests" className="rounded-md border border-border px-4 py-2 text-sm font-medium">Email digests</Link>
        <Link to="/templates" className="rounded-md border border-border px-4 py-2 text-sm font-medium">Email templates</Link>

        <Link to="/runs/new" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">New research run</Link>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground">No runs yet.</p>
            <Link to="/runs/new" className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Start your first run</Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-3">Source</th>
                <th className="p-3">Status</th>
                <th className="p-3">Tier 1</th>
                <th className="p-3">Leads</th>
                <th className="p-3">Created</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => {
                const es = (r.executive_summary ?? null) as { tier_1_leads?: number; exhibitors_identified?: number } | null;
                return (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                    <td className="p-3">
                      <Link to="/runs/$runId" params={{ runId: r.id }} className="text-primary hover:underline break-all">
                        {r.input_url}
                      </Link>
                      {r.progress_message && r.status !== "complete" && (
                        <div className="mt-1 text-xs text-muted-foreground">{r.progress_message}</div>
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs uppercase">
                      <span className={
                        r.status === "complete" ? "text-success" :
                        r.status === "failed" ? "text-destructive" :
                        "text-warning"
                      }>{r.status}</span>
                    </td>
                    <td className={`p-3 font-mono ${tierColor("TIER_1_IMMEDIATE")}`}>{es?.tier_1_leads ?? "—"}</td>
                    <td className="p-3 font-mono">{es?.exhibitors_identified ?? "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => { if (confirm("Delete this run?")) delMut.mutate(r.id); }}
                        className="text-xs text-muted-foreground hover:text-destructive"
                      >Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
