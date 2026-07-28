import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { createResearchRun, runResearch } from "@/lib/research.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/runs/new")({
  head: () => ({ meta: [{ title: "New run — BoothLens" }, { name: "robots", content: "noindex" }] }),
  component: NewRun,
});

const DEFAULT_SERVICES = ["custom booths", "modular booths", "LED walls", "installation", "graphics", "storage"];

function NewRun() {
  const navigate = useNavigate();
  const create = useServerFn(createResearchRun);
  const run = useServerFn(runResearch);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    inputUrl: "",
    inputSourceType: "directory" as "directory" | "event" | "exhibitor_list",
    targetMarket: "United States",
    minProjectValue: 25000,
    maxLeadsPerShow: 10,
    priorityIndustries: "technology, manufacturing, medical, automotive",
    targetServices: DEFAULT_SERVICES.join(", "),
  });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { id } = await create({
        data: {
          inputUrl: form.inputUrl,
          inputSourceType: form.inputSourceType,
          targetMarket: form.targetMarket || null,
          minProjectValue: form.minProjectValue,
          maxLeadsPerShow: form.maxLeadsPerShow,
          priorityIndustries: form.priorityIndustries.split(",").map((s) => s.trim()).filter(Boolean),
          targetServices: form.targetServices.split(",").map((s) => s.trim()).filter(Boolean),
        },
      });
      // Kick off processing (don't await — long-running); navigate immediately.
      run({ data: { runId: id } }).catch((e) => {
        console.error("Pipeline error:", e);
      });
      navigate({ to: "/runs/$runId", params: { runId: id } });
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">New research run</h1>
      <p className="mt-1 text-sm text-muted-foreground">Paste a trade show directory or event URL. We'll do the rest.</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5 rounded-lg border border-border bg-card p-6">
        <Field label="Source URL" hint="Trade show directory, event page, or exhibitor list.">
          <input
            type="url"
            required
            placeholder="https://www.example.com/tradeshow-directory"
            value={form.inputUrl}
            onChange={(e) => setForm({ ...form, inputUrl: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Source type">
          <select
            value={form.inputSourceType}
            onChange={(e) => setForm({ ...form, inputSourceType: e.target.value as "directory" | "event" | "exhibitor_list" })}
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
          >
            <option value="directory">Directory (multiple events)</option>
            <option value="event">Single event page</option>
            <option value="exhibitor_list">Exhibitor list page</option>
          </select>
        </Field>

        <Field label="Target market">
          <input
            type="text"
            value={form.targetMarket}
            onChange={(e) => setForm({ ...form, targetMarket: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Min project value (USD)">
            <input
              type="number"
              min={0}
              value={form.minProjectValue}
              onChange={(e) => setForm({ ...form, minProjectValue: parseInt(e.target.value || "0") })}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm font-mono"
            />
          </Field>
          <Field label="Max leads per show">
            <input
              type="number"
              min={1}
              max={30}
              value={form.maxLeadsPerShow}
              onChange={(e) => setForm({ ...form, maxLeadsPerShow: parseInt(e.target.value || "10") })}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm font-mono"
            />
          </Field>
        </div>

        <Field label="Priority industries" hint="Comma-separated.">
          <input
            type="text"
            value={form.priorityIndustries}
            onChange={(e) => setForm({ ...form, priorityIndustries: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Target services we offer" hint="Comma-separated.">
          <input
            type="text"
            value={form.targetServices}
            onChange={(e) => setForm({ ...form, targetServices: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
          />
        </Field>

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">Runs typically take 1–3 minutes.</p>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Starting…" : "Start run"}
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground/70">{hint}</span>}
    </label>
  );
}
