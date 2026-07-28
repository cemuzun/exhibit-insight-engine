import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { previewCrmSync, syncRunToCrm, type CrmPreviewCompany } from "@/lib/crm.functions";

type Preview = {
  rows: CrmPreviewCompany[];
  totals: {
    leadsConsidered: number;
    companiesToInsert: number;
    companiesSkipped: number;
    contactsToInsert: number;
    contactsSkipped: number;
  };
};

export function CrmSyncPreview({ runId, disabled }: { runId: string; disabled?: boolean }) {
  const preview = useServerFn(previewCrmSync);
  const sync = useServerFn(syncRunToCrm);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [data, setData] = useState<Preview | null>(null);

  async function loadPreview() {
    setOpen(true);
    setLoading(true);
    setData(null);
    try {
      setData((await preview({ data: { runId, minScore: 50 } })) as Preview);
    } catch (e) {
      toast.error((e as Error).message || "Could not build CRM preview");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function confirmSync() {
    setSyncing(true);
    try {
      const r = await sync({ data: { runId, minScore: 50 } });
      toast.success(
        `CRM sync complete — ${r.companiesCreated} companies, ${r.contactsCreated} contacts created; ${r.skipped} skipped${r.failed ? `, ${r.failed} failed` : ""}.`,
      );
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message || "CRM sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <button
        onClick={loadPreview}
        disabled={disabled || loading}
        className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
        title="Preview which companies and contacts would be inserted or skipped, deduped by domain and email"
      >
        {loading ? "Checking CRM…" : "Preview CRM sync"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">CRM sync preview</h2>
                <p className="text-xs text-muted-foreground">
                  Deduped by company domain and contact email — nothing is written yet.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {loading && <p className="text-sm text-muted-foreground">Checking CRM for matches…</p>}

              {data && (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Companies to insert" value={data.totals.companiesToInsert} />
                    <Stat label="Companies skipped" value={data.totals.companiesSkipped} />
                    <Stat label="Contacts to insert" value={data.totals.contactsToInsert} />
                    <Stat label="Contacts skipped" value={data.totals.contactsSkipped} />
                  </div>

                  {data.rows.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No qualified leads (score ≥ 50) in this run.
                    </p>
                  )}

                  <ul className="space-y-3">
                    {data.rows.map((r) => (
                      <li key={r.leadId} className="rounded-md border border-border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">{r.companyName}</p>
                            <p className="text-xs text-muted-foreground">
                              {r.domain ?? "no domain"} — {r.reason}
                            </p>
                          </div>
                          <Badge action={r.action} />
                        </div>
                        {r.contacts.length > 0 && (
                          <ul className="mt-2 space-y-1 border-t border-border pt-2">
                            {r.contacts.map((c, i) => (
                              <li
                                key={`${r.leadId}-${i}`}
                                className="flex items-start justify-between gap-3 text-xs"
                              >
                                <span>
                                  <span className="font-medium">{c.name ?? "Unnamed contact"}</span>{" "}
                                  <span className="text-muted-foreground">
                                    {c.email ?? "[unknown]"} — {c.reason}
                                  </span>
                                </span>
                                <Badge action={c.action} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={confirmSync}
                disabled={syncing || loading || !data || data.rows.length === 0}
                className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {syncing ? "Syncing…" : "Confirm sync"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function Badge({ action }: { action: "insert" | "skip" }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        action === "insert"
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground"
      }`}
    >
      {action === "insert" ? "Insert" : "Skip"}
    </span>
  );
}
