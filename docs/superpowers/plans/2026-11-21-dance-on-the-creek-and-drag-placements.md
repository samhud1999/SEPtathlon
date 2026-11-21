# Dance on the Creek + Drag-to-Rank Placements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn event 7 into a duo dance-off scored 0–10 on the existing matchup subsystem, and add a mobile drag-to-rank "Placements" mode (with ties) for the six ranked events.

**Architecture:** Feature 1 keeps the `blood_matchups` table, `/api/blood/*` routes and the `blood`/`bloodTotal` contract fields; only the mechanic changes (a duo `score` written to every seat's delta, `isRevealed` = "scored"). Feature 2 is a pure helper module (`src/lib/placements.ts`) plus one client component driving `manualRankOverride` through the existing score endpoint; the scoring engine is untouched.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Zod v4, Drizzle, PGlite tests via Vitest, @dnd-kit (new dependency).

**Spec:** `docs/superpowers/specs/2026-11-21-dance-on-the-creek-and-drag-placements-design.md`

## Global Constraints

- No schema migration. Table `blood_matchups`, API paths `/api/blood/*`, repo function names, `StatePayload.blood`, `LeaderboardRow.bloodTotal`, and the `BLOOD_STAGE` TV-mode enum value all stay as-is.
- User-facing strings say "Dance": event name "Dance on the Creek", slug `dance-on-the-creek`, sin "Lust", leaderboard column "Dance", TV-mode label "Dance stage".
- Scoring type literal is `DANCE_OFF` (replaces `BLOOD_MATRIX` everywhere, including the Zod `SCORING_TYPES` enum).
- Duo score: any decimal in `[0, 10]`, stored at one-decimal precision (`round1`); `score: null` clears. API rejects out-of-range with 400.
- Draw/reshuffle pairs only `isActive` players; odd count → one `3WAY` trio; fewer than 2 actives → 400 "not enough tributes".
- Placements only for `ELIMINATION | RAW_HIGH | FRUIT_SPLIT`; a tie group's members all get `manualRankOverride` = the group's start rank.
- Every commit leaves `npm run typecheck` and `npm test` green.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **Restoring a pre-rename snapshot/export** (event 7 as `BLOOD_MATRIX`, matchups carrying PURE/BLOOD cards and matrix deltas) must succeed and come back as `DANCE_OFF` / "Dance on the Creek". Pinned in Task 3.
2. **Legacy rows after deploy** — old matchups from rounds 2/3 or a stale `BLOOD_REVEAL` broadcast row must not break the TV or admin; a redraw wipes every matchup regardless of round. Pinned in Task 3.
3. **Score edge input** — `11`, `-1`, `"abc"`, `7.55`: API 400s out-of-range; the UI clamps to `[0,10]`, rounds to one decimal, and refuses non-numeric with a toast. Pinned in Task 3 (API) and Task 4 (UI copy).
4. **Placements Save with stray overrides** — an inactive player who still holds a `manualRankOverride` on the event would collide with the saved slots; Save must null those rows too, and Clear must null everyone. Pinned in Task 5.
5. **Placements preview under a joker or points override** — the projected points shown before Save must equal what the engine produces after Save. Pinned in Task 5 (projection goes through `computeEventStandings`).

---

### Task 1: Rename the scoring type to `DANCE_OFF` and reseed event 7 on boot

**Files:**
- Modify: `src/lib/types.ts:9`
- Modify: `src/lib/constants.ts:29,41` (+ new `DANCE_MAX_SCORE`)
- Modify: `src/lib/scoring.ts:60,79`
- Modify: `src/db/core.ts:108`
- Modify: `src/db/repo.ts:131-132,211-212`
- Modify: `src/db/index.ts:26-41`
- Modify: `src/app/admin/EventsTab.tsx:34`
- Modify: `src/app/tv/Spotlight.tsx:13,332`
- Modify: `fixtures/sample-state.json:13`
- Test: `tests/scoring.test.ts`, `tests/repo.test.ts`

**Interfaces:**
- Produces: `ScoringType = "ELIMINATION" | "RAW_HIGH" | "FRUIT_SPLIT" | "DANCE_OFF"`; `DANCE_MAX_SCORE = 10` in `src/lib/constants.ts`; `EVENTS_SEED[6] = { id: 7, slug: "dance-on-the-creek", name: "Dance on the Creek", sin: "Lust", scoringType: "DANCE_OFF" }`; `ensureSeeded(db)` upserts `name, slug, sin, scoringType` on `events.id` conflict, leaving `status` alone.

- [ ] **Step 1: Write the failing tests**

In `tests/scoring.test.ts` rename the describe to `"computeEventStandings — FRUIT_SPLIT and DANCE_OFF"` and the test to:

```ts
it("DANCE_OFF events have no standings", () => {
  expect(computeEventStandings("DANCE_OFF", 7, [row(1), row(2)])).toEqual([]);
});
```

In `tests/repo.test.ts` add imports `import { eq } from "drizzle-orm";` and `import { events } from "@/db/schema";`, change the boot test's slug list to end with `"dance-on-the-creek"` and the type assertion to `"DANCE_OFF"`, and add inside `describe("boot + seed")`:

```ts
it("re-seeding upgrades event 7's name and type but keeps its status", async () => {
  const db = await createTestDb();
  _setDb(db);
  await db
    .update(events)
    .set({ name: "Blood on the Creek", slug: "blood-on-the-creek", scoringType: "BLOOD_MATRIX", status: "LIVE" })
    .where(eq(events.id, 7));
  await ensureSeeded(db);
  const payload = await getStatePayload();
  expect(payload.events[6]).toMatchObject({
    id: 7, slug: "dance-on-the-creek", name: "Dance on the Creek", sin: "Lust", scoringType: "DANCE_OFF", status: "LIVE",
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/repo.test.ts -t "boot" 2>&1 | tail -20`
Expected: FAIL — slug list mismatch (`blood-on-the-creek`) and the re-seed test shows `name: "Blood on the Creek"`.

- [ ] **Step 3: Implement the rename**

- `types.ts`: `ScoringType` literal `BLOOD_MATRIX` → `DANCE_OFF`.
- `constants.ts`: seed row 7 per Interfaces; `SCORING_TYPES` last entry `"DANCE_OFF"`; add `export const DANCE_MAX_SCORE = 10;` beside `DEFAULT_LIVES`.
- `scoring.ts`: `metricFor` case and the early return in `computeEventStandings` use `"DANCE_OFF"`; update the doc comment.
- `core.ts` `recalcEvent`: `event.scoringType === "DANCE_OFF"`.
- `repo.ts`: the two guards become `"DANCE_OFF"` with messages `"Dance on the Creek is scored per duo, not per tribute"` and `"Dance on the Creek has no score preview"`.
- `index.ts` `ensureSeeded`: replace `.onConflictDoNothing()` on the events insert with
  `.onConflictDoUpdate({ target: events.id, set: { name: sql\`excluded.name\`, slug: sql\`excluded.slug\`, sin: sql\`excluded.sin\`, scoringType: sql\`excluded.scoring_type\`, updatedAt: new Date() } })` (import `sql` from `drizzle-orm`).
- `EventsTab.tsx`: `const isDance = event.scoringType === "DANCE_OFF";` (rename every `isBlood` use).
- `Spotlight.tsx`: `TYPE_FLAVOR.DANCE_OFF = "Duos dance, the Creek scores /10"`; the guard on line 332 uses `"DANCE_OFF"`.
- `fixtures/sample-state.json` event 7: `"slug": "dance-on-the-creek", "name": "Dance on the Creek", "scoringType": "DANCE_OFF"`.

- [ ] **Step 4: Run typecheck and the suite**

Run: `npm run typecheck && npm test 2>&1 | tail -6`
Expected: typecheck clean; `Tests  70 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(dance): rename BLOOD_MATRIX to DANCE_OFF and reseed event 7 on boot"
```

---

### Task 2: TV dance surfaces (stage, spotlight, leaderboard column, remote label)

**Files:**
- Create: `src/lib/dance.ts`
- Create: `src/app/tv/DanceStage.tsx`; Delete: `src/app/tv/BloodStage.tsx`
- Modify: `src/app/tv/TvDashboard.tsx:10,38-40,266-267`
- Modify: `src/app/tv/Leaderboard.tsx:134-146,202-207`
- Modify: `src/app/tv/Spotlight.tsx:213-258,332`
- Modify: `src/app/admin/SystemTab.tsx:16-20,104`
- Modify: `src/app/tv/tv.module.css` (append after `.soTag`)
- Test: `tests/dance.test.ts`

**Interfaces:**
- Produces (`src/lib/dance.ts`): `duoScore(m: BloodMatchupPublic): number | null` — `m.isRevealed ? (m.players[0]?.delta ?? 0) : null`; `duoNames(m: BloodMatchupPublic): string` — `"A & B"` / `"A, B & C"`; `TV_MODE_LABEL: Readonly<Record<TvMode, string>> = { LEADERBOARD: "Leaderboard", LIVE_EVENT: "Live event", BLOOD_STAGE: "Dance stage" }`.
- Consumes: `BloodMatchupPublic` (seats still carry `card`/`cardSet` until Task 4 — do not read them).

- [ ] **Step 1: Write the failing test**

`tests/dance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { duoNames, duoScore } from "@/lib/dance";
import type { BloodMatchupPublic } from "@/lib/types";

const base = { id: 1, roundNumber: 1, matchupType: "1V1" as const, createdAt: "", updatedAt: "" };
const seat = (playerId: number, name: string, delta: number) => ({ playerId, name, delta, cardSet: false, card: null });

describe("dance helpers", () => {
  it("an unscored duo has no score and a scored one reads seat A's delta", () => {
    const unscored: BloodMatchupPublic = { ...base, isRevealed: false, players: [seat(1, "Davo", 0), seat(2, "Gazza", 0)] };
    const scored: BloodMatchupPublic = { ...base, isRevealed: true, players: [seat(1, "Davo", 7.5), seat(2, "Gazza", 7.5)] };
    expect(duoScore(unscored)).toBeNull();
    expect(duoScore(scored)).toBe(7.5);
  });
  it("joins names with & (and a comma for a trio)", () => {
    expect(duoNames({ ...base, isRevealed: false, players: [seat(1, "Davo", 0), seat(2, "Gazza", 0)] })).toBe("Davo & Gazza");
    expect(duoNames({ ...base, matchupType: "3WAY", isRevealed: false, players: [seat(1, "Davo", 0), seat(2, "Gazza", 0), seat(3, "Spud", 0)] })).toBe("Davo, Gazza & Spud");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/dance.test.ts 2>&1 | tail -8`
Expected: FAIL — cannot resolve `@/lib/dance`.

- [ ] **Step 3: Implement `src/lib/dance.ts`** per Interfaces (pure, no React).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/dance.test.ts 2>&1 | tail -6`
Expected: `2 passed`.

- [ ] **Step 5: Replace the Blood stage with `DanceStage`**

`git rm src/app/tv/BloodStage.tsx`; create `src/app/tv/DanceStage.tsx` — `export default function DanceStage({ payload }: { payload: StatePayload })`:
- `<section className={styles.stage}>`, header `styles.stageHead` with `<h2 className={styles.stageTitle}>` = `payload.events.find(e => e.id === 7)?.name ?? "Dance on the Creek"` and `styles.stageSub` → `<span className={styles.stageSin}>The Sin of {sin}</span>`.
- Duos = `payload.blood.matchups` sorted by id. Empty → `styles.stageEmpty` "No duos drawn. The Commissioner shuffles the fates…".
- Else `styles.stageGrid` of `motion.div` cards (`styles.standoff`, `layout`, fade-in): `styles.soHead` with `styles.soTag` "Duo {id}" / "Trio {id}"; a `styles.duoNames` block listing each seat name in `styles.seatName`; then `duoScore(m) === null` → `<span className={styles.duoAwaiting}>AWAITING SCORE</span>` else `<span className={styles.duoScore}>{fmtPts(score)}<span className={styles.duoScoreMax}>/ 10</span></span>`.
- No countdown ring, no cards, no `skewMs` prop.

Append to `tv.module.css` after `.soTag`:

```css
.duoNames { display: flex; flex-direction: column; align-items: center; gap: 0.4vh; }
.duoScore { composes: num; align-self: center; color: var(--gold-bright); font-weight: 900; font-size: clamp(1.6rem, 6vh, 4rem); line-height: 1; text-shadow: 0 0 22px rgba(245, 158, 11, 0.35); }
.duoScoreMax { color: var(--ash); font-size: 0.4em; margin-left: 0.25em; letter-spacing: 0.1em; }
.duoAwaiting { composes: num; align-self: center; color: var(--ash); letter-spacing: 0.22em; font-size: clamp(0.6rem, 1.6vh, 1rem); animation: softPulse 1.6s ease-in-out infinite; }
```

`TvDashboard.tsx`: import `DanceStage` instead of `BloodStage`; render `<DanceStage payload={payload} />` (keep the `BLOOD_STAGE` mode check); in `diffBoards` rename the cell key `"blood"` → `"dance"`.

- [ ] **Step 6: Leaderboard "Dance" column**

`Leaderboard.tsx`: the E7 header shows `<span className={styles.evNum}>E7</span><span className={styles.evSin}>Dance</span>`; the E7 cell calls `numCell("dance", fmtPts(row.bloodTotal), row.bloodTotal === 0 ? \` ${styles.cellDim}\` : \` ${styles.pos}\`)` — plain points, no sign. Drop the now-unused `fmtSigned` import only if nothing else in the file uses it (the decree cell still does — keep it).

- [ ] **Step 7: Spotlight dance spot + remote label**

`Spotlight.tsx`: replace `BloodPreviewSpot` with `DanceSpot({ payload })`: empty → `styles.spotEmpty` "The duos have not been drawn…"; else `styles.sectionLabel` "Duos" + `styles.countTag` count, then `styles.prevList` rows (`styles.prevMatch`) with each seat's `styles.prevName` separated by `<span className={styles.prevVs}>&</span>`, and one chip: scored → `styles.seatChip styles.seatChipLocked` `{fmtPts(score)} / 10`, else `styles.seatChip styles.seatChipAwaiting` "AWAITING". Guard: `live.scoringType === "DANCE_OFF" && <DanceSpot payload={payload} />`. Remove the `fmtSigned` import if unused.

`SystemTab.tsx`: `TV_BUTTONS` third entry `{ mode: "BLOOD_STAGE", icon: "💃", label: "DANCE STAGE" }`; heading uses `TV_MODE_LABEL[state.tvMode]` from `@/lib/dance` instead of `state.tvMode.replace("_", " ")`.

- [ ] **Step 8: Typecheck + suite**

Run: `npm run typecheck && npm test 2>&1 | tail -6 && grep -rn "BloodStage\|skewMs" src | grep -v "setSkewMs\|skewMs(" || true`
Expected: typecheck clean; `72 passed`; no `BloodStage` references remain (a leftover `skewMs` state in TvDashboard may stay only if still used — otherwise remove it).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(dance): TV dance stage, spotlight duos and Dance leaderboard column"
```

---

### Task 3: Server duo scoring — `score` PATCH, wipe-all redraw, legacy restore

**Files:**
- Modify: `src/lib/api-schemas.ts:2-9,109-132,160-167`
- Modify: `src/db/repo.ts:8-9,398-619`
- Modify: `src/db/backup.ts:9-10,56-60`
- Modify: `src/lib/scoring.ts:6-12,175-197`
- Modify: `src/lib/constants.ts:44-65`
- Modify: `src/lib/types.ts:98-117`
- Modify: `src/app/tv/Overlays.tsx`, `src/app/tv/TvDashboard.tsx:50-59`
- Modify: `fixtures/sample-state.json:118`
- Test: `tests/repo.test.ts` (replace `describe("blood on the creek")`), `tests/scoring.test.ts`, create `tests/api-schemas.test.ts`

**Interfaces:**
- Produces: `BloodPatchBody = z.object({ score: z.number().finite().min(0).max(DANCE_MAX_SCORE).nullable() })`; `patchBloodMatchup(id: number, patch: { score: number | null }): Promise<StatePayload>`; `generateBloodRound(roundNumber: number)` now deletes **every** matchup, then pairs all actives; `Broadcast` union loses `BLOOD_REVEAL`; `computeBloodDeltas`, `BLOOD_MATRIX_1V1`, `BLOOD_3WAY`, `ROUND_STAKES` are gone; export schema accepts legacy `"BLOOD_MATRIX"` and maps it to `"DANCE_OFF"`; `restoreDump` calls `ensureSeeded(tx)` after re-inserting events.
- Consumes: `DANCE_MAX_SCORE`, `duoNames` (Task 2), `round1`, `fmtPts`.

- [ ] **Step 1: Write the failing tests**

`tests/api-schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BloodPatchBody } from "@/lib/api-schemas";

describe("BloodPatchBody", () => {
  it("accepts a score in [0,10] or null", () => {
    expect(BloodPatchBody.parse({ score: 7.5 })).toEqual({ score: 7.5 });
    expect(BloodPatchBody.parse({ score: null })).toEqual({ score: null });
  });
  it("rejects out-of-range, missing, and legacy card bodies", () => {
    expect(() => BloodPatchBody.parse({ score: 11 })).toThrow();
    expect(() => BloodPatchBody.parse({ score: -1 })).toThrow();
    expect(() => BloodPatchBody.parse({})).toThrow();
    expect(() => BloodPatchBody.parse({ cardA: "PURE", reveal: true })).toThrow();
  });
});
```

`tests/scoring.test.ts`: delete the `computeBloodDeltas` describe and its imports (`computeBloodDeltas`, `BloodCard`).

`tests/repo.test.ts`: replace `describe("blood on the creek", …)` with:

```ts
describe("dance on the creek", () => {
  async function thirteen(): Promise<number[]> {
    const ids = await addPlayers(["P1","P2","P3","P4","P5","P6","P7","P8","P9","P10","P11","P12","P13"]);
    return [...ids.values()];
  }

  it("draws five duos and one trio for 13 actives", async () => {
    await thirteen();
    const payload = await generateBloodRound(1);
    const duos = payload.blood.matchups;
    expect(duos).toHaveLength(6);
    expect(duos.filter((m) => m.matchupType === "3WAY")).toHaveLength(1);
    const seated = duos.flatMap((m) => m.players.map((p) => p.playerId));
    expect(new Set(seated).size).toBe(13);
    expect(duos.every((m) => !m.isRevealed)).toBe(true);
  });

  it("needs at least two active tributes", async () => {
    await addPlayers(["Solo"]);
    await expect(generateBloodRound(1)).rejects.toMatchObject({ status: 400 });
  });

  it("redrawing wipes every duo, scored and legacy rounds included", async () => {
    const players = await thirteen();
    await generateBloodRound(1);
    const first = (await listBloodMatchups())[0];
    await patchBloodMatchup(first?.id as number, { score: 7 });
    await createBloodMatchup({ roundNumber: 3, playerIds: [players[0] as number, players[1] as number] });
    const payload = await generateBloodRound(1);
    expect(payload.blood.matchups.some((m) => m.id === first?.id)).toBe(false);
    expect(payload.blood.matchups.every((m) => m.roundNumber === 1 && !m.isRevealed)).toBe(true);
    expect(payload.leaderboard.every((r) => r.bloodTotal === 0)).toBe(true);
    const seated = payload.blood.matchups.flatMap((m) => m.players.map((p) => p.playerId));
    expect(new Set(seated).size).toBe(players.length);
  });

  it("a duo score lands on both members once, is amendable, and clears", async () => {
    const ids = await addPlayers(["A", "B"]);
    const a = ids.get("A") as number;
    const b = ids.get("B") as number;
    let payload = await createBloodMatchup({ roundNumber: 1, playerIds: [a, b] });
    const mid = payload.blood.matchups[0]?.id as number;
    expect(lb(payload, a).bloodTotal).toBe(0);

    payload = await patchBloodMatchup(mid, { score: 7.5 });
    const duo = payload.blood.matchups[0];
    expect(duo?.isRevealed).toBe(true);
    expect(duo?.players.map((p) => p.delta)).toEqual([7.5, 7.5]);
    expect(lb(payload, a)).toMatchObject({ bloodTotal: 7.5, total: 7.5 });
    expect(lb(payload, b)).toMatchObject({ bloodTotal: 7.5, total: 7.5 });
    const bc = payload.broadcasts.filter((x) => x.type === "EVENT_SCORE");
    expect(bc.at(-1)?.payload).toMatchObject({ eventId: 7, eventName: "Dance on the Creek", message: "A & B — 7.5/10" });

    payload = await patchBloodMatchup(mid, { score: 9 });
    expect(lb(payload, a).bloodTotal).toBe(9);

    const before = payload.broadcasts.length;
    payload = await patchBloodMatchup(mid, { score: null });
    expect(payload.blood.matchups[0]?.isRevealed).toBe(false);
    expect(lb(payload, a).bloodTotal).toBe(0);
    expect(lb(payload, b).total).toBe(0);
    expect(payload.broadcasts.length).toBe(before);
  });

  it("a trio score lands on all three", async () => {
    const ids = await addPlayers(["A", "B", "C"]);
    const [a, b, c] = [ids.get("A") as number, ids.get("B") as number, ids.get("C") as number];
    let payload = await createBloodMatchup({ roundNumber: 1, playerIds: [a, b, c] });
    payload = await patchBloodMatchup(payload.blood.matchups[0]?.id as number, { score: 6 });
    expect([a, b, c].map((id) => lb(payload, id).bloodTotal)).toEqual([6, 6, 6]);
  });

  it("rejects scores outside 0–10 and rounds to one decimal", async () => {
    const ids = await addPlayers(["A", "B"]);
    let payload = await createBloodMatchup({ roundNumber: 1, playerIds: [ids.get("A") as number, ids.get("B") as number] });
    const mid = payload.blood.matchups[0]?.id as number;
    await expect(patchBloodMatchup(mid, { score: 11 })).rejects.toMatchObject({ status: 400 });
    await expect(patchBloodMatchup(mid, { score: -0.5 })).rejects.toMatchObject({ status: 400 });
    payload = await patchBloodMatchup(mid, { score: 7.55 });
    expect(lb(payload, ids.get("A") as number).bloodTotal).toBe(7.6);
  });
});
```

And inside `describe("backups")` add:

```ts
it("a legacy export (BLOOD_MATRIX event 7, carded matchups) restores as the dance-off", async () => {
  const ids = await addPlayers(["A", "B"]);
  const a = ids.get("A") as number;
  const b = ids.get("B") as number;
  const dump = await exportDump();
  const legacy = JSON.parse(JSON.stringify(dump)) as Record<string, unknown>;
  const evs = legacy["events"] as Array<Record<string, unknown>>;
  evs[6] = { ...evs[6], slug: "blood-on-the-creek", name: "Blood on the Creek", scoringType: "BLOOD_MATRIX" };
  (legacy["bloodMatchups"] as unknown[]).push({
    id: 1, roundNumber: 3, matchupType: "1V1", playerAId: a, playerBId: b, playerCId: null,
    cardA: "BLOOD", cardB: "PURE", cardC: null, deltaA: 10, deltaB: -6, deltaC: 0, isRevealed: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const payload = await restoreDump(legacy);
  expect(payload.events[6]).toMatchObject({ slug: "dance-on-the-creek", name: "Dance on the Creek", scoringType: "DANCE_OFF" });
  expect(lb(payload, a).bloodTotal).toBe(10);
  expect(payload.blood.matchups[0]?.isRevealed).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/repo.test.ts tests/api-schemas.test.ts 2>&1 | tail -30`
Expected: FAIL — `BloodPatchBody.parse({score: 7.5})` throws "Empty patch"/unknown shape; `patchBloodMatchup` ignores `score` (totals stay 0); legacy restore rejects `BLOOD_MATRIX` with status 400.

- [ ] **Step 3: Implement the schema + repo changes**

- `api-schemas.ts`: `BloodPatchBody` per Interfaces (drop the card/reveal/delta fields and the `BLOOD_CARDS` import only if nothing else uses it — the export schema still does; import `DANCE_MAX_SCORE`). `eventExport.scoringType` becomes `z.enum([...SCORING_TYPES, "BLOOD_MATRIX"] as const).transform((v) => (v === "BLOOD_MATRIX" ? "DANCE_OFF" : v))`.
- `repo.ts`:
  - `generateBloodRound(roundNumber)`: keep the 1–3 guard; inside `mutate`: select actives; `if (actives.length < 2) throw badRequest("Not enough active tributes to draw duos")`; `await tx.delete(bloodMatchups)` (no where); shuffle + pair exactly as before (3 left → one `3WAY`).
  - `createBloodMatchup`: message `"A tribute cannot dance with themselves"`.
  - `patchBloodMatchup(id, patch: { score: number | null })`: 404 if missing; if `score != null` and outside `[0, DANCE_MAX_SCORE]` → `badRequest("Score must be between 0 and 10")`; `s = score == null ? null : round1(score)`; update `deltaA = deltaB = s ?? 0`, `deltaC = m.matchupType === "3WAY" ? (s ?? 0) : 0`, `isRevealed = s != null`, `updatedAt`. When `s != null`: build the public shape via `toMatchupShape` + `requirePlayers` names and `addBroadcast(tx, "EVENT_SCORE", { eventId: 7, eventName, message: \`${duoNames(shape)} — ${fmtPts(s)}/10\` })` where `eventName` = name of `events.id === 7` (fallback `"Dance on the Creek"`). No broadcast on clear.
  - Remove `computeBloodDeltas`, `BloodCard`, `fmtSigned` imports if now unused; keep `listBloodMatchups`/`deleteBloodMatchup` as they are.
- `scoring.ts`: delete `computeBloodDeltas` and the three constant imports. `constants.ts`: delete `BLOOD_MATRIX_1V1`, `BLOOD_3WAY`, `ROUND_STAKES` (keep `BLOOD_CARDS`/`BloodCard` for the export schema, comment them `/** Vestigial — only the export/restore schema still reads card columns. */`).
- `types.ts`: remove the `BLOOD_REVEAL` member from `Broadcast`. `Overlays.tsx`: delete `RevealOverlay` and its branch. `TvDashboard.tsx` `overlayHoldMs`: drop the `BLOOD_REVEAL` case.
- `backup.ts`: import `ensureSeeded` from `./index`; after the events insert block call `await ensureSeeded(tx);`.
- `fixtures/sample-state.json` broadcast id 21 → `{ "id": 21, "type": "EVENT_SCORE", "createdAt": "2026-11-14T06:14:30.000Z", "payload": { "eventId": 7, "eventName": "Dance on the Creek", "message": "Davo & Gazza — 5/10" } }` (the matchup seats are reshaped in Task 4).

- [ ] **Step 4: Typecheck + suite**

Run: `npm run typecheck && npm test 2>&1 | tail -6`
Expected: typecheck clean; all tests pass (69 − 4 blood − 4 computeBloodDeltas + 1 reseed + 2 dance + 6 dance-repo + 1 legacy + 2 schema = 72 passed).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(dance): duo score PATCH, wipe-all redraw, legacy export restore"
```

---

### Task 4: Admin "Dance" guided mode + public seat shape cleanup

**Files:**
- Create: `src/app/admin/GuidedDance.tsx`; Delete: `src/app/admin/GuidedBlood.tsx`
- Modify: `src/app/admin/EventsTab.tsx:14,79-80`
- Modify: `src/lib/types.ts:66-85`, `src/db/state.ts:40-70,170`, `src/db/repo.ts:401-412`
- Modify: `src/app/admin/shared.tsx:69-72`
- Modify: `src/app/admin/admin.module.css:878-925` (prune card classes, add score input classes)
- Modify: `fixtures/sample-state.json:30-44,91-109`
- Modify: `scripts/seed-demo.ts:143-155`, `scripts/screenshots.cjs:59-60,112-113`
- Modify: `tests/dance.test.ts` (seat shape), `tests/repo.test.ts` (fixture-shape test)

**Interfaces:**
- Produces: `BloodSeat = { playerId: number; name: string; delta: number }` (no `card`/`cardSet`); `toMatchupShape(m: MatchupRow, nameOf: (id: number) => string): BloodMatchupPublic`; `GuidedDance()` default export reading `state.blood.matchups`.
- Consumes: `BloodPatchBody {score}` and `/api/blood/generate {roundNumber: 1}` (Task 3); `duoScore`, `duoNames` (Task 2).

- [ ] **Step 1: Write the failing test**

In `tests/repo.test.ts` "payload shape matches the normative fixture", after the existing key checks add:

```ts
const danced = await createBloodMatchup({ roundNumber: 1, playerIds: [ids.get("Davo") as number, ids.get("Chooka") as number] });
const payloadSeat = danced.blood.matchups[0]?.players[0];
const fixtureSeat = fixture.blood.matchups[0]?.players[0];
expect(Object.keys(payloadSeat ?? {}).sort()).toEqual(["delta", "name", "playerId"]);
expect(Object.keys(fixtureSeat ?? {}).sort()).toEqual(["delta", "name", "playerId"]);
```

(`addPlayers(["Davo", "Chooka"])` at the top of that test.) In `tests/dance.test.ts` drop `cardSet`/`card` from the `seat` helper.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/repo.test.ts -t "fixture" 2>&1 | tail -12`
Expected: FAIL — keys include `card`, `cardSet`.

- [ ] **Step 3: Reshape the public seat**

- `types.ts`: `BloodSeat` per Interfaces; `BloodMatchupPublic.isRevealed` comment → `/** true once the duo has a score (its deltas count toward the Dance total) */`; `createdAt` comment → plain timestamp.
- `state.ts`: `toMatchupShape(m, nameOf)` emits `{ playerId, name, delta }` per seat; drop the `BloodCard` import; update the call on line 170.
- `repo.ts` `listBloodMatchups`: call `toMatchupShape(m, nameOf)`; comment "Admin list — identical to the public shape now that nothing is hidden."
- `shared.tsx` `MatchupsRes` comment: "Same shape as `StatePayload.blood.matchups`."
- `fixtures/sample-state.json`: matchup 1 = Davo & Gazza scored 5 (`isRevealed: true`, seats `{ "playerId": 1, "name": "Davo", "delta": 5 }`, `{ "playerId": 10, "name": "Gazza", "delta": 5 }`); matchup 2 = Spud & Wazza unscored (deltas 0). Leaderboard: Gazza `bloodTotal: 5, total: 38`; re-sort rows by total and set ranks/trends consistently (Chooka 55 r1, Davo 54 r2, Nugget 41 r3, Gazza 38 r4 trend 3, Bluey 32 r5 trend −1, Spud 32 r5 trend −2, Johnno 31 r7 trend 0, Wazza 29 r8, Deano 25 r9, Smithy 23 r10, Macca 22 r11, Robbo 13 r12, Tommo 8 r13).

- [ ] **Step 4: Build `GuidedDance.tsx` and wire it**

`export default function GuidedDance()` using `useAdmin()`:
- `const duos = [...state.blood.matchups].sort((a, b) => a.id - b.id);`
- Button `styles.btn styles.btnGold styles.btnBig` "💃 DRAW DUOS": if `duos.length > 0` open a `Sheet` titled "Draw fresh duos?" with copy **"Reshuffle wipes the current duos and their scores. Draw fresh pairs?"** and buttons "KEEP THEM" / "WIPE & REDRAW" (`styles.btnCrimson`); otherwise draw at once. Draw = `mutate("/api/blood/generate", { roundNumber: 1 })`; ok → `toast("ok", "Duos drawn — take the floor")`. (A 400 toasts automatically.)
- `duos.length === 0` → `styles.muted` "No duos yet. Draw them when the dance floor is ready."; else one `<DuoCard key={m.id} m={m} />` each.
- Manual builder as in the old component (chips of active players, max 3) titled "Manual duo — pick 2–3 tributes", button "FORGE DUO ({n}/3)", posting `{ roundNumber: 1, playerIds }`, toast "Duo forged".

`DuoCard({ m })`:
- Header row: `styles.matchTag` `#${m.id} · ${m.matchupType === "3WAY" ? "TRIO" : "DUO"}`; status `styles.matchTag` (+ `styles.matchTagLive` when scored) `score === null ? "AWAITING" : \`SCORED ${fmtPts(score)}/10\``; overflow menu (`styles.menuWrap/menuPop/menuScrim`) with "CLEAR SCORE" (`styles.btnSmall`, only when scored → PATCH `{ score: null }`, toast "Score cleared — duo drops from the Dance total") and the existing DELETE `ArmButton`.
- Names: `m.players.map(p => <div className={styles.seatRow}><span className={styles.cardName}>{p.name}</span></div>)`.
- Score row (`styles.row`): `<input className={\`${styles.input} ${styles.numInput} ${styles.scoreInput} ${dirty ? styles.dirty : ""}\`} inputMode="decimal" enterKeyHint="done" placeholder="0–10" aria-label={\`Score out of 10 for duo ${m.id}\`} value={draft ?? (score === null ? "" : String(score))} …>`, `<span className={styles.scoreOf}>/ 10</span>`, button `styles.btn styles.btnGold` "SAVE" disabled when `draft === undefined`. Save: `parseNum(draft)`; `undefined` or `null` → `toast("error", "Enter a score from 0 to 10")`; else `s = round1(Math.min(DANCE_MAX_SCORE, Math.max(0, n)))`; `mutate(\`/api/blood/matchups/${m.id}\`, { score: s }, { method: "PATCH" })`; ok → clear draft, `toast("ok", \`${duoNames(m)} scored ${fmtPts(s)}/10\`)`. Enter blurs → saves.

`admin.module.css`: delete `.stakesBadge`, `.cardBtn`, `.cardPureOn`, `.cardBloodOn`, `.cardFace` (grep first — nothing else may use them); add

```css
.scoreInput { width: 96px; font-size: 22px; text-align: center; }
.scoreOf { color: var(--ash); font-weight: 800; letter-spacing: 0.1em; font-size: 13px; }
```

`EventsTab.tsx`: import `GuidedDance`; render `isDance ? <GuidedDance /> : …`.
`git rm src/app/admin/GuidedBlood.tsx`.

- [ ] **Step 5: Scripts**

`scripts/seed-demo.ts` dance block: forge `[Davo, Gazza]` (roundNumber 1), PATCH `{ score: 5 }`; forge `[Spud, Wazza]` unscored; log "Dance: Davo & Gazza scored 5/10; Spud & Wazza await the judges". `scripts/screenshots.cjs`: `tv-blood-stage.png` → `tv-dance-stage.png`; `admin-events-blood.png` → `admin-events-dance.png`.

- [ ] **Step 6: Typecheck + suite + dead-reference sweep**

Run: `npm run typecheck && npm test 2>&1 | tail -6 && grep -rn "cardSet\|GuidedBlood\|stakesBadge\|cardPureOn\|cardBloodOn\|cardFace\|cardBtn" src scripts tests fixtures || echo "clean"`
Expected: typecheck clean; `72 passed`; `clean`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(dance): Dance guided mode on the phone; public duo shape drops cards"
```

---

### Task 5: Placements pure helpers

**Files:**
- Create: `src/lib/placements.ts`
- Test: `tests/placements.test.ts`

**Interfaces:**
- Produces (all pure, in `src/lib/placements.ts`):
  - `interface PlacementEntry { playerId: number; tiedWithAbove: boolean }`
  - `seedEntries(players: ReadonlyArray<{ id: number }>, rows: ReadonlyArray<EventResultRow>): PlacementEntry[]` — order by `calculatedRank` ascending (null last, then given `players` order); consecutive entries whose rows share the same non-null `manualRankOverride` are tied.
  - `toSlots(entries: ReadonlyArray<PlacementEntry>): number[][]` — entry 0 always starts a slot.
  - `entryRanks(entries): Map<number, number>` — playerId → start rank of its slot (1 + members in earlier slots).
  - `moveEntry(entries, from: number, to: number): PlacementEntry[]` — array move; the moved entry gets `tiedWithAbove: false`.
  - `toggleTie(entries, playerId: number): PlacementEntry[]` — flips `tiedWithAbove`; index 0 is left untouched.
  - `placementInputs(entries, alsoClear: ReadonlyArray<number> = []): ScoreInput[]` — `{ playerId, manualRankOverride: rank }` per entry, then `{ playerId, manualRankOverride: null }` per `alsoClear` id.
  - `clearInputs(playerIds: ReadonlyArray<number>): ScoreInput[]` — all null.
  - `projectPlacements(scoringType: ScoringType, eventId: number, entries, jokerByPlayer: ReadonlyMap<number, number | null>, pointsOverrides: ReadonlyMap<number, number | null>): Map<number, Standing>` — builds `StandingInput`s with `manualRankOverride` from `entryRanks`, runs `computeEventStandings`.
- Consumes: `computeEventStandings` (unchanged), `EventResultRow`, `ScoreInput`, `Standing`.

- [ ] **Step 1: Write the failing tests**

`tests/placements.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  clearInputs, entryRanks, moveEntry, placementInputs, projectPlacements, seedEntries, toSlots, toggleTie,
  type PlacementEntry,
} from "@/lib/placements";
import type { EventResultRow } from "@/lib/types";

const e = (playerId: number, tiedWithAbove = false): PlacementEntry => ({ playerId, tiedWithAbove });
const row = (playerId: number, p: Partial<EventResultRow> = {}): EventResultRow => ({
  playerId, rawScore: null, eliminationOrder: null, livesRemaining: null, weightAGrams: null, weightBGrams: null,
  calculatedErrorPct: null, calculatedRank: null, manualRankOverride: null, basePoints: 0, jokerApplied: false,
  manualPointsOverride: null, finalEventPoints: 0, notes: null, ...p,
});
// A, B tied → slot 1 ; C, D tied → slot 3 ; E → slot 5
const field = [e(1), e(2, true), e(3), e(4, true), e(5)];

describe("placements — slots and ranks", () => {
  it("a tie group shares its start rank and the next slot skips the covered ranks", () => {
    expect(toSlots(field)).toEqual([[1, 2], [3, 4], [5]]);
    expect([...entryRanks(field)]).toEqual([[1, 1], [2, 1], [3, 3], [4, 3], [5, 5]]);
  });
  it("entry 0 never ties, even if flagged", () => {
    expect(toSlots([e(9, true), e(8)])).toEqual([[9], [8]]);
    expect(toggleTie([e(9), e(8)], 9)).toEqual([e(9), e(8)]);
    expect(toggleTie([e(9), e(8)], 8)).toEqual([e(9), e(8, true)]);
  });
  it("moving an entry untie it and keeps everyone else", () => {
    expect(moveEntry([e(1), e(2, true), e(3)], 2, 0)).toEqual([e(3), e(1), e(2, true)]);
    expect(moveEntry([e(1), e(2, true), e(3)], 1, 2)).toEqual([e(1), e(3), e(2)]);
    const same = [e(1), e(2)];
    expect(moveEntry(same, 1, 1)).toEqual(same);
  });
});

describe("placements — seeding from rows", () => {
  it("orders by calculatedRank, unranked last in roster order, and restores saved ties", () => {
    const players = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const rows = [row(1, { calculatedRank: 2, manualRankOverride: 1 }), row(2, { calculatedRank: 1, manualRankOverride: 1 }), row(4, { calculatedRank: 3 })];
    expect(seedEntries(players, rows)).toEqual([e(2), e(1, true), e(4), e(3)]);
  });
  it("ignores rows for players not listed and players with no row sit at the end", () => {
    expect(seedEntries([{ id: 7 }, { id: 8 }], [row(99, { calculatedRank: 1 })])).toEqual([e(7), e(8)]);
  });
});

describe("placements — save bodies and projection", () => {
  it("Save sets each tribute's override to its slot rank and nulls stray ids", () => {
    expect(placementInputs([e(1), e(2, true), e(3)], [42])).toEqual([
      { playerId: 1, manualRankOverride: 1 }, { playerId: 2, manualRankOverride: 1 },
      { playerId: 3, manualRankOverride: 3 }, { playerId: 42, manualRankOverride: null },
    ]);
    expect(clearInputs([1, 2])).toEqual([{ playerId: 1, manualRankOverride: null }, { playerId: 2, manualRankOverride: null }]);
  });
  it("a 2-way tie for 1st pays 18 each, a 2-way tie for 3rd pays 13 each (spec)", () => {
    const s = projectPlacements("RAW_HIGH", 2, field, new Map(), new Map());
    expect([1, 2, 3, 4, 5].map((id) => s.get(id)?.finalEventPoints)).toEqual([18, 18, 13, 13, 11]);
    expect([1, 2, 3, 4, 5].map((id) => s.get(id)?.calculatedRank)).toEqual([1, 2, 3, 4, 5]);
  });
  it("projection honours the joker and a points override exactly as the engine will", () => {
    const s = projectPlacements("ELIMINATION", 1, field, new Map([[1, 1]]), new Map([[5, 2.5]]));
    expect(s.get(1)?.finalEventPoints).toBe(36);
    expect(s.get(2)?.finalEventPoints).toBe(18);
    expect(s.get(5)?.finalEventPoints).toBe(2.5);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/placements.test.ts 2>&1 | tail -8`
Expected: FAIL — cannot resolve `@/lib/placements`.

- [ ] **Step 3: Implement `src/lib/placements.ts`** per Interfaces. `seedEntries` sorts a copy of `players` by `(row?.calculatedRank ?? Infinity, original index)`, then marks entry *i* tied when `rows[i].manualRankOverride != null && rows[i].manualRankOverride === rows[i-1].manualRankOverride`. `projectPlacements` builds `StandingInput { playerId, rawScore: null, eliminationOrder: null, weightAGrams: null, weightBGrams: null, manualRankOverride: rank, manualPointsOverride: pointsOverrides.get(id) ?? null, jokerEventId: jokerByPlayer.get(id) ?? null }`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/placements.test.ts 2>&1 | tail -6`
Expected: `8 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(placements): pure slot/tie/rank helpers with engine-backed projection"
```

---

### Task 6: Placements UI (drag-to-rank with ties) on the six ranked events

**Files:**
- Modify: `package.json` (add `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`, `@dnd-kit/utilities@^3.2.2`)
- Create: `src/app/admin/Placements.tsx`
- Modify: `src/app/admin/EventsTab.tsx:17,67-89`
- Modify: `src/app/admin/admin.module.css` (append placements block)

**Interfaces:**
- Consumes: everything in `src/lib/placements.ts` (Task 5); `useAdmin`, `ArmButton`, `rankLabel`, `fmtPts`.
- Produces: `Placements({ event }: { event: EventInfo })` default export; `EventsTab` mode union `"guided" | "placements" | "god"`.

- [ ] **Step 1: Install dnd-kit**

Run: `npm install @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2 --no-audit --no-fund 2>&1 | tail -3`
Expected: `added N packages`; `package.json` lists the three.

- [ ] **Step 2: Build `Placements.tsx`**

`"use client"` component:
- `players = state.players.filter(p => p.isActive)`, `rows = state.eventResults[String(event.id)] ?? []`.
- `const [entries, setEntries] = useState(() => seedEntries(players, rows)); const [dirty, setDirty] = useState(false);` (EventsTab mounts it with `key={event.id}`).
- `standings = projectPlacements(event.scoringType, event.id, entries, jokerMap, pointsOverrideMap)` where `jokerMap` = players' `jokerEventId`, `pointsOverrideMap` = rows' `manualPointsOverride`. `ranks = entryRanks(entries)`, `slots = toSlots(entries)`, `tiedRanks` = ranks of slots with size > 1.
- `DndContext` with `sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))`, `collisionDetection={closestCenter}`, `modifiers={[restrictToVerticalAxis]}` only if `@dnd-kit/modifiers` is installed — it is not; skip modifiers. `onDragEnd({ active, over })` → indices by playerId → `setEntries(moveEntry(...)); setDirty(true)`.
- `SortableContext items={entries.map(e => e.playerId)} strategy={verticalListSortingStrategy}`; one `<PlacementRow>` per entry using `useSortable({ id: playerId })` with `transform`/`transition` via `CSS.Transform.toString(transform)` from `@dnd-kit/utilities`. Row (`styles.placeRow`, `styles.placeRowDragging` while `isDragging`): `styles.placeRank` badge `rankLabel(rank, tied)`; `styles.cardName` name (+ `🃏` when `jokerEventId === event.id`); `styles.placePts` `{fmtPts(pts)} pts`; tie chip (`styles.chip`, `styles.chipOn` when tied, `aria-pressed`, label "TIE ↑", hidden for index 0) → `toggleTie`; `▲`/`▼` `styles.btn styles.btnSquare` fallback buttons → `moveEntry(i, i∓1)`; drag handle `<button className={\`${styles.btn} ${styles.btnSquare} ${styles.dragHandle}\`} ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={\`Drag ${name}\`}>☰</button>`.
- Footer (`styles.saveBar`): "SAVE PLACEMENTS" (`styles.btn styles.btnGold`, disabled when `!dirty || saving`) → `mutate(\`/api/events/${event.id}/score\`, { results: placementInputs(entries, strayIds) })` where `strayIds` = row-holders with `manualRankOverride != null` not in `entries`; ok → `setDirty(false)`, `toast("ok", "Placements locked in")`. `ArmButton` "CLEAR PLACEMENTS" / armed "TAP AGAIN — BACK TO AUTO" (`styles.btnOutlineCrimson`) → `mutate(…, { results: clearInputs([...entries ids, ...strayIds]), quiet: true })`; ok → `setEntries(seedEntries(players, rowsWithoutOverrides))`… simpler: ok → `setDirty(false)` and let the next state poll re-seed by passing `key={state.version}`? No — keep local order; just `toast("ok", "Placements cleared — automatic ranking restored")`.
- `styles.fine` copy: "Drag the handle (or tap ▲▼) into finishing order. TIE ↑ shares the slot above; tied tributes split the covered ranks' points. Points preview what SAVE will award."
- Empty roster → `styles.muted` "No active tributes."

Append to `admin.module.css`:

```css
/* ---------- placements ---------- */
.placeList { display: flex; flex-direction: column; gap: 8px; }
.placeRow { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--bg-raised); touch-action: pan-y; }
.placeRowDragging { border-color: var(--gold); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); z-index: 5; position: relative; }
.placeRank { min-width: 54px; font-family: var(--font-numeric); font-variant-numeric: tabular-nums; font-weight: 800; font-size: 15px; color: var(--gold-bright); }
.placePts { margin-left: auto; font-family: var(--font-numeric); font-variant-numeric: tabular-nums; font-size: 13px; color: var(--bone); white-space: nowrap; }
.dragHandle { touch-action: none; cursor: grab; font-size: 18px; }
.dragHandle:active { cursor: grabbing; }
```

(Check `var(--bg-raised)`, `--font-numeric`, `--gold-bright`, `--line`, `--bone` exist in `admin.module.css`/`globals.css` — `.menuPop` already uses `--bg-raised` and `.deltaVal` uses `--font-numeric`.)

- [ ] **Step 3: Wire the third mode into `EventsTab.tsx`**

`type Mode = "guided" | "placements" | "god"`; Seg options `Guided` / `Placements` / `God-mode`; render `mode === "placements" ? <Placements key={event.id} event={event} /> : …`. The Seg stays hidden for the dance-off (`!isDance`).

- [ ] **Step 4: Typecheck, suite, production build**

Run: `npm run typecheck && npm test 2>&1 | tail -6 && npm run build 2>&1 | tail -15`
Expected: typecheck clean; `80 passed`; build ends with the route table and no "Failed to compile".

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(placements): drag-to-rank mode with ties for the six ranked events"
```

---

### Task 7: End-to-end sim, docs, and a live run

**Files:**
- Modify: `scripts/e2e-sim.ts:182-183,256-304,315-331,346-359`
- Modify: `README.md:50,57-71,88-95,107-109`
- Modify: `docs/CONTRACT.md:9-10,66-71,105-108,117-121,142`

**Interfaces:**
- Consumes: the `/api/blood/*` behaviour from Task 3 and the score endpoint for placements.

- [ ] **Step 1: Rewrite the e2e blood section as the dance section**

Replace lines 256–304 with (labels are the assertions' text):
- `POST /api/blood/generate {roundNumber: 1}` → if `soloField`: 6 matchups, exactly one `3WAY`, 13 distinct seats, none `isRevealed`.
- `PATCH /api/blood/matchups/{first}` `{ score: 11 }` → 400 "score above 10 → 400".
- Delete every generated matchup (GET admin list, DELETE each) so totals stay hand-computable.
- Forge `[pid(4), pid(5)]` (round 1); PATCH `{ score: 7.5 }` → public state shows `players.every(p => p.delta === 7.5)` and `isRevealed` ("duo score visible in the public state"); `bloodTotal` 7.5 for both; last `EVENT_SCORE` broadcast has `eventId 7` and a message ending `"7.5/10"`.
- Forge trio `[pid(4), pid(5), pid(6)]`; PATCH `{ score: 6 }` → Sim04 13.5, Sim05 13.5, Sim06 6 ("trio score lands on all three").
- PATCH trio `{ score: 4 }` → Sim04 11.5, Sim05 11.5, Sim06 4 ("amended score replaces, never stacks").
- PATCH duo `{ score: null }` → Sim04 4, Sim05 4 ("cleared duo drops from the Dance total").
- Line 183 label → "joker rejected on the dance event".
- In the god-mode block add after the first override clear: `POST /api/events/6/score {results: [{pid(13), manualRankOverride: 1}, {pid(11), manualRankOverride: 1}]}` → both `eventPoints["6"] === 18` ("placements tie for 1st splits to 18 each"); then clear both to null → both 0.
- Final hand-computed totals (dance now adds +4 to Sim04/05/06 instead of the old +15/−9): `[2,52],[1,43],[10,38],[12,36],[8,32],[13,29.5],[4,23],[5,22],[6,22],[11,19],[7,18],[9,18],[3,15]`; rank assertions when `soloField`: Sim02 rank 1; Sim05 & Sim06 share rank 8; Sim07 & Sim09 share rank 11; Sim03 rank 13.

- [ ] **Step 2: Docs**

`README.md`: events table row 7 → `| 7 | Dance on the Creek | Lust | Duos dance, scored 0–10; both members bank the score |`; replace the payoff-matrix section with a short "Dance on the Creek" paragraph (draw duos → one score per duo → amendable, clearable); quick-reference "standoffs" → "duo draws and dance scores"; API rows: matchups → "Duos: forge, score 0–10 (`{score}` / `{score:null}` clears), delete", generate → "Random duos for every active tribute (odd count makes one trio); wipes existing duos", tv-mode label unchanged but note "BLOOD_STAGE = Dance stage".
`docs/CONTRACT.md`: `ScoringType` literal → `DANCE_OFF`; `BloodSeat` → `{playerId, name, delta}`; blood endpoint rows describe `BloodPatchBody {score: number|null (0–10)}` and the wipe-all generate; drop the `BLOOD_REVEAL` row and add a note that a duo score emits `EVENT_SCORE {eventId: 7, …, message: "A & B — 7.5/10"}`; field note "`blood.matchups[].players[].delta` is the duo's score once `isRevealed`"; line 142 fixture note → "one scored duo (5/10 each)".

- [ ] **Step 3: Run the sim against a fresh local server**

```bash
rm -rf data && (PORT=8765 npm run dev > /tmp/creekos-dev.log 2>&1 &) && sleep 1
until curl -sf http://localhost:8765/api/healthz > /dev/null; do sleep 1; done
BASE_URL=http://localhost:8765 ADMIN_PIN=2026 npm run e2e 2>&1 | tail -25
pkill -f "next dev -p 8765"; rm -rf data
```

(Check `.env.example` for the PIN variable name first; set it when starting the server if the default differs.)
Expected: `… checks, 0 failures` and `E2E SIM GREEN — the Creek is satisfied.`

- [ ] **Step 4: Typecheck + suite one last time**

Run: `npm run typecheck && npm test 2>&1 | tail -6`
Expected: clean; `80 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(e2e): dance duo flow + placements tie; docs for DANCE_OFF and the score PATCH"
```
