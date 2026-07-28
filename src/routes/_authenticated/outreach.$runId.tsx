import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  buildOutreachQueue,
  listOutreach,
  sendApprovedOutreach,
  setOutreachStatusBulk,
  updateOutreachDraft,
  type OutreachEmailRow,
} from "@/lib/outreach.functions";

export const Route = createFileRoute("/_authenticated/outreach/$runId")({
  head: () => ({
    meta: [
      { title: "Outreach queue — BoothLens" },
      { name: "description", content: "Review, edit and approve drafted decision-maker emails before they are sent." },
      { property: "og:title", content: "Outreach queue — BoothLens" },
      { property: "og:description", content: "Review, edit and approve drafted decision-maker emails before they are sent." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OutreachQueue,
});

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-primary/15 text-primary",
  sent: "bg-emerald-500/15 text-emerald-500",
  failed: "bg-destructive/15 text-destructive",
};

function OutreachQueue() {
  const { runId } = Route.useParams();
  const qc = useQueryClient();

  const list = useServerFn(listOutreach);
  const build = useServerFn(buildOutreachQueue);
  const update = useServerFn(updateOutreachDraft);
  const bulk = useServerFn(setOutreachStatusBulk);
  const send = useServerFn(sendApprovedOutreach);

  const [filter, setFilter] = useState<"all" | "draft" | "approved" | "sent" | "failed">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ subject: string; body: string } | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["outreach", runId],
    queryFn: () => list({ data: { runId } }),
    refetchInterval: 15000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["outreach", runId] });

  const buildMutation = useMutation({
    mutationFn: () => build({ data: { runId, minScore: 50 } }),
    onSuccess: (r) => {
      toast.success(
        `${r.created} draft${r.created === 1 ? "" : "s"} created from ${r.leadsConsidered} leads` +
          (r.leadsWithoutContact ? ` · ${r.leadsWithoutContact} leads had no public contact email` : ""),
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: () => send({ data: { runId } }),
    onSuccess: (r) => {
      if (r.reason === "sender_not_configured") {
        toast.error("Sending needs a verified sender domain — set one up first.");
      } else if (r.reason === "nothing_approved") {
        toast.message("No approved drafts to send yet.");
      } else {
        toast.success(`${r.sent} sent · ${r.failed} failed`);
      }
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const counts = useMemo(() => {
    const c = { all: rows.length, draft: 0, approved: 0, sent: 0, failed: 0 } as Record<string, number>;
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const visible = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  const openRow = (row: OutreachEmailRow) => {
    setOpenId(row.id);
    setEdit({ subject: row.subject, body: row.body });
  };

  const saveDraft = async (row: OutreachEmailRow, status?: "draft" | "approved") => {
    if (!edit) return;
    await update({ data: { id: row.id, subject: edit.subject, body: edit.body, status } });
    toast.success(status === "approved" ? "Approved" : "Saved");
    setOpenId(null);
    invalidate();
  };

  const approveAllDrafts = async () => {
    const ids = rows.filter((r) => r.status === "draft").map((r) => r.id).slice(0, 500);
    if (!ids.length) return toast.message("No drafts to approve.");
    await bulk({ data: { ids, status: "approved" } });
    toast.success(`${ids.length} approved`);
    invalidate();
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link to="/runs/$runId" params={{ runId }} className="text-xs text-muted-foreground hover:text-foreground">
        ← Back to run
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Outreach queue</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        One draft per decision maker with a public business email. Nothing leaves the app until you approve and send.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          onClick={() => buildMutation.mutate()}
          disabled={buildMutation.isPending}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {buildMutation.isPending ? "Drafting…" : "Draft emails from leads"}
        </button>
        <button onClick={approveAllDrafts} className="rounded-md border border-border px-3 py-2 text-sm">
          Approve all drafts
        </button>
        <button
          onClick={() => sendMutation.mutate()}
          disabled={sendMutation.isPending}
          className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60"
        >
          {sendMutation.isPending ? "Sending…" : "Send approved"}
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {(["all", "draft", "approved", "sent", "failed"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-full px-3 py-1 text-xs capitalize ${
              filter === k ? "bg-foreground text-background" : "border border-border text-muted-foreground"
            }`}
          >
            {k} {counts[k] ?? 0}
          </button>
        ))}
      </div>

      <section className="mt-6 space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading queue…</p>}
        {!isLoading && !visible.length && (
          <p className="text-sm text-muted-foreground">
            No drafts here yet. Use “Draft emails from leads” once the run has scored leads.
          </p>
        )}
        {visible.map((row) => (
          <article key={row.id} className="rounded-lg border border-border bg-card p-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-medium">{row.company_name}</h2>
                <p className="text-xs text-muted-foreground">
                  {row.recipient_name ?? "Unnamed contact"}
                  {row.recipient_title ? ` · ${row.recipient_title}` : ""} · {row.recipient_email}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-mono">{row.lead_score}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[row.status] ?? "bg-muted"}`}>
                  {row.status}
                </span>
                <button
                  onClick={() => (openId === row.id ? setOpenId(null) : openRow(row))}
                  className="rounded-md border border-border px-2 py-1 text-xs"
                >
                  {openId === row.id ? "Close" : "Review"}
                </button>
              </div>
            </header>

            {row.error && <p className="mt-2 text-xs text-destructive">{row.error}</p>}

            {openId === row.id && edit && (
              <div className="mt-4 space-y-3">
                <input
                  value={edit.subject}
                  onChange={(e) => setEdit({ ...edit, subject: e.target.value })}
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                  placeholder="Subject"
                />
                <textarea
                  value={edit.body}
                  onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                  rows={12}
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                  placeholder="Email body"
                />
                <div className="flex gap-2">
                  <button onClick={() => saveDraft(row)} className="rounded-md border border-border px-3 py-2 text-sm">
                    Save draft
                  </button>
                  <button
                    onClick={() => saveDraft(row, "approved")}
                    className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                  >
                    Approve
                  </button>
                </div>
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
