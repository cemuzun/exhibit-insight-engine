import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BoothLens — Trade Show Lead Intelligence" },
      { name: "description", content: "Paste any trade show URL. Get ranked exhibitor leads, decision-maker targets, budget estimates, and drafted outreach — built for booth, LED, and exhibit-services vendors." },
      { property: "og:title", content: "BoothLens — Trade Show Lead Intelligence" },
      { property: "og:description", content: "Turn trade show directories into a prioritized sales pipeline." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-primary" />
            <span className="font-semibold tracking-tight">BoothLens</span>
          </div>
          <nav className="flex items-center gap-3 text-sm">
            {signedIn ? (
              <Link to="/dashboard" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Open dashboard</Link>
            ) : (
              <>
                <Link to="/auth" className="text-muted-foreground hover:text-foreground">Sign in</Link>
                <Link to="/auth" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Get started</Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            For booth, LED, and exhibit-services sales teams
          </div>
          <h1 className="text-5xl font-semibold tracking-tight leading-[1.05]">
            Turn a trade show URL into a <span className="text-primary">ranked sales pipeline</span>.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
            Paste a trade show directory or event page. BoothLens scrapes the exhibitor list, enriches every company, estimates booth spend, identifies decision-maker targets, and drafts personalized outreach — with sources and confidence on every field.
          </p>
          <div className="mt-8 flex gap-3">
            <Link to={signedIn ? "/runs/new" : "/auth"} className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">
              Start a research run
            </Link>
          </div>
        </div>

        <div className="mt-20 grid gap-6 md:grid-cols-3">
          {[
            { h: "Verified over volume", p: "We surface fewer, better leads. Every claim has a source; unverified people are returned as target titles, never fabricated." },
            { h: "Booth-aware scoring", p: "9-component score: show activity, booth complexity, LED fit, timing, decision-maker path, service fit — no vanity metrics." },
            { h: "Outreach that lands", p: "Subject + email + LinkedIn drafts using only facts actually in the source — no generic 'love what you're doing'." },
          ].map((c) => (
            <div key={c.h} className="rounded-lg border border-border bg-card p-5">
              <div className="font-mono text-xs text-primary">01</div>
              <h3 className="mt-3 font-semibold">{c.h}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{c.p}</p>
            </div>
          ))}
        </div>

        <div className="mt-20 rounded-lg border border-border bg-card p-8">
          <h2 className="text-2xl font-semibold tracking-tight">How a run works</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-2 text-sm">
            {[
              "Paste a trade show URL and set your filters (target market, industries, min project value).",
              "We scrape the source and identify events, ranked by exhibit-vendor opportunity.",
              "For each qualified exhibitor we produce a full lead record: booth estimate, service fit, decision-maker path, outreach drafts.",
              "You get a dashboard, a printable report, and CRM-ready JSON — with every claim linked to its source.",
            ].map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-mono text-primary">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-muted-foreground">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </main>
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        BoothLens — sales intelligence for the exhibit industry.
      </footer>
    </div>
  );
}
