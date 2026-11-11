# CreekOS Builder Contract (normative)

Read with: `docs/PRD.md` (product truth), `docs/superpowers/specs/2026-11-11-creekos-design.md`
(decisions), `fixtures/sample-state.json` (**normative** `/api/state` example — its arithmetic is
consistent and its shapes are law), and `src/lib/types.ts` + `src/lib/api-schemas.ts` +
`src/lib/constants.ts` (compile-time law; do not edit them — ask the orchestrator via your report
if one is wrong).

## Ground rules (every agent)

- Own ONLY your listed files. Never touch another agent's files, `src/lib/*`, configs, or docs.
- NO git commands, ever. No new dependencies. No `.env` edits.
- Run your own checks before reporting: `npm run typecheck` always; `npm test` if you own tests;
  `npm run build` if you own app routes/pages.
- User-entered text (names, epithets, reasons, notes) renders through React text nodes only.
  `dangerouslySetInnerHTML`, `alert`, `confirm`, `prompt` are banned.
- Points display: integers bare ("13"), halves with one dp ("13.5") — use `fmtPts` from
  `src/lib/format.ts`. Signed where meaningful ("+5", "−3").
- Dates are ISO UTC strings in payloads; clients render local time (`fmtTime`).

## File ownership

| Agent | Owns |
| --- | --- |
| engine | `src/lib/scoring.ts`, `tests/scoring.test.ts` |
| db | `src/db/**`, `drizzle/**` (generated), `tests/repo.test.ts` |
| api | `src/app/api/**` (incl. replacing the `healthz` stub and adding `mock-state`), `scripts/e2e-sim.ts`, `scripts/seed-demo.ts` |
| tv | `src/app/tv/**` |
| admin | `src/app/admin/**` |

## Runtime & env

- `ADMIN_PIN` (default `2026`), `DATABASE_URL` (prod required → postgres-js; absent in dev → PGlite
  file db at `./data/creekos`), `PORT` (Railway). Dev server: `npm run dev` → http://localhost:8765.
- `getDb()` (db agent) must run committed `drizzle/` migrations then seed idempotently: 7 events
  from `EVENTS_SEED`, one `app_state` row (id=1). Cache the instance on `globalThis` (dev HMR).

## Auth

- Cookie `creekos_admin` = `adminCookieValue()` (sha256 of `creekos|<pin>`), httpOnly, path=/,
  sameSite=lax, 7 d, secure in production. `POST /api/login {pin}` sets it (401 on wrong pin);
  `POST /api/logout` clears it. Scripts may send `x-admin-pin: <pin>` instead.
- `isAdminRequest(req)` from `src/lib/auth.ts` gates every mutator + the two admin GETs
  (`/api/decrees`, `/api/blood/matchups`); failures return `unauthorized()` → 401 `{error}`.

## Endpoints

All JSON. Errors: `{ "error": string }` (400 zod/semantic, 401 auth, 404 missing id, 409 conflict).
Every route handler: `export const dynamic = 'force-dynamic'`. Mutators return the fresh
`StatePayload` as the response body (so admin can refresh instantly) unless noted.

| Method & path | Auth | Body (Zod schema) → behaviour |
| --- | --- | --- |
| GET `/api/state` | public | → `StatePayload`. ETag `W/"v{version}"`; honour `If-None-Match` → 304. `Cache-Control: no-store`. |
| GET `/api/mock-state` | public | → the parsed contents of `fixtures/sample-state.json` (dev aid for `/tv?mock=1`, `/admin` dev). |
| GET `/api/healthz` | public | → `{ ok: true, version: <stateVersion> }` (DB-touching: used by Railway healthcheck). |
| POST `/api/login` | public | `LoginBody {pin}` → set cookie, `{ok:true}`. |
| POST `/api/logout` | public | clear cookie, `{ok:true}`. |
| POST `/api/players` | admin | `PlayerActionBody` discriminated on `action`: `create {name, epithet?}` · `update {playerId, name?, epithet?, isActive?, rockCurseLevel? (0–3)}`. |
| POST `/api/events/[id]/score` | admin | `ScoreBody {results: ScoreInput[], quiet?}` → `upsertScores`. See **Score semantics**. |
| POST `/api/events/[id]/preview` | admin | `PreviewBody {results: ScoreInput[]}` → `{standings: Standing[]}`, no writes, no version bump. |
| POST `/api/events/[id]/status` | admin | `EventStatusBody {status}`; setting LIVE demotes any other LIVE event to UPCOMING. |
| POST `/api/events/[id]/joker` | admin | `JokerBody {playerId, active, force?}`; `active:true` on a player whose joker sits on a different event → 409 unless `force`; joker valid on events 1–6 only (400 on 7). |
| POST `/api/decrees` | admin | `DecreeCreateBody {playerIds: number[] (min 1), pointsDelta (≠0), sinTag, reason}` → one decree row per player + ONE `DECREE` broadcast naming all players. |
| GET `/api/decrees` | admin | → `{decrees: DecreeRow[]}` full history, newest first. |
| PATCH `/api/decrees/[id]` | admin | `DecreePatchBody {pointsDelta?, sinTag?, reason?, isVoided?, playerId?}`. |
| GET `/api/blood/matchups` | admin | → `{matchups}` full rows **including unrevealed cards**. |
| POST `/api/blood/generate` | admin | `BloodGenerateBody {roundNumber 1–3}` → wipe that round's UNrevealed matchups, randomly pair active players not already in a revealed matchup of the round; odd leftover → one 3WAY; <2 pairable → 400. |
| POST `/api/blood/matchups` | admin | `BloodCreateBody {roundNumber, playerIds: [a,b] or [a,b,c]}` manual matchup. |
| PATCH `/api/blood/matchups/[id]` | admin | `BloodPatchBody {cardA?, cardB?, cardC?, reveal?, unreveal?, deltaA?, deltaB?, deltaC?}`. `reveal:true` requires all seats carded (else 409) → compute deltas via `computeBloodDeltas` (round 3 = ×2), set `isRevealed`, broadcast `BLOOD_REVEAL`. Manual delta fields apply only to revealed matchups (post-reveal amendment). `unreveal:true` flips it back (deltas kept, totals exclude them). |
| DELETE `/api/blood/matchups/[id]` | admin | removes it (revealed or not). |
| POST `/api/tv-mode` | admin | `TvModeBody {mode}` → persists + `TV_MODE` broadcast. |
| GET `/api/export` | admin | → `ExportShape` with `Content-Disposition: attachment; filename="creekos-export-<ISO>.json"`. |
| POST `/api/restore` | admin | `RestoreBody {confirm:"RESTORE", dump: ExportShape}` → validate dump FIRST (Zod), snapshot current ("pre-restore"), then wipe+reinsert preserving ids in one tx. Invalid → 400, untouched. |
| GET `/api/snapshots` | admin | → `{snapshots: [{id, createdAt, note, bytes}]}`. |
| POST `/api/snapshots` | admin | `{note?}` manual snapshot. |
| GET `/api/snapshots/[id]` | admin | snapshot JSON as attachment. |
| POST `/api/snapshots/[id]/restore` | admin | `{confirm:"RESTORE"}` → restore that snapshot (same safety as /api/restore). |

### Score semantics (`ScoreInput`, PRD §4 Tab 2)

Per input row (all upserted in ONE transaction, then event recalc + totals recalc):
- Field omitted → unchanged. Field explicitly `null` → cleared. Row auto-created on first touch
  (lives default `DEFAULT_LIVES`).
- `eliminate: true` → `livesRemaining=0`, assign `eliminationOrder = max(order in event)+1` — but
  **no-op if the player already has an order** (double-tap safety).
- `revive: true` → `eliminationOrder=null`, `livesRemaining` = provided value or 1.
- `livesRemaining` clamps 0–9. `manualRankOverride` ≥1; `manualPointsOverride` any; `rawScore`,
  `weightAGrams/BGrams` ≥0.
- `quiet:true` (guided lives/curse taps) skips the EVENT_SCORE broadcast; default commits one
  (`message` e.g. "Krillion scores committed" / "Davo ELIMINATED — 11th of the Creek").
- Recalc per PRD §3: override lock → metric sort (RAW_HIGH desc / elimination positional:
  alive-then-order-desc / FRUIT err asc) → tie split `ceilToHalf(mean)` → joker ×2 → points
  override wins all. Unmetric'd rows (null raw/weights) stay `calculatedRank:null`, 0 pts.

## StatePayload field notes (shapes in `src/lib/types.ts`; example in fixture)

- `leaderboard` is ACTIVE players only, ordered by rank then name; `rank` uses competition ranking
  (ties share, next skips); `trend` = prevRank − rank (+ = climbed), null when no previous ranking.
- `eventPoints` maps event id ("1"–"6") → `finalEventPoints`, **only for events where the player
  has a result row**; render "—" otherwise. Blood lives in `bloodTotal`, decrees in `decreeTotal`.
- `eventResults` keyed by event id string; includes rows for ALL events 1–6 (and none for 7).
- `blood.matchups[].players[].card` is `null` until `isRevealed` (TV must never leak picks);
  `cardSet` says a pick is locked in. `createdAt` drives the TV's 90 s countdown.
- `decrees` = last 20 (incl. voided, flagged); `broadcasts` = last 10, ascending id.
- Poll contract: clients poll (TV 2.5 s, admin 5 s), skip re-render when `version` unchanged,
  show a reconnect indicator after 2 consecutive failures, and NEVER clear the last good state.

## Broadcasts → TV behaviour

| type | payload | TV reaction |
| --- | --- | --- |
| DECREE | `{playerNames[], pointsDelta, sinTag, reason}` | Full-screen 5 s overlay: "⚡ JUDGMENT FROM THE CREEK ⚡ / {+N/−N} POINTS TO {NAMES} / Sin of {sinTag}: {reason}" |
| EVENT_SCORE | `{eventId, eventName, message}` | Top banner ~4 s |
| BLOOD_REVEAL | `{matchupId, roundNumber, headline, lines[]}` | Stage flash + headline ("BETRAYAL" / "HONOUR AMONG TRIBUTES" / "MUTUAL DESTRUCTION") |
| TV_MODE | `{mode}` | Switch layout immediately |

TV tracks the max broadcast id it has handled (start = max in first payload, so no replay on
reload) and plays newer ones once, queued sequentially.

## Styling

- Tokens ONLY from `src/app/globals.css`: `--bg #0B0F17`, `--bg-raised`, `--panel`, `--line`,
  `--blood #DC2626`, `--blood-bright`, `--gold #F59E0B`, `--gold-bright`, `--bone` (body text),
  `--ash` (muted), `--ok`. Fonts: `var(--font-display)` Cinzel (headings/lore),
  `var(--font-ui)` Inter, `var(--font-mono)` JetBrains Mono + `tabular-nums` for every number.
- CSS Modules per page (`tv.module.css`, `admin.module.css`). TV is designed for 1920×1080 at
  ~3 m viewing distance: type scales with `clamp()`/viewport units, 15 rows must fit without
  scroll. Admin is mobile-first ≤480 px, bottom nav, 48 px touch targets, thumb-reachable
  primary actions.
- Lore voice everywhere ("The Sanctum of Separation Creek", "The Purified Sovereign" under rank 1,
  "The Vessel of Sins" above last) — but numbers always win over flavour for legibility.

## Fixture

`fixtures/sample-state.json` is a mid-tournament Saturday: 13 tributes, E1–E2 COMPLETED (E2 has
the 72/72 tie → 13.0 each and Chooka's joker 16→32), E3 LIVE partial, E5 three weigh-ins, one
revealed blood matchup (+5/−3), four decrees (one voided). Leaderboard totals are hand-verified.
UI agents build against it via `/tv?mock=1` / direct import in dev; db agent asserts
key-compatibility; never edit it.
