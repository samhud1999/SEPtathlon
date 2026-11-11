# CreekOS SEPtathlon Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution note (this run):** Sam enabled ultracode orchestration, so this plan
> executes as a Workflow: Task 2 → 3 → 4 run as a sequential agent chain while
> Tasks 5 and 6 run in parallel against `docs/CONTRACT.md` +
> `fixtures/sample-state.json`. Agents NEVER run git; the orchestrator commits at
> integration milestones. Each agent owns only its listed files.

**Goal:** Ship the CreekOS tournament tracker (PRD `docs/PRD.md`): one Next.js service on Railway Postgres serving a public `/tv` broadcast dashboard, a PIN-gated `/admin` commissioner portal, and a fully amendable scoring engine.

**Architecture:** Single Next.js 15 App Router service. Pure-function scoring engine (`src/lib/scoring.ts`) → Drizzle repo layer owning transactions/recalc/broadcasts (`src/db/*`) → thin Zod-validated route handlers (`src/app/api/*`) → two polling client UIs. Postgres via `postgres` driver in prod, PGlite locally; migrations committed and run on boot.

**Tech Stack:** Next.js ^15.5, React 19, TypeScript strict + @total-typescript/ts-reset, Zod v4, Drizzle ORM + drizzle-kit, postgres (postgres-js), @electric-sql/pglite, motion, Vitest, tsx. npm. Docker + railway.json deploy.

**Spec:** `docs/PRD.md` (product, verbatim) + `docs/superpowers/specs/2026-11-11-creekos-design.md` (decisions) + `docs/CONTRACT.md` (normative API/state/file-ownership contract) + `fixtures/sample-state.json` (normative `/api/state` example — arithmetically consistent).

## Global Constraints

- Node ≥ 22; npm; TypeScript `strict` + `noUncheckedIndexedAccess`; `@total-typescript/ts-reset` loaded via `reset.d.ts`.
- Every API input crosses a Zod schema from `src/lib/api-schemas.ts`; error replies are `{ "error": string }` with 400/401/404/409.
- All point values rounded to 1 dp (`round1`); error % to 3 dp; master points table exactly PRD §3.1; tie split = `ceilToHalf(mean)`.
- Mutating endpoints require admin auth (cookie `creekos_admin` or `x-admin-pin` header); `/api/state`, `/api/healthz`, `/tv` are public.
- Every mutation = one transaction; bumps `app_state.state_version`; recalculates affected event + totals before commit (PRD §3).
- No `dangerouslySetInnerHTML`; no `alert/confirm/prompt`; no new runtime deps beyond package.json without orchestrator sign-off.
- Theme tokens from `src/app/globals.css` only: bg `#0B0F17`, blood `#DC2626`, gold `#F59E0B` (PRD §5); numerals use the mono font var with `font-variant-numeric: tabular-nums`.
- Prod (`NODE_ENV=production`) requires `DATABASE_URL` (fail fast at boot with a clear message); dev falls back to PGlite at `./data/`.

## Review Focus

1. Double-tap **ELIMINATE** (two rapid POSTs, same player) → exactly one elimination order; second call is a no-op. — test in Task 3.
2. `POST /api/restore` with malformed/truncated JSON → 400, **database untouched**, pre-restore snapshot only on valid input. — test in Task 3.
3. Fresh boot, empty roster → `/api/state` returns a valid empty payload and `/tv` renders a "The tributes gather" idle state, not a crash. — test in Task 3; handled UI in Task 5.
4. `manual_points_override` + joker both set → override wins outright, never doubled. — test in Task 2.
5. Player named `<script>alert(1)</script>` with reason text full of quotes renders inert as text on TV and admin. — Tasks 5/6 use React text rendering only; reviewer verifies.

---

### Task 1: Scaffold, contract, and shared types (orchestrator — done inline)

**Files:** Create: `package.json`, `tsconfig.json`, `reset.d.ts`, `next.config.ts`, `vitest.config.ts`, `drizzle.config.ts`, `.gitignore`, `.dockerignore`, `.env.example`, `Dockerfile`, `railway.json`, `src/lib/types.ts`, `src/lib/constants.ts`, `src/lib/api-schemas.ts`, `src/lib/auth.ts`, `src/lib/format.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/app/icon.svg`, `src/app/api/healthz/route.ts`, stub `src/app/tv/page.tsx`, stub `src/app/admin/page.tsx`, `fixtures/sample-state.json`, `docs/CONTRACT.md`, `README.md`.

**Interfaces — Produces (all later tasks consume):**
- `src/lib/types.ts`: `TvMode`, `EventStatus`, `ScoringType`, `BloodCard`, `EventInfo`, `PlayerInfo`, `EventResultRow`, `LeaderboardRow`, `BloodMatchupPublic`, `DecreeRow`, `Broadcast` (discriminated union), `StatePayload`, `ExportShape`, `Standing`, `StandingInput`, `ScoreInput`.
- `src/lib/constants.ts`: `MASTER_POINTS`, `pointsForRank(rank: number): number`, `EVENTS_SEED` (7 events: stubby-fan/Sloth/ELIMINATION, krillion/Greed/RAW_HIGH, weekly-50/Pride/RAW_HIGH, rock-hurl/Wrath/ELIMINATION, fruit-split/Envy/FRUIT_SPLIT, grape-bobbing/Gluttony/RAW_HIGH, blood-on-the-creek/Lust/BLOOD_MATRIX), `SIN_TAGS`, `CURSE_LEVELS`, `BLOOD_MATRIX_1V1`, `BLOOD_3WAY`, `DEFAULT_LIVES = 3`, `ADMIN_COOKIE`.
- `src/lib/api-schemas.ts`: Zod schemas `LoginBody`, `PlayerActionBody`, `ScoreBody`, `PreviewBody`, `EventStatusBody`, `JokerBody`, `DecreeCreateBody`, `DecreePatchBody`, `BloodGenerateBody`, `BloodCreateBody`, `BloodPatchBody`, `TvModeBody`, `ExportShapeSchema`, `RestoreBody`.
- `src/lib/auth.ts`: `getAdminPin(): string`, `adminCookieValue(): string`, `isAdminRequest(req: Request): boolean`, `unauthorized(): Response`.

- [ ] Steps: write files above; `npm install`; `npm run build` passes on the stub app; orchestrator commits `feat: scaffold CreekOS contract + skeleton`.

### Task 2: Scoring engine (pure, TDD)

**Files:** Create: `src/lib/scoring.ts`. Test: `tests/scoring.test.ts`.

**Interfaces — Produces:**
- `ceilToHalf(x: number): number`, `round1(x: number): number`
- `computeFruitErrorPct(a: number | null, b: number | null): number | null`
- `computeEventStandings(scoringType: ScoringType, eventId: number, rows: StandingInput[]): Standing[]`
- `computeBloodDeltas(roundNumber: number, cards: BloodCard[]): number[]`
- `rankByTotal(totals: ReadonlyArray<{ playerId: number; total: number }>): Map<number, number>` (competition ranking 1,2,2,4)

- [ ] **Write failing tests first** (`npm test` → red), pinning at minimum:
  - `ceilToHalf(13.0)=13`, `ceilToHalf(16.6667)=17`, `pointsForRank(1)=20`, `pointsForRank(16)=1`, `pointsForRank(0)=0`.
  - RAW_HIGH: 2-way tie at ranks 3–4 → 13.0 each (PRD example); 3-way tie at 1 → 17.0 each; null rawScore → unranked, 0 pts.
  - ELIMINATION: alive (null order) beats all eliminated and ties among alive; orders [12,11,...] map positionally; equal orders tie-split; order gaps harmless.
  - FRUIT_SPLIT: 510/490 → 1.0 err; 251.3/248.9 → 0.240; asc ranking; missing weight → unranked.
  - Overrides: `manualRankOverride` locks exact rank, autos fill around; two players locked to rank 2 → both get `(16+14)/2=15`; `manualPointsOverride=7.5` beats joker (stays 7.5).
  - Joker: `jokerEventId===eventId` → `jokerApplied` true, final = base×2 (tie 13 → 26).
  - Blood: every 1v1 cell (+3/+3, +5/−3, −2/−2), round 3 ×2 (+10/−6), 3-way tables (0/1/2/3 blood), throws on wrong card count.
  - `rankByTotal`: 55,54,32,32,31 → ranks 1,2,3,3,5.
- [ ] Implement `src/lib/scoring.ts`; `npm test` green; `npm run typecheck` clean.

### Task 3: Database layer — schema, drivers, migration, seed, repo, recalc

**Files:** Create: `src/db/schema.ts`, `src/db/index.ts`, `src/db/seed.ts`, `src/db/repo.ts` (barrel; impl may split across `src/db/*.ts`), `drizzle/` (generated via `npx drizzle-kit generate`). Test: `tests/repo.test.ts` (in-memory PGlite: `new PGlite()`).

**Interfaces — Consumes:** Task 2 engine, Task 1 types/constants.
**Interfaces — Produces (exported from `src/db/repo.ts`):**
- `getDb(): Promise<AppDb>` — lazy singleton: picks driver, runs committed migrations, seeds events + `app_state` row; `globalThis`-cached for dev HMR; test hook `_setTestDb(client)`.
- `getStatePayload(): Promise<StatePayload>` · `getStateVersion(): Promise<number>`
- `upsertScores(eventId: number, inputs: ScoreInput[], opts?: { quiet?: boolean }): Promise<StatePayload>` — semantics per CONTRACT §Score (omitted=unchanged, null=clear, `eliminate` assigns next order once, `revive` clears it); recalcs event + totals; broadcasts EVENT_SCORE unless quiet.
- `previewScores(eventId: number, inputs: ScoreInput[]): Promise<Standing[]>` — no writes.
- `setEventStatus(eventId, status)` (LIVE demotes other LIVE events) · `setJoker(playerId, eventId: number | null, force: boolean)` → `{ ok: true } | { error: string }` (409 case)
- `createPlayer({name, epithet?})` · `updatePlayer(id, patch)` · `castDecree(playerIds: number[], pointsDelta, sinTag, reason)` · `patchDecree(id, patch)` · `listDecrees()`
- `listBloodMatchups()` (full, admin) · `generateBloodRound(roundNumber)` · `createBloodMatchup({roundNumber, playerIds})` · `patchBloodMatchup(id, patch)` (cards / `reveal` computes deltas via engine / `unreveal` / manual delta edits) · `deleteBloodMatchup(id)`
- `setTvMode(mode)` · `exportDump(): Promise<ExportShape>` · `restoreDump(dump: ExportShape)` (validates FIRST, snapshots, then swaps in one tx) · `listSnapshots()` · `createSnapshot(note?)` · `getSnapshotJson(id)` · `restoreSnapshot(id)`
- Every mutation bumps `state_version`, maintains prev/current rank maps (trend), prunes broadcasts (keep 50), auto-snapshots if >10 min stale.

- [ ] Write schema per PRD §2 (+ `lives_remaining`, `created_at` on matchups; tables `app_state`, `broadcasts`, `snapshots`); `npx drizzle-kit generate`.
- [ ] **Failing repo tests first**, minimum: boot-seed idempotence (7 events, state row, version stable across double init); empty-roster `getStatePayload()` valid; score→recalc→leaderboard math matches hand values; double-eliminate no-op (Review Focus 1); joker 409 then force; decree cast/void/edit totals; blood generate (13 actives → five 1v1 + one 3-way; regenerate preserves revealed), reveal math incl. round 3; unrevealed cards null in public payload but present in `listBloodMatchups`; trend prev/current; export→wipe→restore roundtrip identical; restore of garbage → throws, DB untouched (Review Focus 2); state fixture key-compatibility (`fixtures/sample-state.json` top-level keys + leaderboard/eventResults row keys ⊆ payload's).
- [ ] Implement; `npm test` green; `npm run typecheck` clean.

### Task 4: API route handlers + e2e sim + demo seed

**Files:** Create under `src/app/api/`: `state/route.ts`, `login/route.ts`, `logout/route.ts`, `players/route.ts`, `events/[id]/score/route.ts`, `events/[id]/preview/route.ts`, `events/[id]/status/route.ts`, `events/[id]/joker/route.ts`, `decrees/route.ts`, `decrees/[id]/route.ts`, `blood/matchups/route.ts`, `blood/matchups/[id]/route.ts`, `blood/generate/route.ts`, `tv-mode/route.ts`, `export/route.ts`, `restore/route.ts`, `snapshots/route.ts`, `snapshots/[id]/route.ts`; replace `healthz/route.ts` stub. Create: `scripts/e2e-sim.ts`, `scripts/seed-demo.ts`. Modify: `README.md` (API table).

**Interfaces — Consumes:** repo barrel (Task 3), Zod schemas + auth (Task 1). Handlers stay thin: auth → parse → repo → `NextResponse.json`; all `export const dynamic = 'force-dynamic'`.
**Produces:** HTTP surface per CONTRACT §Endpoints (incl. `/api/state` ETag `W/"v{n}"` → 304; export download headers).

- [ ] Implement handlers (401 without auth on every mutator; zod 400s; repo 409s mapped).
- [ ] `scripts/e2e-sim.ts` (tsx, `BASE_URL` + `ADMIN_PIN` envs): asserts via exit code — login; create 13 players; run E1 eliminations with a double-tap; E2 raws with the 72/72 tie + joker (expect 13/13 and 32); E3 partial; E5 weights (0.240 leader); decree cast/void; blood generate→cards→reveal (+5/−3); tv-mode; amend an E1 rank override; export; **hand-computed leaderboard equality check**; 401/400/409 negative probes; ETag 304 probe.
- [ ] `scripts/seed-demo.ts`: direct repo seed approximating the fixture (13 tributes, E1–E2 complete, E3 live, decrees, one revealed matchup).
- [ ] Verify: `npm run build` clean; boot `npm run dev` + `npm run e2e` green against it.

### Task 5: TV Broadcast Dashboard `/tv`

**Files:** Create: `src/app/tv/page.tsx` (replaces stub), `src/app/tv/TvDashboard.tsx` (+ sibling components under `src/app/tv/`), `src/app/tv/tv.module.css`.

**Interfaces — Consumes:** `StatePayload` from `GET /api/state` (shape = `fixtures/sample-state.json`; dev hint: `/tv?mock=1` fetches `/api/mock-state` — Task 4 serves the fixture file there, public). `motion` for layout animation.
**Behaviour (PRD §5, CONTRACT §TV):** 2.5 s poll w/ version skip + SIGNAL LOST badge on failures (keep last board); three zones 70/30; full column set with per-event points, blood, decrees, total; gold divider under 1st ("The Purified Sovereign"), jagged crimson divider above last ("The Vessel of Sins"); trend ▲/▼; 🃏 badge on joker cell, 🪨 curse badge during E4; spotlight per live event type (elimination: alive/lives/curse; raw: top scores; fruit: clubhouse leader err%; blood: standoff stage w/ 90 s ring from matchup `createdAt`); Scroll of Judgment feed (voided struck through); broadcast overlays — DECREE full-screen 5 s (⚡ JUDGMENT FROM THE CREEK ⚡ exact copy per PRD), EVENT_SCORE banner, BLOOD_REVEAL stage flash; `tvMode` switches zones (BLOOD_STAGE full-screen); wake lock + reacquire on visibilitychange + fullscreen hint; empty-roster idle state; fits 15 rows on 1080p 16:9 (clamp()-scaled type).

- [ ] Implement; `npm run typecheck` + `npm run build` clean; render check against `?mock=1`.

### Task 6: Commissioner Admin Portal `/admin`

**Files:** Create: `src/app/admin/page.tsx` (server auth gate, replaces stub), `src/app/admin/AdminApp.tsx` + tab components under `src/app/admin/`, `src/app/admin/admin.module.css`, `src/app/admin/LoginForm.tsx`.

**Interfaces — Consumes:** all endpoints per CONTRACT; `StatePayload`; admin-only `GET /api/blood/matchups`, `GET /api/decrees`.
**Behaviour (PRD §4, CONTRACT §Admin):** PIN gate (cookie check server-side; LoginForm POSTs `/api/login`, auto-submits `?pin=`); bottom nav, 4 tabs, 48 px targets, one-handed. Tab 1 Decree Wand: multi-select avatar grid, point stepper (−10…+10 + custom), sin chips, reason box, CAST (→ toast), full history with Edit modal + Void/Unvoid. Tab 2 Events: dropdown + status control; guided modes per type (lives taps `quiet`, ELIMINATE/REVIVE, curse ± on E4; raw inputs w/ debounced `/preview` rank badges + joker checkbox; fruit dual inputs w/ live err%; blood: generate round, card setters, REVEAL ON TV & COMMIT w/ inline confirm, post-reveal delta edit); god-mode table (raw | auto rank | override rank | joker | auto pts | override pts | notes → Save Amendments bulk upsert, explicit-clear via empty field = null). Tab 3 Roster: add/rename/epithet/active toggle, joker assign/move/revoke (handles 409 with force prompt), curse stepper. Tab 4 System: TV mode remote (3 buttons + current), export download, restore file picker w/ typed RESTORE, snapshot list + restore, health/version. Optimistic refresh: every mutation response (or follow-up `/api/state`) replaces local state; 5 s background poll; custom modals only.

- [ ] Implement; `npm run typecheck` + `npm run build` clean.

### Task 7: Integration & live verification (orchestrator)

- [ ] `npm test`, `npm run typecheck`, `npm run build` all green; fix seams.
- [ ] Boot dev server; `npm run e2e` green; seed demo; Chrome visual pass on `/tv` (1080p) and `/admin` (390 px) fixing visual defects; commit `feat: CreekOS build green end-to-end`.

### Task 8: Adversarial review (orchestrator workflow)

- [ ] Parallel reviewers: scoring math vs PRD §3; contract drift (API ↔ UIs); resilience/data-loss; auth/XSS; UI/UX + dead code. Dedupe → 3 adversarial refuters per finding (≥2 refute = kill) → fix confirmed → tests/build/e2e re-green → commit.

### Task 9: Ship

- [ ] Finalize README (run, deploy checklist mapped to PRD §7, blood matrix table, PIN); `docker build` smoke if daemon up; final commit; write project memory.
