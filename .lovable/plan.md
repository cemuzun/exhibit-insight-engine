## Verdict

The exact string `[REGISTER AS A VISITOR](https://www.gastechevent.com/visit/visitor-registration/)` **is rejected by the current code**. I verified this by executing the real modules:

- `cleanCompanyName` → `"REGISTER AS A VISITOR"`
- `isLikelyCompanyName(raw)` → `false`
- `hasCompanyNameStructure(raw)` → `false`
- `isLikelyCompanyName("Age Policy")` → `false` (the footer item seen alongside it)

Three independent guards in `src/lib/exhibitor-parser.ts` fire on it: the leading-`register` rule (line 67), the `register as a|registration` rule (line 88), and the `\]\(|https?://` leftover-markup rule (line 86).

So what the user is seeing is **not produced by today's extractor**.

## Why it can still be on screen

**1. Old run data is stored and never re-filtered.**
`src/lib/pipeline.server.ts:1091` persists the whole live counter object into `research_runs.counters` (`await admin.from("research_runs").update({ counters })`), including `exhibitor_samples`. `src/components/LiveExhibitors.tsx` renders those samples verbatim — company, show, source host, "52m ago". That matches the reported screen text exactly. Any run created before the hard-reject rules were added keeps that row forever; the filters only apply at extraction time, never at read time. The same is true for `leads` rows written at `src/lib/pipeline.server.ts:2153` and shown by `ExhibitorsTable.tsx` / `ShowsExplorer.tsx`.

**2. A real residual bug: validated cleaned, stored raw.**
In `addCandidateExhibitors` (`src/lib/pipeline.server.ts:1810-1889`) every gate runs on the cleaned form, but the saved record is built with `{ ...item }` (line 1869), so `company_name` keeps whatever the extractor emitted — markdown, HTML, trailing bullets and all. Only `booth_number` is replaced by the validated value.

Verified with the real validator: `"[ACME BOOTH SYSTEMS INC](https://www.acme.com/exhibitors/acme)"` returns `verdict: "accept"`, score 7 — and would be persisted and displayed with the brackets and URL intact. So a markdown-wrapped *legitimate* company still renders as raw markup today. This is the same visual failure class the user reported, just with a name that survives the reject list.

Same gap in the deterministic parser: `parseExhibitorsFromMarkdown` sets `normalized_company_name: name` (the display string, not `normalizedCompanyKey(name)`) at lines 167 and 195, and the fallback in `buildLeadRow` (`src/lib/pipeline.server.ts:349`) copies `company_name` into it.

## Smallest robust fix

One normalization point plus one read-time guard — no changes to the reject rules, which already work.

1. **Normalize at ingestion** — in `addCandidateExhibitors`, build `const company = cleanCompanyName(item.company_name)` once, run every existing gate against it (`normalizedCompanyKey`, `isLikelyCompanyName`, `evidenceLineFor`, `validateExhibitorRow`, both key builders), and write `company_name: company` into the record instead of inheriting it from `...item`. That makes the stored value equal to the validated value, which is the invariant that is currently broken.

2. **Fix `normalized_company_name`** — set it from `normalizedCompanyKey(company)` in the parser and in the pipeline record, so dedupe keys never carry markup.

3. **Guard the display path** — apply `isLikelyCompanyName` when reading `counters.exhibitor_samples` in the run route before passing them to `LiveExhibitors`, so pre-fix runs stop showing chrome rows without a re-run or a data migration. This is a pure presentation filter and covers all historical rows.

Deliberately *not* doing: widening `HARD_REJECT_RE` (it already catches this), and back-filling stored rows (the read-time guard is cheaper and non-destructive).

## Regression tests

`tests/unit/exhibitor-parser.test.ts`
- The exact reported string is rejected by `isLikelyCompanyName` and absent from `parseExhibitorsFromPlainList` / `parseExhibitorsFromMarkdown` output.
- `"Age Policy"`, `"Log In / Create Account"`, `"OCTOBER 12-15, 2026"` stay rejected (locks in the earlier fixes).
- `cleanCompanyName("[Acme Widgets Inc](https://acme.com)")` → `"Acme Widgets Inc"`.

`tests/unit/exhibitor-validation.test.ts`
- `validateExhibitorRow` on the reported string → `verdict: "reject"`, `reason: "NAME_NOT_COMPANY_SHAPED"`.
- A markdown-wrapped legitimate name is accepted **and** the caller-facing name contains no `[`, `]`, `(` or `http` — the assertion that fails today.

New `tests/unit/exhibitor-ingest.test.ts` (extracting the normalization step into a small exported helper so it is testable without running the whole pipeline)
- A mixed batch (one chrome row, one markdown-wrapped real company, one plain company) yields exactly two records, both with clean names and markup-free `normalized_company_name`.

## Files touched by the fix

- `src/lib/pipeline.server.ts` — normalization inside `addCandidateExhibitors` (~lines 1818-1889)
- `src/lib/exhibitor-parser.ts` — `normalized_company_name` uses the normalized key
- `src/routes/_authenticated/runs.$runId.tsx` — filter `exhibitor_samples` before rendering
- three test files above

No database migration, no changes to the reject rules, no UI redesign.
