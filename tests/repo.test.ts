import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  RepoError,
  _setDb,
  castDecree,
  createBloodMatchup,
  createPlayer,
  createSnapshot,
  createTestDb,
  ensureSeeded,
  exportDump,
  generateBloodRound,
  getSnapshotJson,
  getStatePayload,
  getStateVersion,
  listBloodMatchups,
  listDecrees,
  listSnapshots,
  patchBloodMatchup,
  patchDecree,
  previewScores,
  restoreDump,
  setEventStatus,
  setJoker,
  setTvMode,
  updatePlayer,
  upsertScores,
} from "@/db/repo";
import { events } from "@/db/schema";
import type { StatePayload } from "@/lib/types";

beforeEach(async () => {
  const db = await createTestDb();
  _setDb(db);
});

async function addPlayers(names: string[]): Promise<Map<string, number>> {
  let payload: StatePayload | null = null;
  for (const name of names) payload = await createPlayer({ name });
  const map = new Map<string, number>();
  for (const p of (payload as StatePayload).players) map.set(p.name, p.id);
  return map;
}

function lb(payload: StatePayload, playerId: number) {
  const row = payload.leaderboard.find((r) => r.playerId === playerId);
  if (!row) throw new Error(`player ${playerId} not on leaderboard`);
  return row;
}

describe("boot + seed", () => {
  it("seeds the 7 events and an empty, valid payload", async () => {
    const payload = await getStatePayload();
    expect(payload.events).toHaveLength(7);
    expect(payload.events.map((e) => e.slug)).toEqual([
      "stubby-fan", "krillion", "weekly-50", "rock-hurl", "fruit-split", "grape-bobbing", "dance-on-the-creek",
    ]);
    expect(payload.events[6]?.scoringType).toBe("DANCE_OFF");
    expect(payload.players).toEqual([]);
    expect(payload.leaderboard).toEqual([]);
    expect(Object.keys(payload.eventResults).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(payload.liveEventId).toBeNull();
    expect(payload.tvMode).toBe("LEADERBOARD");
    expect(payload.version).toBe(0);
  });

  it("re-seeding an existing database is a no-op", async () => {
    const db = await createTestDb();
    _setDb(db);
    await ensureSeeded(db);
    await ensureSeeded(db);
    const payload = await getStatePayload();
    expect(payload.events).toHaveLength(7);
  });

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

  it("payload shape matches the normative fixture", async () => {
    const fixture = JSON.parse(
      readFileSync(join(process.cwd(), "fixtures", "sample-state.json"), "utf8"),
    ) as StatePayload;
    const ids = await addPlayers(["Davo", "Chooka"]);
    const payload = await upsertScores(2, [{ playerId: ids.get("Davo") as number, rawScore: 95 }]);

    expect(Object.keys(payload).sort()).toEqual(Object.keys(fixture).sort());
    const fixtureRow = fixture.leaderboard[0];
    const payloadRow = payload.leaderboard[0];
    expect(Object.keys(payloadRow ?? {}).sort()).toEqual(Object.keys(fixtureRow ?? {}).sort());
    const fixtureResult = fixture.eventResults["2"]?.[0];
    const payloadResult = payload.eventResults["2"]?.[0];
    expect(Object.keys(payloadResult ?? {}).sort()).toEqual(Object.keys(fixtureResult ?? {}).sort());
    expect(Object.keys(payload.events[0] ?? {}).sort()).toEqual(Object.keys(fixture.events[0] ?? {}).sort());
    expect(Object.keys(payload.players[0] ?? {}).sort()).toEqual(Object.keys(fixture.players[0] ?? {}).sort());

    const danced = await createBloodMatchup({
      roundNumber: 1,
      playerIds: [ids.get("Davo") as number, ids.get("Chooka") as number],
    });
    const payloadSeat = danced.blood.matchups[0]?.players[0];
    const fixtureSeat = fixture.blood.matchups[0]?.players[0];
    expect(Object.keys(payloadSeat ?? {}).sort()).toEqual(["delta", "name", "playerId"]);
    expect(Object.keys(fixtureSeat ?? {}).sort()).toEqual(["delta", "name", "playerId"]);
  });
});

describe("players", () => {
  it("creates players with the default epithet and bumps the version", async () => {
    const v0 = await getStateVersion();
    const payload = await createPlayer({ name: "Davo" });
    expect(payload.players[0]).toMatchObject({
      name: "Davo",
      epithet: "Tribute of the Creek",
      isActive: true,
      jokerEventId: null,
      rockCurseLevel: 0,
    });
    expect(payload.version).toBeGreaterThan(v0);
    expect(lb(payload, payload.players[0]?.id as number).total).toBe(0);
  });

  it("deactivated players leave the leaderboard but keep their data", async () => {
    const ids = await addPlayers(["Davo", "Chooka"]);
    const davo = ids.get("Davo") as number;
    await upsertScores(2, [{ playerId: davo, rawScore: 50 }]);
    const payload = await updatePlayer(davo, { isActive: false });
    expect(payload.leaderboard.some((r) => r.playerId === davo)).toBe(false);
    expect(payload.players.find((p) => p.id === davo)?.isActive).toBe(false);
    expect(payload.eventResults["2"]?.some((r) => r.playerId === davo)).toBe(true);
  });

  it("updates curse level within bounds", async () => {
    const ids = await addPlayers(["Davo"]);
    const payload = await updatePlayer(ids.get("Davo") as number, { rockCurseLevel: 3 });
    expect(payload.players[0]?.rockCurseLevel).toBe(3);
  });
});

describe("scores + recalc", () => {
  it("scores a RAW_HIGH event end to end", async () => {
    const ids = await addPlayers(["A", "B", "C"]);
    const payload = await upsertScores(2, [
      { playerId: ids.get("A") as number, rawScore: 95 },
      { playerId: ids.get("B") as number, rawScore: 88 },
      { playerId: ids.get("C") as number, rawScore: 72 },
    ]);
    expect(lb(payload, ids.get("A") as number)).toMatchObject({ rank: 1, total: 20 });
    expect(lb(payload, ids.get("B") as number)).toMatchObject({ rank: 2, total: 16 });
    expect(lb(payload, ids.get("C") as number)).toMatchObject({ rank: 3, total: 14 });
    expect(lb(payload, ids.get("A") as number).eventPoints["2"]).toBe(20);
    const row = payload.eventResults["2"]?.find((r) => r.playerId === ids.get("A"));
    expect(row).toMatchObject({ rawScore: 95, calculatedRank: 1, basePoints: 20, finalEventPoints: 20 });
  });

  it("broadcasts EVENT_SCORE unless quiet", async () => {
    const ids = await addPlayers(["A"]);
    let payload = await upsertScores(2, [{ playerId: ids.get("A") as number, rawScore: 10 }], { quiet: true });
    expect(payload.broadcasts.filter((b) => b.type === "EVENT_SCORE")).toHaveLength(0);
    payload = await upsertScores(2, [{ playerId: ids.get("A") as number, rawScore: 20 }]);
    const bc = payload.broadcasts.filter((b) => b.type === "EVENT_SCORE");
    expect(bc).toHaveLength(1);
    expect(bc[0]?.payload).toMatchObject({ eventId: 2, eventName: "Krillion" });
  });

  it("undefined leaves a field unchanged; null clears it", async () => {
    const ids = await addPlayers(["A"]);
    const a = ids.get("A") as number;
    await upsertScores(2, [{ playerId: a, rawScore: 50, notes: "first" }]);
    let payload = await upsertScores(2, [{ playerId: a, manualRankOverride: 1 }]);
    let row = payload.eventResults["2"]?.find((r) => r.playerId === a);
    expect(row).toMatchObject({ rawScore: 50, notes: "first", manualRankOverride: 1 });
    payload = await upsertScores(2, [{ playerId: a, manualRankOverride: null, rawScore: null }]);
    row = payload.eventResults["2"]?.find((r) => r.playerId === a);
    expect(row).toMatchObject({ rawScore: null, manualRankOverride: null, notes: "first" });
  });

  it("eliminate assigns sequential orders and double-taps are no-ops", async () => {
    const ids = await addPlayers(["A", "B", "C"]);
    const [a, b, c] = [ids.get("A") as number, ids.get("B") as number, ids.get("C") as number];
    await upsertScores(1, [{ playerId: a, eliminate: true }], { quiet: true });
    await upsertScores(1, [{ playerId: a, eliminate: true }], { quiet: true }); // double tap
    const payload = await upsertScores(1, [{ playerId: b, eliminate: true }], { quiet: true });
    const rows = payload.eventResults["1"] ?? [];
    expect(rows.find((r) => r.playerId === a)).toMatchObject({ eliminationOrder: 1, livesRemaining: 0 });
    expect(rows.find((r) => r.playerId === b)).toMatchObject({ eliminationOrder: 2 });
    // C never touched: no row, but A=last place of the 2 participants
    expect(rows.find((r) => r.playerId === a)?.calculatedRank).toBe(2);
    expect(rows.find((r) => r.playerId === b)?.calculatedRank).toBe(1);
    expect(rows.some((r) => r.playerId === c)).toBe(false);
  });

  it("two eliminates in one call get distinct orders", async () => {
    const ids = await addPlayers(["A", "B"]);
    const payload = await upsertScores(1, [
      { playerId: ids.get("A") as number, eliminate: true },
      { playerId: ids.get("B") as number, eliminate: true },
    ], { quiet: true });
    const orders = (payload.eventResults["1"] ?? []).map((r) => r.eliminationOrder).sort();
    expect(orders).toEqual([1, 2]);
  });

  it("revive clears the order and restores a life", async () => {
    const ids = await addPlayers(["A"]);
    const a = ids.get("A") as number;
    await upsertScores(1, [{ playerId: a, eliminate: true }], { quiet: true });
    const payload = await upsertScores(1, [{ playerId: a, revive: true }], { quiet: true });
    expect(payload.eventResults["1"]?.find((r) => r.playerId === a)).toMatchObject({
      eliminationOrder: null,
      livesRemaining: 1,
    });
  });

  it("first touch creates the row with 3 lives", async () => {
    const ids = await addPlayers(["A"]);
    const payload = await upsertScores(1, [{ playerId: ids.get("A") as number, notes: "in" }], { quiet: true });
    expect(payload.eventResults["1"]?.[0]?.livesRemaining).toBe(3);
  });

  it("rejects scoring the blood event or unknown events/players", async () => {
    const ids = await addPlayers(["A"]);
    await expect(upsertScores(7, [{ playerId: ids.get("A") as number, rawScore: 1 }])).rejects.toThrow(RepoError);
    await expect(upsertScores(99, [{ playerId: ids.get("A") as number, rawScore: 1 }])).rejects.toThrow(RepoError);
    await expect(upsertScores(2, [{ playerId: 999, rawScore: 1 }])).rejects.toThrow(RepoError);
  });

  it("preview computes standings without writing", async () => {
    const ids = await addPlayers(["A", "B"]);
    const v = await getStateVersion();
    const standings = await previewScores(2, [
      { playerId: ids.get("A") as number, rawScore: 72 },
      { playerId: ids.get("B") as number, rawScore: 72 },
    ]);
    // two-player field tying at ranks 1-2: (20+16)/2 = 18
    expect(standings.find((s) => s.playerId === ids.get("A"))?.basePoints).toBe(18);
    expect(await getStateVersion()).toBe(v);
    const payload = await getStatePayload();
    expect(payload.eventResults["2"]).toEqual([]);
  });

  it("setEventStatus LIVE demotes any other LIVE event", async () => {
    await setEventStatus(2, "LIVE");
    const payload = await setEventStatus(3, "LIVE");
    expect(payload.events.find((e) => e.id === 2)?.status).toBe("UPCOMING");
    expect(payload.events.find((e) => e.id === 3)?.status).toBe("LIVE");
    expect(payload.liveEventId).toBe(3);
  });
});

describe("joker", () => {
  it("applies, conflicts, and force-moves", async () => {
    const ids = await addPlayers(["A", "B"]);
    const a = ids.get("A") as number;
    await upsertScores(2, [
      { playerId: a, rawScore: 88 },
      { playerId: ids.get("B") as number, rawScore: 95 },
    ]);
    let payload = await setJoker(a, 2, false);
    expect(lb(payload, a).total).toBe(32); // 16 doubled
    expect(payload.players.find((p) => p.id === a)?.jokerEventId).toBe(2);

    await expect(setJoker(a, 3, false)).rejects.toMatchObject({ status: 409 });

    payload = await setJoker(a, 3, true);
    expect(payload.players.find((p) => p.id === a)?.jokerEventId).toBe(3);
    expect(lb(payload, a).total).toBe(16); // E2 un-doubled, no E3 row yet

    payload = await setJoker(a, null, false);
    expect(payload.players.find((p) => p.id === a)?.jokerEventId).toBeNull();
  });

  it("rejects the blood event", async () => {
    const ids = await addPlayers(["A"]);
    await expect(setJoker(ids.get("A") as number, 7, false)).rejects.toMatchObject({ status: 400 });
  });
});

describe("decrees", () => {
  it("casts for multiple players with one broadcast, then voids", async () => {
    const ids = await addPlayers(["A", "B"]);
    const a = ids.get("A") as number;
    const b = ids.get("B") as number;
    let payload = await castDecree([a, b], 5, "Blessing of the Creek", "Cooked breakfast");
    expect(lb(payload, a).decreeTotal).toBe(5);
    expect(lb(payload, b).decreeTotal).toBe(5);
    const bc = payload.broadcasts.filter((x) => x.type === "DECREE");
    expect(bc).toHaveLength(1);
    expect(bc[0]?.payload).toMatchObject({ pointsDelta: 5, playerNames: ["A", "B"] });

    const decrees = await listDecrees();
    expect(decrees).toHaveLength(2);
    payload = await patchDecree(decrees[0]?.id as number, { isVoided: true });
    const voidedFor = decrees[0]?.playerId as number;
    expect(lb(payload, voidedFor).decreeTotal).toBe(0);

    payload = await patchDecree(decrees[0]?.id as number, { pointsDelta: -3, isVoided: false });
    expect(lb(payload, voidedFor).decreeTotal).toBe(-3);
  });

  it("404s on a missing decree", async () => {
    await expect(patchDecree(42, { isVoided: true })).rejects.toMatchObject({ status: 404 });
  });
});

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

describe("tv mode + trend", () => {
  it("persists tv mode with a broadcast", async () => {
    const payload = await setTvMode("BLOOD_STAGE");
    expect(payload.tvMode).toBe("BLOOD_STAGE");
    expect(payload.broadcasts.at(-1)).toMatchObject({ type: "TV_MODE", payload: { mode: "BLOOD_STAGE" } });
  });

  it("trend reflects the previous ranking after a flip", async () => {
    const ids = await addPlayers(["A", "B"]);
    const a = ids.get("A") as number;
    const b = ids.get("B") as number;
    await upsertScores(2, [
      { playerId: a, rawScore: 95 },
      { playerId: b, rawScore: 88 },
    ]);
    const payload = await castDecree([b], 10, "Blessing of the Creek", "Heroics");
    expect(lb(payload, b)).toMatchObject({ rank: 1, trend: 1 });
    expect(lb(payload, a)).toMatchObject({ rank: 2, trend: -1 });
  });
});

describe("backups", () => {
  it("export → mutate → restore roundtrip returns the exact earlier state", async () => {
    const ids = await addPlayers(["A", "B"]);
    const a = ids.get("A") as number;
    await upsertScores(2, [{ playerId: a, rawScore: 95 }]);
    const dump = await exportDump();
    expect(dump.formatVersion).toBe(1);

    await castDecree([a], -10, "Sloth", "Post-export sin");
    let payload = await getStatePayload();
    expect(lb(payload, a).total).toBe(10);

    payload = await restoreDump(dump);
    expect(lb(payload, a).total).toBe(20);
    expect(payload.decrees).toHaveLength(0);
    expect(payload.players).toHaveLength(2);

    // ids keep working after restore (sequences fixed)
    const after = await createPlayer({ name: "C" });
    expect(after.players).toHaveLength(3);
    const snaps = await listSnapshots();
    expect(snaps.some((s) => s.note === "pre-restore")).toBe(true);
  });

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

  it("rejects garbage without touching the database", async () => {
    const ids = await addPlayers(["A"]);
    await upsertScores(2, [{ playerId: ids.get("A") as number, rawScore: 95 }]);
    const v = await getStateVersion();
    await expect(restoreDump({ nope: true })).rejects.toMatchObject({ status: 400 });
    expect(await getStateVersion()).toBe(v);
    const payload = await getStatePayload();
    expect(payload.players).toHaveLength(1);
  });

  it("manual snapshots list, download, and restore", async () => {
    const ids = await addPlayers(["A"]);
    await upsertScores(2, [{ playerId: ids.get("A") as number, rawScore: 95 }]);
    await createSnapshot("before chaos");
    await castDecree([ids.get("A") as number], -5, "Wrath", "chaos");
    const snaps = await listSnapshots();
    const manual = snaps.find((s) => s.note === "before chaos");
    expect(manual).toBeDefined();
    expect(manual?.bytes).toBeGreaterThan(50);
    const json = await getSnapshotJson(manual?.id as number);
    expect(JSON.parse(json)).toMatchObject({ formatVersion: 1 });
    const { restoreSnapshot } = await import("@/db/repo");
    const payload = await restoreSnapshot(manual?.id as number);
    expect(lb(payload, ids.get("A") as number).total).toBe(20);
  });

  it("the first mutation auto-snapshots; an immediate second does not", async () => {
    await createPlayer({ name: "A" });
    const snaps1 = await listSnapshots();
    expect(snaps1.filter((s) => s.note === "auto")).toHaveLength(1);
    await createPlayer({ name: "B" });
    const snaps2 = await listSnapshots();
    expect(snaps2.filter((s) => s.note === "auto")).toHaveLength(1);
  });
});
