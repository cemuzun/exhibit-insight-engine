
## What we're building

A B2B sales intelligence web app that takes a trade show directory or event URL, scrapes exhibitors with Firecrawl, runs the multi-stage analysis workflow through Lovable AI, and returns ranked leads with decision-maker targets, budget estimates, personalized outreach, and CRM-ready JSON. Users sign in, save every research run, and can revisit past runs.

## Stack

- TanStack Start + Tailwind (existing).
- **Lovable Cloud** for auth (email/password + Google) and to store users, research runs, events, and leads.
- **Lovable AI Gateway** (`google/gemini-3.1-pro-preview` for heavy reasoning, `google/gemini-3.6-flash` for extraction/normalization).
- **Firecrawl connector** for scraping trade show directories, event sites, and exhibitor lists (`scrape`, `map`, `crawl`).
- All AI + Firecrawl calls in `createServerFn` handlers; nothing runs in the browser except UI.

## Data model (Lovable Cloud)

- `profiles` — id → auth.users, display_name.
- `research_runs` — id, user_id, input_url, input_source_type, target_market, filters (jsonb), status (`queued|scraping|analyzing|complete|failed`), executive_summary (jsonb), limitations (text[]), created_at.
- `events` — id, run_id, event_name, official_url, industry, dates, venue, city, state, event_opportunity_score, recommended_outreach_phase, source_urls (text[]).
- `leads` — id, run_id, event_id, full lead record per Section 4 JSON schema (company info, booth analysis, score_breakdown jsonb, decision_makers jsonb, estimated_project_value low/high, priority_tier, personalized_email, linkedin_message, unknown_fields, source_urls).

Full RLS: every table scoped to `auth.uid()`. GRANTs to `authenticated` + `service_role`.

## Pages / routes

- `/` — public landing: what the tool does, sample output screenshot, "Sign in to start".
- `/auth` — email/password + Google sign-in (public).
- `/_authenticated/dashboard` — list of past research runs with status, input, tier-1 count, created date. "New research run" button.
- `/_authenticated/runs/new` — form: source URL, source type (directory / event / exhibitor list), target market, priority industries (multi-select), min project value, max leads per show, target services. Submits → creates run → redirects to run detail.
- `/_authenticated/runs/$runId` — the results view. Two modes toggled at the top:
  - **Dashboard mode** (default): executive summary cards, ranked opportunity table (sortable by score/tier/date), click a row → side panel with the full detailed lead record + outreach drafts.
  - **Report mode**: long-form scrollable rendering of all 4 sections (executive summary → ranked table → detailed lead records → CRM JSON with copy/download button).
  - Live status while processing (polls run status; shows stage-by-stage progress: validating source → researching events → extracting exhibitors → enriching → discovering decision makers → scoring → complete).

## Backend workflow (server functions)

One orchestrating server fn `runResearch({ runId })` runs the stages in order and updates run status/rows as each stage completes so the UI can stream progress:

1. **Validate source** — classify URL, record access date.
2. **Scrape events** (Firecrawl `scrape` for directory pages; `map` when the directory has many linked events). Extract event metadata, dedupe.
3. **AI rank events** (Gemini Pro) → write to `events` table with opportunity score + outreach phase.
4. **Scrape exhibitors** per top-ranked event (Firecrawl `scrape` on exhibitor list; `crawl` when list is paginated). Normalize names, drop non-companies (associations, media partners).
5. **Enrich companies** — Firecrawl `search`/`scrape` corporate sites; AI extracts industry, size, growth signals; each field tagged CONFIRMED / INFERRED / ESTIMATED / UNKNOWN with sources.
6. **Booth + service-need analysis** — AI over enriched context and any booth photos found; outputs are labeled observational.
7. **Decision-maker discovery** — AI proposes titles + candidate names using company-size logic from the spec. When a person cannot be verified, returns a Recommended Target Title with confidence < 70 and no fabricated email/LinkedIn.
8. **Score leads** (deterministic code applying the 9-component weighted model; AI supplies component justifications). Assigns tier.
9. **Generate outreach** — per-lead subject+email+LinkedIn message using only verified personalization points.
10. **QA pass** — final AI check against Section 20 checklist; flags any lead that fails and lowers confidence.

All AI calls use structured output (`Output.object` + Zod schema) matching the Section 4 JSON so results insert directly into `leads`.

## Anti-hallucination enforcement

- Every `decision_maker` row stores `evidence_status`, `contact_confidence`, and `source_urls`; the UI hides email/LinkedIn fields entirely when confidence < 70 and shows "Recommended target title" instead.
- Every estimate field renders with an "Estimate — assumptions" tooltip; confirmed fields render with a source link.
- Leads with missing verification cannot be marked Tier 1 by the scoring code regardless of AI suggestion.
- Human-review banner on run detail: "Review before sending" with checklist from Section 18.

## UI details

- Design direction: professional B2B intelligence tool — dark navy + electric-blue accent, dense data-first layout, mono for scores/IDs, sans for content. Similar in feel to Attio / Clay. Not generic SaaS purple.
- Ranked opportunity table with tier badges (T1 red, T2 orange, T3 yellow, T4 gray), score bar, action column.
- Lead detail panel: tabs for Overview / Booth & Services / Decision Makers / Outreach / Sources / Raw JSON.
- Report mode uses print-friendly typography; "Download JSON" and "Copy JSON" buttons.

## Out of scope for v1

- Sending emails directly (human-review requirement — we draft only).
- CRM push integrations (Salesforce/HubSpot). We generate the CRM JSON; user copies/downloads.
- PDF/spreadsheet upload as input (URL-based only in v1, per your answer). Easy to add later.
- Live web browser control / image analysis of booth photos (we'll extract linked image URLs and let AI reason from context; actual vision analysis can be added later).

## Setup steps at build time

1. Enable Lovable Cloud + configure email/password + Google auth.
2. Connect Firecrawl connector (user runs the connect flow).
3. Run migration for the 4 tables + RLS + GRANTs.
4. Build server functions, then routes, then UI.

## Open questions I'll assume unless you say otherwise

- Google sign-in **on** in addition to email/password.
- Runs are private to the user who created them (no team sharing in v1).
- Firecrawl is the only scraper; if it fails on a source, the run surfaces the limitation rather than falling back to another provider.
