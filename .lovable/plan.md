## Goal

The "Live scoring decisions" feed currently renders inline on the run page while a run is in progress, crowding the main screen. Move it to its own page.

## Changes

1. **New route** `src/routes/_authenticated/runs.$runId.activity.tsx` (URL `/runs/$runId/activity`)
   - Subscribes to the same run record (same query + realtime subscription used by the run page) so entries stream live.
   - Renders the existing `ScoringFeed` component full-width, with a back link to the run.
   - Own `head()` metadata (title/description/og).

2. **Run page** `src/routes/_authenticated/runs.$runId.tsx`
   - Remove the inline `<ScoringFeed ... />` block.
   - Add a compact link/button next to the Dashboard/Exhibitors/Report switcher: "Live scoring decisions" with the current entry count, opening the new page. Shown whenever there are feed entries (not just while running), so it stays reachable after completion.

3. Leave the "Extraction debug" panel where it is — only the scoring feed moves.

## Technical notes

- Feed data lives in `research_runs.counters.scoring_feed`; the new page reads it the same way the run page does, so no pipeline or database change is needed.
