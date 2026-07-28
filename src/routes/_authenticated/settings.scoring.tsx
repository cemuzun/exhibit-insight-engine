import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  DEFAULT_SCORING,
  SCORE_COMPONENTS,
  type ScoringSettings,
} from "@/lib/scoring";
import {
  getScoringSettings,
  resetScoringSettings,
  saveScoringSettings,
} from "@/lib/scoring.functions";

export const Route = createFileRoute("/_authenticated/settings/scoring")({
  ssr: false,
  component: ScoringSettingsPage,
  head: () => ({
    meta: [
      { title: "Scoring settings — BoothLens" },
      {
        name: "description",
        content:
          "Tune how BoothLens scores trade show leads: component weights, tier thresholds and the qualified-lead cutoff.",
      },
      { property: "og:title", content: "Scoring settings — BoothLens" },
      {
        property: "og:description",
        content: "Customize lead scoring weights and priority tier thresholds.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function ScoringSettingsPage() {
  const load = useServerFn(getScoringSettings);
  const save = useServerFn(saveScoringSettings);
  const reset = useServerFn(resetScoringSettings);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["scoring-settings"],
    queryFn: () => load(),
  });

  const [form, setForm] = useState<ScoringSettings>(DEFAULT_SCORING);
  useEffect(() => {
    if (data) setForm(data as ScoringSettings);
  }, [data]);

  const saveMut = useMutation({
    mutationFn: () => save({ data: form }),
    onSuccess: (res) => {
      setForm(res as ScoringSettings);
      qc.invalidateQueries({ queryKey: ["scoring-settings"] });
    },
  });
  const resetMut = useMutation({
    mutationFn: () => reset(),
    onSuccess: (res) => {
      setForm(res as ScoringSettings);
      qc.invalidateQueries({ queryKey: ["scoring-settings"] });
    },
  });

  const total = SCORE_COMPONENTS.reduce((sum, c) => sum + (form.weights[c.key] ?? 0), 0);

  const setWeight = (key: string, value: number) =>
    setForm((f) => ({ ...f, weights: { ...f.weights, [key]: value } }));

  const thresholdsValid =
    form.tier1_min >= form.tier2_min && form.tier2_min >= form.tier3_min;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Scoring settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Control how much each signal counts and where the priority tiers start. Scores are
        normalized to 0–100, so changing weights changes the mix, not the scale. New runs use
        these settings.
      </p>

      {isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <section className="mt-8 rounded-lg border border-border p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-medium">Component weights</h2>
              <span className="text-xs text-muted-foreground">
                {total} points allocated
              </span>
            </div>
            <div className="mt-4 space-y-4">
              {SCORE_COMPONENTS.map((c) => (
                <div key={c.key} className="grid grid-cols-[1fr_auto] items-center gap-4">
                  <div>
                    <label htmlFor={c.key} className="text-sm">
                      {c.label}
                    </label>
                    <input
                      id={c.key}
                      type="range"
                      min={0}
                      max={30}
                      step={1}
                      value={form.weights[c.key] ?? 0}
                      onChange={(e) => setWeight(c.key, Number(e.target.value))}
                      className="mt-1 w-full accent-primary"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={form.weights[c.key] ?? 0}
                      onChange={(e) => setWeight(c.key, Number(e.target.value))}
                      className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm"
                      aria-label={`${c.label} points`}
                    />
                    <span className="w-14 text-xs text-muted-foreground">
                      def. {c.defaultMax}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {total === 0 && (
              <p className="mt-3 text-xs text-destructive">
                At least one component needs points.
              </p>
            )}
          </section>

          <section className="mt-6 rounded-lg border border-border p-5">
            <h2 className="font-medium">Tier thresholds</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              {[
                { key: "tier1_min" as const, label: "Tier 1 from" },
                { key: "tier2_min" as const, label: "Tier 2 from" },
                { key: "tier3_min" as const, label: "Tier 3 from" },
                { key: "qualified_min" as const, label: "Qualified from" },
              ].map((f) => (
                <div key={f.key}>
                  <label htmlFor={f.key} className="text-sm text-muted-foreground">
                    {f.label}
                  </label>
                  <input
                    id={f.key}
                    type="number"
                    min={0}
                    max={100}
                    value={form[f.key]}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))
                    }
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.tier1_requires_verified_contact}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    tier1_requires_verified_contact: e.target.checked,
                  }))
                }
                className="accent-primary"
              />
              Tier 1 requires a confirmed decision-maker contact
            </label>
            {!thresholdsValid && (
              <p className="mt-3 text-xs text-destructive">
                Thresholds must decrease: Tier 1 ≥ Tier 2 ≥ Tier 3.
              </p>
            )}
          </section>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || total === 0 || !thresholdsValid}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saveMut.isPending ? "Saving…" : "Save settings"}
            </button>
            <button
              onClick={() => resetMut.mutate()}
              disabled={resetMut.isPending}
              className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
            >
              Reset to defaults
            </button>
            {saveMut.isSuccess && !saveMut.isPending && (
              <span className="text-xs text-muted-foreground">Saved</span>
            )}
            {saveMut.isError && (
              <span className="text-xs text-destructive">
                {(saveMut.error as Error).message}
              </span>
            )}
          </div>
        </>
      )}
    </main>
  );
}
