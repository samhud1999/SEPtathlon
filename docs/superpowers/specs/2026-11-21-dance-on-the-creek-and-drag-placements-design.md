# Dance on the Creek + drag-to-rank placements — design

**Date:** 2026-11-21
**Status:** Approved design, pending implementation plan

## Overview

Two commissioner-facing changes to CreekOS, both aimed at running events live
from a phone on the beach:

1. **Dance on the Creek** — replace event 7 ("Blood on the Creek", sin: Lust)
   with a dance-off: randomly draw active tributes into **duos**, each duo
   dances, the commissioner types a **score out of 10**, and both members get
   that score added to their grand total.
2. **Drag-to-rank placements (with ties)** — a new mobile-first "Placements"
   entry mode for the six ranked events, where the commissioner drags tributes
   into finishing order and can group tributes into a **tie** rather than a
   hard 1-2-3 ordering.

Both are scoped to be low-risk: Feature 1 reuses event 7's existing
self-contained side-system; Feature 2 drives the existing
`manualRankOverride` field, which the scoring engine already honours
(including tie-splitting).

## Feature 1 — Dance on the Creek

### Why Approach A (repurpose the side-system)

Event 7 today does **not** go through the ranking engine. It is a self-contained
subsystem: its own table (`blood_matchups`), its own random-pairing generator
(`generateBloodRound`), its own TV stage, and a **separate leaderboard column**
(`bloodTotal`) summed from per-seat deltas in `computeTotals`. A dance-off needs
exactly that shape — random pairs, a per-pair outcome, a separate column — so we
reuse the subsystem and swap only the internal mechanic (PURE/BLOOD cards + a
payoff matrix → a single 0–10 duo score).

The six ranked events, the ranking engine (`computeEventStandings`), and the
god-mode grid are untouched.

### Naming decision (user-facing vs internal)

- **User-facing** strings become "Dance": event name, the leaderboard column
  header, the admin tab/section, the TV label.
- **Internal** identifiers keep the `blood*` names where renaming would force a
  DB migration or broad route churn: the table `blood_matchups`, the API paths
  `/api/blood/*`, and the repo function names stay as-is. This is a deliberate
  risk-minimising choice for a live, already-deployed party app. A later
  cleanup PR may rename internals; it is out of scope here.

### Data model (reuse, no schema migration)

Reuse `blood_matchups` unchanged:

- A duo = a matchup row with `playerAId`, `playerBId` (`matchupType = "1V1"`).
- An odd-count trio = `matchupType = "3WAY"` with `playerCId` set (already how
  `generateBloodRound` handles an odd number of candidates).
- The duo's 0–10 **score** is stored as the per-seat deltas:
  `deltaA = deltaB = (deltaC =) score`. `computeTotals` already sums revealed
  matchups' deltas into each player's `blood` total, so each member of a duo
  receives the duo's score exactly once, with no change to `computeTotals`.
- `isRevealed` is repurposed to mean **"scored / locked in"**: a duo contributes
  to the Dance total only once it has a score. (It no longer gates hidden
  cards.) Columns `cardA/B/C` become vestigial and are left unused/null.
- `roundNumber` is fixed to `1` (the dance-off is a single draw, not three
  rounds). The round selector UI is removed.

### Scoring type

- Rename the scoring type `BLOOD_MATRIX` → `DANCE_OFF` in `ScoringType`
  (`src/lib/types.ts`), `SCORING_TYPES` (`src/lib/constants.ts`), and every
  `=== "BLOOD_MATRIX"` guard (`EventsTab.tsx`, `scoring.ts`, `core.ts` →
  `recalcEvent` early-return, `Spotlight.tsx`).
- `recalcEvent` continues to early-return for `DANCE_OFF` (event 7 has no
  `event_results` rows and no ranking — its points live only in the matchup
  deltas / Dance total).
- `computeEventStandings` continues to return `[]` for `DANCE_OFF`.

### Event seed + migration

Update `EVENTS_SEED[7]` to
`{ id: 7, slug: "dance-on-the-creek", name: "Dance on the Creek", sin: "Lust", scoringType: "DANCE_OFF" }`.

`ensureSeeded` currently uses `onConflictDoNothing`, so on an **already-seeded**
database the rename would not take effect. Change the events insert to
`onConflictDoUpdate` on `events.id`, setting `name`, `slug`, `sin`, and
`scoringType` from the seed (leave `status` untouched so a live/completed event
keeps its state). This makes the rename and scoring-type change propagate on
boot to existing deployments and the local PGlite store.

### Admin UI — "Dance" guided mode (replaces `GuidedBlood`)

A rewrite of the event-7 guided component (keep the file wired through
`EventsTab`'s `scoringType === "DANCE_OFF"` branch):

- **DRAW DUOS** button — calls the existing random-pairing generator (round 1).
  If duos already exist, show a confirm sheet ("Reshuffle wipes the current
  duos and their scores. Draw fresh pairs?") before redrawing.
- One **duo card** per matchup, listing the 2 (or 3) members and a single
  **score input (0–10, decimals allowed, e.g. 7.5)**. Saving writes the score
  to every seat's delta and marks the row scored. Scores are freely
  **amendable** at any time; re-saving recomputes the leaderboard.
- Keep the existing **manual matchup builder** (hand-pick 2–3 tributes to form a
  duo/trio) for benched/late/odd-out cases.
- A duo card keeps its overflow menu's **delete**; "unreveal" becomes a
  **clear score** action (resets deltas to 0 and un-scores the row so it drops
  from the Dance total).

### API changes

- `/api/blood/generate` — unchanged (random pairing). Round is always 1.
- `/api/blood/matchups` (POST create, GET list) — unchanged.
- `/api/blood/matchups/:id` PATCH — replace the card/reveal/delta logic in
  `patchBloodMatchup` with a **score** path: accept `{ score: number | null }`
  where `0 ≤ score ≤ 10`. Setting a score writes `deltaA/B/C = score` and
  `isRevealed = true`; `score: null` clears (deltas → 0, `isRevealed = false`).
  Remove the `cardA/B/C`, `reveal`, `unreveal`, and raw `deltaA/B/C` inputs and
  the `BLOOD_REVEAL` broadcast built from card outcomes. (Optionally emit a
  lightweight broadcast like "Duo scored N/10" — see Open questions.)
- Update `BloodCreateBody` / add a `score` field to the matchup-patch schema in
  `src/lib/api-schemas.ts`; drop `BloodCard`-based card validation.

### Leaderboard + state contract

- `LeaderboardRow.bloodTotal` is kept as the storage field but surfaced on the
  TV as the **"Dance"** column (rename the header/label in
  `src/app/tv/Leaderboard.tsx` and the trend-cell key in `TvDashboard.tsx`; the
  value stays `row.bloodTotal`). Formatting changes from a signed +/- delta to a
  plain points value (dance scores are always ≥ 0).
- `BloodSeat.card` / `BloodSeat.cardSet` and the public reveal gating in
  `toMatchupShape` become irrelevant; the seat's `delta` carries the score. The
  public payload can expose the score directly (no hidden-until-revealed step).
- The `blood` key in `StatePayload` stays (its matchups now represent duos).
  Renaming the contract field is out of scope.

### TV (minimal)

Per the "keep it minimal" decision, **no bespoke dance animation**:

- The dance-off shows through the normal live-event spotlight and the renamed
  **Dance** leaderboard column.
- Reduce the existing Blood TV stage (`BloodStage.tsx`, the `BLOOD_STAGE` TV
  mode) to a plain list of duos + their /10 scores so the TV-mode plumbing
  (`TV_MODES`, `api/tv-mode`, `SystemTab` remote switch, `Spotlight`) keeps
  working without a broken card UI. Keep the `BLOOD_STAGE` enum **value** to
  avoid migrating the persisted `app_state.tv_mode`; relabel it "Dance stage" in
  the UI only.

### Removed

- `BLOOD_MATRIX_1V1`, `BLOOD_3WAY`, `ROUND_STAKES` (`constants.ts`).
- `computeBloodDeltas` (`scoring.ts`) and its tests.
- Card toggles, reveal/unreveal flow, round selector, and the card-outcome
  broadcast (`BETRAYAL` / `HONOUR` / `MUTUAL DESTRUCTION`).
- The joker remains non-placeable on event 7 (unchanged behaviour).

### Edge cases

- **Odd active count** → one trio; all three members get the trio's single
  score.
- **Benched / late tributes** → the draw only pairs `isActive` players; the
  manual builder covers stragglers.
- **Fewer than 2 active** → generator throws the existing "not enough tributes"
  error; surface it as a toast.
- **Decimals** → score is `doublePrecision`; allow one-decimal input, clamp to
  `[0, 10]`, reject non-numeric.
- **Reshuffle after scoring** → confirm sheet warns scores are wiped.

## Feature 2 — Drag-to-rank placements with ties

### Scope

A new **"Placements"** entry mode available on the six ranked events
(ELIMINATION, RAW_HIGH, FRUIT_SPLIT) — a third toggle alongside Guided and
God-mode in `EventsTab`. **Not** shown for the dance-off (score-based, not
ranked).

### Behaviour

- A vertical, mobile-first list of the event's active tributes (seeded from the
  current `calculatedRank` order if present, else roster order).
- **Drag to reorder** into finishing order using **@dnd-kit** (added as a
  dependency) with its touch/pointer sensors for a solid phone feel.
- **Ties:** tributes can be grouped into the same placement slot (e.g. a
  "tie with the one above" toggle, or dropping onto an existing slot). A slot
  holds one or more tributes who share a placement.
- **Save** issues one `POST /api/events/:id/score` call setting each tribute's
  `manualRankOverride` to the **start rank of its tie-group** (slot 1 → rank 1;
  a 2-way tie in slot 2 → both rank 2; next slot → rank 4; etc.). The scoring
  engine's locked-group logic then splits the covered ranks' points and rounds
  up to the half (e.g. a 2-way tie for 1st → both 18; a 2-way tie for 3rd → both
  13), exactly as the existing tie rules specify.
- **Clear** sets every tribute's `manualRankOverride` back to `null` (revert to
  automatic ranking).

### Why overrides (not a new field)

`manualRankOverride` already "beats everything" in the engine and already
handles tied groups occupying consecutive rank slots with split points
(`computeEventStandings` → `lockedGroups`). Driving it from a drag UI needs no
engine or schema change — only a new client component and a thin use of the
existing score endpoint.

### Interaction notes

- Large touch targets, a visible drag handle, and a non-drag fallback
  (up/down + "tie" controls) so it degrades gracefully.
- Show each tribute's resulting placement number and projected points live as
  the order changes, so the commissioner sees the effect before saving.

## Non-goals

- No bespoke dance-off TV animation.
- No rename of internal DB tables, API routes, or the `blood`/`bloodTotal`
  contract fields.
- No change to events 1–6 scoring, the joker, decrees, snapshots, or backup
  format (beyond the vestigial card fields now going unused).
- Drag-to-rank does not apply to the dance-off.

## Testing

- **Unit:** remove `computeBloodDeltas` tests; add tests that a duo score
  propagates to each member's Dance total (via `computeTotals`), including the
  trio case and score amendment/clear. Keep/confirm the existing tie-split
  tests in `computeEventStandings` (they already cover Feature 2's engine
  behaviour).
- **e2e (`scripts/e2e-sim.ts`):** replace the blood card/reveal/matrix
  assertions (rounds, PURE/BLOOD payoffs, 2× stakes) with: draw duos → score a
  duo N/10 → assert both members' `bloodTotal`/total increase by N; score a trio;
  amend a score; clear a score. Add a placements flow: drag-equivalent override
  POST producing a tie and asserting the split points.
- **Typecheck:** `npm run typecheck` after the `ScoringType` rename.
- **Screenshots:** `scripts/screenshots.cjs` selects event "7"; update any
  blood-stage capture expectations.

## Migration / compatibility

- `ensureSeeded` upsert propagates the event-7 rename + `DANCE_OFF` type on boot
  to existing DBs.
- Existing `blood_matchups` rows from prior play (if any) carry stale cards and
  matrix deltas; a reshuffle or clear-score resets them. For a clean start the
  commissioner can delete event-7 matchups (existing delete action) before the
  dance-off.
- Export/restore (`buildDump`, `backup.ts`) keep the existing `bloodMatchups`
  shape; the `card*` fields serialise as null/unused. No format-version bump.

## Open questions (safe defaults chosen; flag on review)

1. **TV stage** — default: reduce the Blood stage to a minimal duo+score list,
   keeping the `BLOOD_STAGE` enum value. Alternative: drop the TV mode entirely
   (larger change). Chosen: keep minimal.
2. **Scored broadcast** — default: emit a small "Duo scored N/10" broadcast so
   the TV judgment feed reflects dance scoring. Alternative: no broadcast.
3. **Score granularity** — default: any decimal in `[0, 10]`. Could restrict to
   whole/half points if preferred.
