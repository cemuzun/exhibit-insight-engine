import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  listDigestSchedules,
  saveDigestSchedule,
  deleteDigestSchedule,
  previewDigest,
} from "@/lib/digests.functions";

export const Route = createFileRoute("/_authenticated/digests")({
  head: () => ({
    meta: [
      { title: "Email digests — BoothLens" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DigestsPage,
});

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Draft = {
  id?: string;
  name: string;
  recipient_email: string;
  enabled: boolean;
  days_of_week: number[];
  hour_of_day: number;
  timezone: string;
  min_lead_score: number;
  only_tier_1: boolean;
};

const emptyDraft = (): Draft => ({
  name: "Lead digest",
  recipient_email: "",
  enabled: true,
  days_of_week: [1, 2, 3, 4, 5],
  hour_of_day: 8,
  timezone:
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC",
  min_lead_score: 60,
  only_tier_1: false,
});

function DigestsPage() {
  const list = useServerFn(listDigestSchedules);
  const save = useServerFn(saveDigestSchedule);
  const remove = useServerFn(deleteDigestSchedule);
  const preview = useServerFn(previewDigest);
  const qc = useQueryClient();

  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [previewData, setPreviewData] = useState<{
    since: string;
    leads: Array<{
      id: string;
      company_name: string;
      trade_show: string | null;
      lead_score: number;
      priority_tier: string | null;
    }>;
  } | null>(null);

  const { data: schedules, isLoading } = useQuery({
    queryKey: ["digests"],
    queryFn: () => list(),
  });

  const saveMut = useMutation({
    mutationFn: (d: Draft) => save({ data: d }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["digests"] });
      setDraft(emptyDraft());
      toast.success("Digest schedule saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["digests"] });
      toast.success("Schedule deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const previewMut = useMutation({
    mutationFn: (id: string) => preview({ data: { id } }),
    onSuccess: (d) => setPreviewData(d as typeof previewData),
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleDay = (d: number) =>
    setDraft((p) => ({
      ...p,
      days_of_week: p.days_of_week.includes(d)
        ? p.days_of_week.filter((x) => x !== d)
        : [...p.days_of_week, d].sort(),
    }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scheduled email digests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Get new qualified leads delivered on the days and times you choose.
          </p>
        </div>
        <Link to="/dashboard" className="rounded-md border border-border px-4 py-2 text-sm font-medium">
          Back to runs
        </Link>
      </div>

      <section className="mb-8 rounded-lg border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {draft.id ? "Edit schedule" : "New schedule"}
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Name</span>
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Send to</span>
            <input
              type="email"
              placeholder="you@company.com"
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              value={draft.recipient_email}
              onChange={(e) => setDraft({ ...draft, recipient_email: e.target.value })}
            />
          </label>
        </div>

        <div className="mt-4">
          <span className="mb-2 block text-sm text-muted-foreground">Days</span>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleDay(i)}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  draft.days_of_week.includes(i)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Hour</span>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              value={draft.hour_of_day}
              onChange={(e) => setDraft({ ...draft, hour_of_day: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Timezone</span>
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              value={draft.timezone}
              onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Minimum lead score</span>
            <input
              type="number"
              min={0}
              max={100}
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              value={draft.min_lead_score}
              onChange={(e) => setDraft({ ...draft, min_lead_score: Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.only_tier_1}
              onChange={(e) => setDraft({ ...draft, only_tier_1: e.target.checked })}
            />
            Only Tier 1 leads
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={() => saveMut.mutate(draft)}
            disabled={saveMut.isPending || !draft.recipient_email || draft.days_of_week.length === 0}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saveMut.isPending ? "Saving…" : draft.id ? "Update schedule" : "Create schedule"}
          </button>
          {draft.id && (
            <button
              onClick={() => setDraft(emptyDraft())}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <h2 className="border-b border-border p-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Your schedules
        </h2>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : !schedules || schedules.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No schedules yet.</div>
        ) : (
          <ul>
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 border-b border-border p-4 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {s.name}{" "}
                    <span className={s.enabled ? "text-success text-xs" : "text-muted-foreground text-xs"}>
                      {s.enabled ? "active" : "paused"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.recipient_email} · {(s.days_of_week ?? []).map((d: number) => DAYS[d]).join(", ")} at{" "}
                    {String(s.hour_of_day).padStart(2, "0")}:00 {s.timezone} · score ≥ {s.min_lead_score}
                    {s.only_tier_1 ? " · Tier 1 only" : ""}
                  </div>
                  {s.last_sent_at && (
                    <div className="text-xs text-muted-foreground">
                      Last sent {new Date(s.last_sent_at).toLocaleString()}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => previewMut.mutate(s.id)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs"
                >
                  Preview
                </button>
                <button
                  onClick={() =>
                    setDraft({
                      id: s.id,
                      name: s.name,
                      recipient_email: s.recipient_email,
                      enabled: s.enabled,
                      days_of_week: s.days_of_week ?? [],
                      hour_of_day: s.hour_of_day,
                      timezone: s.timezone,
                      min_lead_score: s.min_lead_score,
                      only_tier_1: s.only_tier_1,
                    })
                  }
                  className="rounded-md border border-border px-3 py-1.5 text-xs"
                >
                  Edit
                </button>
                <button
                  onClick={() => delMut.mutate(s.id)}
                  className="rounded-md border border-destructive px-3 py-1.5 text-xs text-destructive"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {previewData && (
        <section className="mt-6 rounded-lg border border-border bg-card p-5">
          <h2 className="mb-2 text-sm font-semibold">
            Preview — {previewData.leads.length} qualified lead(s) since{" "}
            {new Date(previewData.since).toLocaleString()}
          </h2>
          {previewData.leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing new would be sent right now. Digests are skipped when there are no new leads.
            </p>
          ) : (
            <ul className="text-sm">
              {previewData.leads.map((l) => (
                <li key={l.id} className="flex justify-between border-b border-border py-1.5 last:border-0">
                  <span>
                    {l.company_name}
                    {l.trade_show ? <span className="text-muted-foreground"> · {l.trade_show}</span> : null}
                  </span>
                  <span className="font-mono text-xs">{l.lead_score}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
