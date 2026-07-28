/**
 * Structured pipeline logging (spec Observability section).
 *
 * Entries are appended to the run's step log so they persist with the run and
 * are visible in the debug panel.
 */

export const PIPELINE_STAGES = [
  "EVENT_DISCOVERY",
  "EVENT_VERIFICATION",
  "EVENT_SCORING",
  "SOURCE_DISCOVERY",
  "SOURCE_VALIDATION",
  "EXHIBITOR_EXTRACTION",
  "EVIDENCE_VALIDATION",
  "EXHIBITOR_DEDUPLICATION",
  "LEAD_QUALIFICATION",
  "CONTACT_DISCOVERY",
  "CONTACT_VERIFICATION",
  "EMAIL_GENERATION",
  "EMAIL_VALIDATION",
  "CRM_SYNC",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_STATUSES = [
  "SUCCESS",
  "SUCCESS_WITH_WARNINGS",
  "PARTIAL",
  "BLOCKED",
  "FAILED",
  "SOURCE_NOT_VERIFIED",
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export type PipelineLogEntry = {
  at: string;
  stage: PipelineStage;
  status: PipelineStatus;
  run_id?: string;
  event_id?: string;
  exhibitor_id?: string;
  contact_id?: string;
  source_url?: string;
  duration_ms?: number;
  confidence?: number;
  accepted?: number;
  rejected?: number;
  failure_reason?: string;
  message?: string;
};

export function pipelineLog(
  stage: PipelineStage,
  status: PipelineStatus,
  fields: Omit<PipelineLogEntry, "at" | "stage" | "status"> = {},
): PipelineLogEntry {
  const entry: PipelineLogEntry = { at: new Date().toISOString(), stage, status, ...fields };
  // Machine-readable line for server logs; the entry is also persisted on the run.
  console.log(`[pipeline] ${stage} ${status} ${JSON.stringify(fields)}`);
  return entry;
}
