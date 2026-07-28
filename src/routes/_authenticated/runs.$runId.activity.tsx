import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getRun } from "@/lib/research.functions";
import { ScoringFeed, type ScoringFeedEntry } from "@/components/ScoringFeed";

export const Route = createFileRoute("/_authenticated/runs/$runId/activity")({
  head: () => ({
    meta: [
      { title: "Live scoring decisions — BoothLens" },
      {
        name: "description",
        content: "Watch every exhibitor scoring decision as the research run streams results.",
      },
      { property: "og:title", content: "Live scoring decisions — BoothLens" },
      {
        property: "og:description",
        content: "Watch every exhibitor scoring decision as the research run streams results.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RunActivity,
});

function RunActivity() {
  const { runId } = Route.useParams();
  const get = useServerFn(getRun);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => get({ data: { runId } }),
    refetchInterval: (q) => {
      const s = q.state.data?.run?.status;
      return s === "complete" || s === "failed" ? false : 3000;
    },
  });

  // Same live push as the run page so entries appear the moment they are logged.
  useEffect(() => {
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["run", runId] });
    const channel = supabase
      .channel(`run-activity-${runId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "research_runs", filter: `id=eq.${runId}` },
        invalidate,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [runId, queryClient]);

  if (isLoading || !data) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-8">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (!data.run) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Link to="/dashboard" className="text-xs text-muted-foreground hover:text-foreground">
          ← All runs
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Run not found</h1>
      </main>
    );
  }

  const run = data.run;
  const entries = (((run as { counters?: { scoring_feed?: unknown } }).counters?.scoring_feed ??
    []) as ScoringFeedEntry[]);
  const inProgress = run.status !== "complete" && run.status !== "failed";

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Link
        to="/runs/$runId"
        params={{ runId }}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to run
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Live scoring decisions</h1>
      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="font-mono uppercase">{run.status}</span>
        <span className="break-all">{run.input_url}</span>
      </div>

      <div className="mt-6">
        {entries.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            {inProgress
              ? "No scoring decisions yet — they appear here as exhibitors are evaluated."
              : "This run recorded no scoring decisions."}
          </p>
        ) : (
          <ScoringFeed entries={entries} />
        )}
      </div>
    </main>
  );
}
