import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  listEmailTemplates,
  saveEmailTemplate,
  deleteEmailTemplate,
} from "@/lib/templates.functions";
import {
  EVIDENCE_LEVELS,
  SAMPLE_LEAD,
  TEMPLATE_VARIABLES,
  renderTemplateString,
  missingVariables,
  templateMatches,
  type EmailTemplate,
} from "@/lib/email-template-engine";

export const Route = createFileRoute("/_authenticated/templates")({
  head: () => ({
    meta: [
      { title: "Email templates — BoothLens" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TemplatesPage,
});

type Draft = {
  id?: string;
  name: string;
  industry: string;
  trade_show: string;
  min_evidence_level: string;
  min_lead_score: number;
  subject_template: string;
  body_template: string;
  is_default: boolean;
};

const EMPTY: Draft = {
  name: "New template",
  industry: "",
  trade_show: "",
  min_evidence_level: "ANY",
  min_lead_score: 0,
  subject_template: "{{company_name}} at {{trade_show}} — booth {{booth_number|your booth}}",
  body_template: `Hi {{contact_first_name|there}},

I saw {{company_name}} is exhibiting at {{trade_show}}{{booth_number| }} and thought the {{booth_type|booth}} footprint would suit {{recommended_services}}.

We design, build, install and store custom exhibits, and typically work in the {{estimated_value|range that fits your show plan}} range for a show like this.

Worth a short call before build slots fill up?

Best,
`,
  is_default: false,
};

function fromRow(t: EmailTemplate): Draft {
  return {
    id: t.id,
    name: t.name,
    industry: t.industry ?? "",
    trade_show: t.trade_show ?? "",
    min_evidence_level: t.min_evidence_level,
    min_lead_score: t.min_lead_score,
    subject_template: t.subject_template,
    body_template: t.body_template,
    is_default: t.is_default,
  };
}

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function TemplatesPage() {
  const list = useServerFn(listEmailTemplates);
  const save = useServerFn(saveEmailTemplate);
  const remove = useServerFn(deleteEmailTemplate);
  const qc = useQueryClient();

  const [draft, setDraft] = useState<Draft>(EMPTY);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["email-templates"],
    queryFn: () => list(),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: draft.id,
          name: draft.name,
          industry: draft.industry || null,
          trade_show: draft.trade_show || null,
          min_evidence_level: draft.min_evidence_level as "ANY",
          min_lead_score: Number(draft.min_lead_score) || 0,
          subject_template: draft.subject_template,
          body_template: draft.body_template,
          is_default: draft.is_default,
        },
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["email-templates"] });
      setDraft(fromRow(row as EmailTemplate));
      toast.success("Template saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-templates"] });
      setDraft(EMPTY);
      toast.success("Template deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const preview = useMemo(() => {
    const lead = SAMPLE_LEAD;
    return {
      subject: renderTemplateString(draft.subject_template, lead),
      body: renderTemplateString(draft.body_template, lead),
      missing: [
        ...new Set([
          ...missingVariables(draft.subject_template, lead),
          ...missingVariables(draft.body_template, lead),
        ]),
      ],
      matchesSample: templateMatches(
        {
          id: draft.id ?? "draft",
          name: draft.name,
          industry: draft.industry || null,
          trade_show: draft.trade_show || null,
          min_evidence_level: draft.min_evidence_level,
          min_lead_score: Number(draft.min_lead_score) || 0,
          subject_template: draft.subject_template,
          body_template: draft.body_template,
          is_default: draft.is_default,
        },
        lead,
      ),
    };
  }, [draft]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Customize subject and body per industry, show, and evidence strength. Leads use the most
            specific matching template.
          </p>
        </div>
        <Link
          to="/dashboard"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium"
        >
          Back to runs
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr_320px]">
        {/* Template list */}
        <aside className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Templates
            </span>
            <button
              onClick={() => setDraft(EMPTY)}
              className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
            >
              New
            </button>
          </div>
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : !templates?.length ? (
            <p className="p-4 text-sm text-muted-foreground">No templates yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(templates as EmailTemplate[]).map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setDraft(fromRow(t))}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                      draft.id === t.id ? "bg-muted" : ""
                    }`}
                  >
                    <span className="font-medium">{t.name}</span>
                    {t.is_default && (
                      <span className="ml-2 rounded border border-border px-1 text-[10px] uppercase text-muted-foreground">
                        default
                      </span>
                    )}
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {[t.industry, t.trade_show, t.min_evidence_level !== "ANY" ? t.min_evidence_level : null]
                        .filter(Boolean)
                        .join(" · ") || "All leads"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Editor */}
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Template name</span>
              <input
                className={inputCls}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Industry (blank = any)</span>
              <input
                className={inputCls}
                placeholder="Medical Devices"
                value={draft.industry}
                onChange={(e) => setDraft({ ...draft, industry: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Trade show (blank = any)</span>
              <input
                className={inputCls}
                placeholder="MD&M West"
                value={draft.trade_show}
                onChange={(e) => setDraft({ ...draft, trade_show: e.target.value })}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Min evidence</span>
                <select
                  className={inputCls}
                  value={draft.min_evidence_level}
                  onChange={(e) => setDraft({ ...draft, min_evidence_level: e.target.value })}
                >
                  {EVIDENCE_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Min score</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={inputCls}
                  value={draft.min_lead_score}
                  onChange={(e) => setDraft({ ...draft, min_lead_score: Number(e.target.value) })}
                />
              </label>
            </div>
          </div>

          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-muted-foreground">Subject</span>
            <input
              className={inputCls}
              value={draft.subject_template}
              onChange={(e) => setDraft({ ...draft, subject_template: e.target.value })}
            />
          </label>

          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-muted-foreground">Body</span>
            <textarea
              rows={16}
              className={`${inputCls} font-mono text-xs`}
              value={draft.body_template}
              onChange={(e) => setDraft({ ...draft, body_template: e.target.value })}
            />
          </label>

          <div className="mt-4 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.is_default}
                onChange={(e) => setDraft({ ...draft, is_default: e.target.checked })}
              />
              Use as fallback for unmatched leads
            </label>
            <div className="flex gap-2">
              {draft.id && (
                <button
                  onClick={() => delMut.mutate(draft.id!)}
                  disabled={delMut.isPending}
                  className="rounded-md border border-border px-4 py-2 text-sm"
                >
                  Delete
                </button>
              )}
              <button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {saveMut.isPending ? "Saving…" : "Save template"}
              </button>
            </div>
          </div>
        </section>

        {/* Preview + variables */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-medium">Preview (sample lead)</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {preview.matchesSample
                ? "This template would match the sample lead."
                : "Filters exclude the sample lead — preview shown anyway."}
            </p>
            <p className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">Subject</p>
            <p className="text-sm">{preview.subject}</p>
            <p className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">Body</p>
            <pre className="mt-1 whitespace-pre-wrap rounded border border-border bg-background p-3 font-sans text-xs">
              {preview.body}
            </pre>
            {preview.missing.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Unverified for this lead: {preview.missing.join(", ")} — add a{" "}
                <code>{"{{var|fallback}}"}</code> so nothing is invented.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-medium">Variables</h2>
            <ul className="mt-2 space-y-1 text-xs">
              {TEMPLATE_VARIABLES.map((v) => (
                <li key={v.key} className="flex items-start justify-between gap-2">
                  <button
                    className="font-mono text-primary"
                    onClick={() =>
                      setDraft({ ...draft, body_template: `${draft.body_template}{{${v.key}}}` })
                    }
                  >
                    {`{{${v.key}}}`}
                  </button>
                  <span className="text-right text-muted-foreground">{v.description}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
