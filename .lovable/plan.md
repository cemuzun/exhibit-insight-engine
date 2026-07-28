# Align BoothLens with the Trade Show Exhibitor Lead Generation spec

## 1. Current architecture map

- `src/lib/pipeline.server.ts` (~1750 lines) — the whole run: directory scrape → event extraction (`scoreDirectoryEvent`, AI event ranking) → `findExhibitorSources` → page scraping → exhibitor extraction (deterministic + AI) → lead scoring (`explainLeadScore`) → decision-maker suggestion → email drafting. Emits live counters/`show_debug`/scoring-feed entries.
- `src/lib/pipeline-schemas.ts` — Zod schemas for event list, exhibitor batches, lead enrichment.
- `src/lib/exhibitor-parser.ts` — deterministic parsers (MapYourShow/a2z markdown, plain PDF-style lists).
- `src/lib/firecrawl.server.ts`, `firecrawl-cache.server.ts`, `rate-limit.server.ts` — scraping, cache reuse window, rate limiting + circuit breaker.
- `src/lib/scoring.ts` / `scoring.functions.ts` + `scoring_settings` table — user-configurable lead weights/tiers.
- `src/lib/outreach.functions.ts`, `email-template-engine.ts`, `outreach-send.server.ts`, `templates.functions.ts` — drafts, templates, sending.
- `src/lib/crm.functions.ts`, `hubspot.server.ts` — HubSpot sync (company/contact ids on `leads`).
- DB: `research_runs`, `events`, `leads` (exhibitor + lead + contacts in `decision_makers` jsonb), `outreach_emails`, `email_templates`, `digest_schedules`, `notifications`, `scoring_settings`, `firecrawl_cache`.
- UI: `runs.$runId.tsx` (tabs incl. Exhibitors + Debug), `ExhibitorsTable.tsx`, `RunProgress.tsx`, `ScoringFeed.tsx`, `DebugPanel.tsx`, `outreach.$runId.tsx`.

## 2. Gap analysis

| Spec area | Today | Gap |
|---|---|---|
| Event verification | events stored straight from directory/AI, no official-site check | whole verification pass, statuses, year matching, exclusion reasons |
| Event scoring | ad-hoc `scoreDirectoryEvent` + AI 0-100 | 8 fixed components, stored breakdown, SPEC_DEFAULT/CUSTOM modes |
| Processing order | score-sorted only | verification-tier ordering |
| Exhibitor evidence | company/booth/website/confidence text only | evidence_text/locator/hash, source_type, extraction_method, hall, profile_url, country, sponsor level, record_status |
| Evidence validation | none — AI rows trusted | normalized snippet matching + rejection, confidence caps |
| Dedup | normalized name + event | instance key incl. profile_url/booth/brand |
| Extraction metrics | partial counters | full per-event metric set |
| Enrichment gate | none | block scoring/contacts on failed gates |
| Contacts | free-form `decision_makers` jsonb with `role_classification`/`evidence_status` | 4-value classification, title priority list, verification_status, evidence fields |
| Email gate/validator | template-driven, always drafts | 6-condition gate, personalization facts, banned-phrase + word-count validator, outreach phase |
| Reports/exports | tabs + CSV | 6 sections, per-lead/run JSON v2.0, extended CSV |
| HubSpot | name/domain search sync | stable keys, stored ids, gated stage advancement |
| Logs | scoring feed + debug counters | structured stage logs with statuses |

## 3. Database design (3 migrations, all nullable/defaulted, RLS + grants unchanged)

1. **Events**: `event_year`, `verified_status` (default `'UNVERIFIED'`), `exhibitor_directory_status` default `'UNKNOWN'`, `days_until_event`, `verification_source_urls text[]`, `verification_checked_at`, `verification_confidence`, `verification_notes`, `event_score`, `event_score_breakdown jsonb`, `scoring_mode`, `excluded`, `exclusion_reason`, `extraction_metrics jsonb`. Indexes on `verified_status`, `event_year`, `event_score`.
2. **Leads (exhibitor instance)**: `displayed_company_name`, `profile_url`, `hall`, `product_category`, `company_description`, `country`, `sponsor_level`, `event_year`, `source_type`, `extraction_method`, `evidence_text`, `evidence_locator jsonb`, `evidence_hash`, `extraction_confidence`, `found_at`, `last_confirmed_at`, `record_status` default `'UNCERTAIN'`, `represented_brand`, `exhibitor_instance_key`, `account_key`, `blocked_reasons text[]`, `conflicts jsonb`. Unique index on `(run_id, exhibitor_instance_key)`; indexes on `event_id`, `normalized_company_name`, `booth_number`, `record_status`.
3. **Outreach**: `draft_status` default `'LEGACY_UNVALIDATED'`, `blocked_reasons text[]`, `personalization_fact jsonb`, `service_offered`, `validation jsonb`, `outreach_phase`, `recommended_send_date`, `follow_up_date`, plus `crm_*` id columns for deal/contact keys on `leads`.

Contacts stay inside `leads.decision_makers` jsonb (schema-validated) rather than a new table, to avoid duplicating an existing abstraction; classification/verification indexes are handled in app-side filters. If querying contacts standalone becomes necessary, a `lead_contacts` table can follow later.

## 4. New/changed TypeScript modules

- `src/lib/verification.ts` + `verification.server.ts` — `EventVerifiedStatus`, `ExhibitorDirectoryStatus`, official-site verify pass, year/date/venue matching, exclusion rules.
- `src/lib/event-scoring.ts` — 8 components, SPEC_DEFAULT/CUSTOM modes, weight normalization, breakdown type.
- `src/lib/evidence.ts` — normalization (entities, Unicode, whitespace, invisibles), snippet matching, hashing, confidence caps (configurable constants).
- `src/lib/exhibitor-parser.ts` — parsers return `{ record, evidence_text, evidence_locator, extraction_method, source_type, confidence }`.
- `src/lib/exhibitor-dedupe.ts` — instance key + account grouping.
- `src/lib/contacts.ts` — title→classification priority tables, `ContactVerificationStatus`, inferred-target-title builder.
- `src/lib/email-gate.ts` + `email-validator.ts` — 6-condition gate, personalization facts, banned-phrase/word-count/unsupported-claim checks, outreach-phase calculation.
- `src/lib/report.ts` + `crm-json.ts` — six report sections and schema-version 2.0 JSON with runtime Zod validation.
- `src/lib/pipeline-log.ts` — structured stage logging (stage enum + status enum) written into the existing run step log.
- `src/lib/backfill.functions.ts` — resumable, idempotent re-verify/re-check command exposed from a settings screen.
- `pipeline.server.ts` refactor: keep `runPipeline` orchestration but move verification, scoring, evidence, dedupe, gating into the modules above.

## 5. Backfill

Legacy rows keep working: events `UNVERIFIED`, exhibitors `UNCERTAIN` with null evidence, contacts `INFERRED`, drafts `LEGACY_UNVALIDATED`. A backfill server function processes a run in batches keyed by last-processed id, re-verifying events, re-checking sources for evidence, revalidating contacts, and revalidating or blocking legacy emails; safe to re-run.

## 6. Testing

Unit (vitest): 8 score components + total, SPEC vs CUSTOM modes, wrong-year/stale/canceled handling, evidence normalization + rejection, AI confidence caps, multi-booth and subsidiary preservation, title classification, email gate conditions, word count, banned phrases, unsupported booth claim, CRM JSON schema, HubSpot key stability.
Integration with saved fixtures under `tests/fixtures/`: static HTML directory, paginated, MapYourShow/a2z, embedded JSON, directory API, floor plan, PDF, sitemap profiles, AI fallback, wrong-year directory, blocked site, partial extraction, duplicates, multi-booth, legacy records, HubSpot retry.

## 7. Compatibility risks

- Gates will visibly reduce lead counts on sources that previously produced unverified rows; mitigated by surfacing blocked reasons rather than hiding them, plus an explicit "allow unverified events" run option.
- Extra verification scrape per event increases Firecrawl usage; verification results are cached and reuse the existing cache window and circuit breaker.
- `decision_makers` jsonb shape changes; a mapping layer reads old `role_classification`/`evidence_status` values.
- Existing CSV consumers get extra columns appended (existing headers keep their meaning).

## 8. Implementation sequence

1. Migration 1 + `verification`, `event-scoring`, exclusion + ordering, Trade Shows tab.
2. Migration 2 + `evidence`, parser evidence outputs, AI rejection, dedupe, metrics, enrichment gate, Exhibitors table columns.
3. Migration 3 + contacts classification/verification, personalization facts, email gate/validator/phase, outreach queue states.
4. Report sections, JSON/CSV exports, HubSpot stable keys + gated stage advancement, structured logs, backfill command.
5. Full unit + integration suite, then typecheck and production build.

Each phase is independently deployable; after implementation I'll report changed files, migrations, config options, test results, and sample verification/evidence/blocked-email/CRM JSON outputs.
