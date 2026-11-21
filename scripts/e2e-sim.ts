/**
 * CreekOS end-to-end acceptance sim (plan Task 4).
 * Runs a compressed tournament against a live server and asserts hand-computed
 * leaderboard math plus auth/validation/conflict behaviour. Exits non-zero on
 * the first failure. Assertions are scoped to the players this script creates.
 *
 *   BASE_URL=http://localhost:8765 ADMIN_PIN=2026 npm run e2e
 */

import type { StatePayload } from "../src/lib/types";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8765";
const ADMIN_PIN = process.env.ADMIN_PIN ?? "2026";

let failures = 0;
let checks = 0;

function ok(cond: boolean, label: string, detail?: unknown): void {
  checks++;
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`);
  }
}

function eq<T>(actual: T, expected: T, label: string): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  checks++;
  if (pass) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  }
}

interface CallOpts {
  method?: string;
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
}

async function call(path: string, opts: CallOpts = {}): Promise<{ status: number; json: unknown; headers: Headers }> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth !== false) headers["x-admin-pin"] = ADMIN_PIN;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: unknown = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

const state = (j: unknown): StatePayload => j as StatePayload;

function lbRow(payload: StatePayload, playerId: number) {
  const row = payload.leaderboard.find((r) => r.playerId === playerId);
  if (!row) throw new Error(`player ${playerId} missing from leaderboard`);
  return row;
}

async function main(): Promise<void> {
  console.log(`CreekOS e2e sim against ${BASE_URL}`);

  // --- health + auth ---------------------------------------------------------
  console.log("health + auth");
  const health = await call("/api/healthz", { auth: false });
  ok(health.status === 200 && (health.json as { ok: boolean }).ok, "healthz ok", health.json);

  const badLogin = await call("/api/login", { body: { pin: "nope" }, auth: false });
  eq(badLogin.status, 401, "wrong PIN rejected");

  const noAuth = await call("/api/players", {
    body: { action: "create", name: "Intruder" },
    auth: false,
  });
  eq(noAuth.status, 401, "mutator without auth rejected");

  const login = await call("/api/login", { body: { pin: ADMIN_PIN }, auth: false });
  eq(login.status, 200, "login with correct PIN");

  // --- roster ----------------------------------------------------------------
  console.log("roster");
  const names = Array.from({ length: 13 }, (_, i) => `Sim${String(i + 1).padStart(2, "0")}`);
  let payload: StatePayload | null = null;
  for (const name of names) {
    const res = await call("/api/players", { body: { action: "create", name } });
    if (res.status !== 200) throw new Error(`create player failed: ${JSON.stringify(res.json)}`);
    payload = state(res.json);
  }
  if (!payload) throw new Error("no payload");
  const id = new Map<string, number>();
  for (const name of names) {
    const p = payload.players.find((x) => x.name === name);
    if (!p) throw new Error(`player ${name} missing`);
    id.set(name, p.id);
  }
  const pid = (n: number): number => id.get(`Sim${String(n).padStart(2, "0")}`) as number;
  const soloField = payload.players.length === 13; // fresh database → count assertions valid
  ok(payload.players.length >= 13, "13 tributes created", payload.players.length);

  // --- Event 1: elimination with lives, double-tap, revive -------------------
  console.log("event 1 — elimination");
  await call("/api/events/1/status", { body: { status: "LIVE" } });
  // every tribute enters with 3 lives (rows created = participants)
  await call("/api/events/1/score", {
    body: {
      results: names.map((_, i) => ({ playerId: pid(i + 1), livesRemaining: 3 })),
      quiet: true,
    },
  });
  await call("/api/events/1/score", {
    body: { results: [{ playerId: pid(1), livesRemaining: 2 }], quiet: true },
  });
  for (let n = 1; n <= 12; n++) {
    await call("/api/events/1/score", {
      body: { results: [{ playerId: pid(n), eliminate: true }], quiet: true },
    });
  }
  // double-tap on Sim01 must not re-order
  await call("/api/events/1/score", {
    body: { results: [{ playerId: pid(1), eliminate: true }], quiet: true },
  });
  let res = await call("/api/state", { auth: false });
  payload = state(res.json);
  const e1 = payload.eventResults["1"] ?? [];
  eq(e1.find((r) => r.playerId === pid(1))?.eliminationOrder, 1, "double-tap eliminate is a no-op");
  // revive Sim12 and re-eliminate → takes the next order (13)
  await call("/api/events/1/score", { body: { results: [{ playerId: pid(12), revive: true }], quiet: true } });
  const reElim = await call("/api/events/1/score", { body: { results: [{ playerId: pid(12), eliminate: true }] } });
  payload = state(reElim.json);
  eq(
    payload.eventResults["1"]?.find((r) => r.playerId === pid(12))?.eliminationOrder,
    12, // after the revive the highest order in play is 11
    "revived tribute re-eliminates with the next order",
  );
  ok(
    payload.broadcasts.some((b) => b.type === "EVENT_SCORE" && String((b.payload as { message: string }).message).includes("ELIMINATED")),
    "single eliminate broadcasts an ELIMINATED message",
  );
  await call("/api/events/1/status", { body: { status: "COMPLETED" } });
  // E1 points: Sim13 alive=20, Sim12 16, Sim11 14, Sim10 12, ... Sim01 3
  res = await call("/api/state", { auth: false });
  payload = state(res.json);
  eq(lbRow(payload, pid(13)).eventPoints["1"], 20, "last tribute standing takes 20");
  eq(lbRow(payload, pid(12)).eventPoints["1"], 16, "re-eliminated tribute ranks 2nd (16)");
  eq(lbRow(payload, pid(1)).eventPoints["1"], 3, "first out ranks last (3)");

  // --- Event 2: raw scores, tie split, joker ---------------------------------
  console.log("event 2 — raw scores + joker");
  const e2raws: Array<[number, number]> = [
    [1, 95], [2, 88], [3, 72], [4, 72], [5, 70], [6, 64], [7, 59],
    [8, 55], [9, 51], [10, 44], [11, 31], [12, 28], [13, 12],
  ];
  res = await call("/api/events/2/score", {
    body: { results: e2raws.map(([n, rawScore]) => ({ playerId: pid(n), rawScore })) },
  });
  payload = state(res.json);
  eq(lbRow(payload, pid(3)).eventPoints["2"], 13, "72/72 tie splits to 13 (Sim03)");
  eq(lbRow(payload, pid(4)).eventPoints["2"], 13, "72/72 tie splits to 13 (Sim04)");

  res = await call("/api/events/2/joker", { body: { playerId: pid(2), active: true } });
  payload = state(res.json);
  eq(lbRow(payload, pid(2)).eventPoints["2"], 32, "joker doubles 16 → 32");

  const conflictRes = await call("/api/events/3/joker", { body: { playerId: pid(2), active: true } });
  eq(conflictRes.status, 409, "joker move without force → 409");
  res = await call("/api/events/3/joker", { body: { playerId: pid(2), active: true, force: true } });
  payload = state(res.json);
  eq(lbRow(payload, pid(2)).eventPoints["2"], 16, "force-moved joker un-doubles E2");
  const badJoker = await call("/api/events/7/joker", { body: { playerId: pid(2), active: true } });
  eq(badJoker.status, 400, "joker rejected on the dance event");

  // --- Event 3: partial live scores, joker lands here ------------------------
  console.log("event 3 — live partial");
  await call("/api/events/3/status", { body: { status: "LIVE" } });
  res = await call("/api/events/3/score", {
    body: { results: [{ playerId: pid(1), rawScore: 38 }, { playerId: pid(2), rawScore: 29 }] },
  });
  payload = state(res.json);
  eq(lbRow(payload, pid(1)).eventPoints["3"], 20, "E3 leader takes 20");
  eq(lbRow(payload, pid(2)).eventPoints["3"], 32, "joker doubles E3 16 → 32");

  // --- Event 5: fruit split ---------------------------------------------------
  console.log("event 5 — fruit split");
  res = await call("/api/events/5/score", {
    body: {
      results: [
        { playerId: pid(10), weightAGrams: 251.3, weightBGrams: 248.9 },
        { playerId: pid(12), weightAGrams: 260, weightBGrams: 240 },
        { playerId: pid(8), weightAGrams: 300, weightBGrams: 255 },
      ],
    },
  });
  payload = state(res.json);
  const fruit = payload.eventResults["5"] ?? [];
  eq(fruit.find((r) => r.playerId === pid(10))?.calculatedErrorPct, 0.24, "0.240% error leads the clubhouse");
  eq(lbRow(payload, pid(10)).eventPoints["5"], 20, "fruit leader takes 20");
  eq(lbRow(payload, pid(8)).eventPoints["5"], 14, "fruit 3rd takes 14");

  // --- preview is write-free --------------------------------------------------
  console.log("preview");
  const versionBefore = payload.version;
  const preview = await call("/api/events/6/preview", {
    body: { results: [{ playerId: pid(1), rawScore: 10 }] },
  });
  eq(preview.status, 200, "preview responds");
  res = await call("/api/state", { auth: false });
  payload = state(res.json);
  eq(payload.version, versionBefore, "preview does not bump the version");
  eq((payload.eventResults["6"] ?? []).length, 0, "preview writes nothing");

  // --- decrees ----------------------------------------------------------------
  console.log("decrees");
  res = await call("/api/decrees", {
    body: { playerIds: [pid(1), pid(3)], pointsDelta: -3, sinTag: "Sloth", reason: "E2E tinny on the rail" },
  });
  payload = state(res.json);
  eq(lbRow(payload, pid(1)).decreeTotal, -3, "decree docks Sim01");
  eq(lbRow(payload, pid(3)).decreeTotal, -3, "decree docks Sim03");
  const decreeBc = payload.broadcasts.filter((b) => b.type === "DECREE").at(-1);
  ok(
    decreeBc != null && (decreeBc.payload as { playerNames: string[] }).playerNames.length === 2,
    "one DECREE broadcast names both tributes",
  );
  await call("/api/decrees", {
    body: { playerIds: [pid(13)], pointsDelta: 2, sinTag: "Blessing of the Creek", reason: "E2E esky rescue" },
  });
  const list = await call("/api/decrees");
  const mine = ((list.json as { decrees: Array<{ id: number; playerId: number; reason: string }> }).decrees).filter(
    (d) => d.reason.startsWith("E2E"),
  );
  eq(mine.length, 3, "decree history lists all three rows");
  const toVoid = mine.find((d) => d.playerId === pid(1));
  res = await call(`/api/decrees/${toVoid?.id}`, { method: "PATCH", body: { isVoided: true } });
  payload = state(res.json);
  eq(lbRow(payload, pid(1)).decreeTotal, 0, "voided decree reverses the points");
  const missingPatch = await call("/api/decrees/999999", { method: "PATCH", body: { isVoided: true } });
  eq(missingPatch.status, 404, "patching a missing decree → 404");
  const badBody = await call("/api/events/2/score", {
    body: { results: [{ playerId: pid(1), rawScore: -5 }] },
  });
  eq(badBody.status, 400, "negative raw score → 400");

  // --- dance on the creek -----------------------------------------------------
  console.log("dance on the creek");
  res = await call("/api/blood/generate", { body: { roundNumber: 1 } });
  payload = state(res.json);
  if (soloField) {
    eq(payload.blood.matchups.length, 6, "13 tributes → 6 duos");
    eq(payload.blood.matchups.filter((m) => m.matchupType === "3WAY").length, 1, "exactly one trio");
    const seated = payload.blood.matchups.flatMap((m) => m.players.map((p) => p.playerId));
    eq(new Set(seated).size, 13, "every tribute seated once");
  }
  ok(payload.blood.matchups.every((m) => !m.isRevealed), "fresh duos are unscored");
  const drawn = payload.blood.matchups[0];
  const tooHigh = await call(`/api/blood/matchups/${drawn?.id}`, { method: "PATCH", body: { score: 11 } });
  eq(tooHigh.status, 400, "score above 10 → 400");

  // clear the drawn duos so dance totals stay hand-computable
  const adminList = await call("/api/blood/matchups");
  for (const m of (adminList.json as { matchups: Array<{ id: number }> }).matchups) {
    await call(`/api/blood/matchups/${m.id}`, { method: "DELETE" });
  }

  res = await call("/api/blood/matchups", { body: { roundNumber: 1, playerIds: [pid(4), pid(5)] } });
  payload = state(res.json);
  const duo = payload.blood.matchups.find((m) => m.players.some((p) => p.playerId === pid(4)));
  res = await call(`/api/blood/matchups/${duo?.id}`, { method: "PATCH", body: { score: 7.5 } });
  payload = state(res.json);
  const scored = payload.blood.matchups.find((m) => m.id === duo?.id);
  ok(
    scored?.isRevealed === true && scored.players.every((p) => p.delta === 7.5),
    "duo score visible in the public state",
  );
  eq(lbRow(payload, pid(4)).bloodTotal, 7.5, "duo score lands on Sim04");
  eq(lbRow(payload, pid(5)).bloodTotal, 7.5, "duo score lands on Sim05");
  const danceBc = payload.broadcasts.filter((b) => b.type === "EVENT_SCORE").at(-1);
  const dancePayload = danceBc?.payload as { eventId: number; message: string } | undefined;
  ok(
    dancePayload?.eventId === 7 && dancePayload.message.endsWith("7.5/10"),
    "duo score broadcasts an EVENT_SCORE for event 7",
    dancePayload,
  );

  res = await call("/api/blood/matchups", { body: { roundNumber: 1, playerIds: [pid(4), pid(5), pid(6)] } });
  payload = state(res.json);
  const trio = payload.blood.matchups.find((m) => m.matchupType === "3WAY");
  res = await call(`/api/blood/matchups/${trio?.id}`, { method: "PATCH", body: { score: 6 } });
  payload = state(res.json);
  eq(lbRow(payload, pid(4)).bloodTotal, 13.5, "trio score stacks with the duo (Sim04)");
  eq(lbRow(payload, pid(5)).bloodTotal, 13.5, "trio score stacks with the duo (Sim05)");
  eq(lbRow(payload, pid(6)).bloodTotal, 6, "trio score lands on all three (Sim06)");

  res = await call(`/api/blood/matchups/${trio?.id}`, { method: "PATCH", body: { score: 4 } });
  payload = state(res.json);
  eq(lbRow(payload, pid(4)).bloodTotal, 11.5, "amended score replaces, never stacks (Sim04)");
  eq(lbRow(payload, pid(6)).bloodTotal, 4, "amended score replaces, never stacks (Sim06)");

  res = await call(`/api/blood/matchups/${duo?.id}`, { method: "PATCH", body: { score: null } });
  payload = state(res.json);
  eq(lbRow(payload, pid(4)).bloodTotal, 4, "cleared duo drops from the Dance total (Sim04)");
  eq(lbRow(payload, pid(5)).bloodTotal, 4, "cleared duo drops from the Dance total (Sim05)");

  // --- tv mode ----------------------------------------------------------------
  console.log("tv mode");
  res = await call("/api/tv-mode", { body: { mode: "BLOOD_STAGE" } });
  payload = state(res.json);
  eq(payload.tvMode, "BLOOD_STAGE", "tv switches to the dance stage");
  res = await call("/api/tv-mode", { body: { mode: "LEADERBOARD" } });
  payload = state(res.json);
  eq(payload.tvMode, "LEADERBOARD", "tv back to the leaderboard");

  // --- god-mode amendments ----------------------------------------------------
  console.log("god-mode amendments");
  res = await call("/api/events/6/score", {
    body: { results: [{ playerId: pid(13), manualRankOverride: 2 }] },
  });
  payload = state(res.json);
  eq(lbRow(payload, pid(13)).eventPoints["6"], 16, "rank override alone scores from the master table");
  res = await call("/api/events/6/score", {
    body: { results: [{ playerId: pid(13), manualRankOverride: null }] },
  });
  payload = state(res.json);
  eq(lbRow(payload, pid(13)).eventPoints["6"], 0, "cleared override returns to unranked 0");
  // placements: a 2-way tie for 1st (both overrides = 1) splits ranks 1–2 → 18 each
  res = await call("/api/events/6/score", {
    body: { results: [{ playerId: pid(13), manualRankOverride: 1 }, { playerId: pid(11), manualRankOverride: 1 }] },
  });
  payload = state(res.json);
  eq(lbRow(payload, pid(13)).eventPoints["6"], 18, "placements tie for 1st splits to 18 (Sim13)");
  eq(lbRow(payload, pid(11)).eventPoints["6"], 18, "placements tie for 1st splits to 18 (Sim11)");
  res = await call("/api/events/6/score", {
    body: { results: [{ playerId: pid(13), manualRankOverride: null }, { playerId: pid(11), manualRankOverride: null }] },
  });
  payload = state(res.json);
  eq(lbRow(payload, pid(11)).eventPoints["6"], 0, "cleared placements return to unranked 0");
  res = await call("/api/events/2/score", {
    body: { results: [{ playerId: pid(13), manualPointsOverride: 7.5 }] },
  });
  payload = state(res.json);
  eq(lbRow(payload, pid(13)).eventPoints["2"], 7.5, "points override wins outright (7.5)");

  // --- ETag -------------------------------------------------------------------
  console.log("etag");
  const first = await fetch(`${BASE_URL}/api/state`);
  const etag = first.headers.get("etag");
  const second = await fetch(`${BASE_URL}/api/state`, {
    headers: etag ? { "If-None-Match": etag } : {},
  });
  eq(second.status, 304, "If-None-Match returns 304");

  // --- final hand-computed leaderboard ---------------------------------------
  console.log("final hand-computed totals");
  res = await call("/api/state", { auth: false });
  payload = state(res.json);
  // dance adds +4 to Sim04/05/06 (duo cleared, trio amended to 4)
  const expectTotals: Array<[number, number]> = [
    [2, 52], [1, 43], [10, 38], [12, 36], [8, 32], [13, 29.5], [4, 23],
    [5, 22], [6, 22], [11, 19], [7, 18], [9, 18], [3, 15],
  ];
  for (const [n, total] of expectTotals) {
    eq(lbRow(payload, pid(n)).total, total, `Sim${String(n).padStart(2, "0")} total = ${total}`);
  }
  if (soloField) {
    eq(lbRow(payload, pid(2)).rank, 1, "Sim02 wears the crown");
    eq(lbRow(payload, pid(5)).rank, 8, "two-way tie shares rank 8 (Sim05)");
    eq(lbRow(payload, pid(6)).rank, 8, "two-way tie shares rank 8 (Sim06)");
    eq(lbRow(payload, pid(7)).rank, 11, "two-way tie shares rank 11 (Sim07)");
    eq(lbRow(payload, pid(9)).rank, 11, "two-way tie shares rank 11 (Sim09)");
    eq(lbRow(payload, pid(3)).rank, 13, "competition ranking skips to 13");
  }

  // --- export → mutate → restore ---------------------------------------------
  console.log("export / restore");
  const before = new Map(payload.leaderboard.map((r) => [r.playerId, r.total]));
  const exportRes = await call("/api/export");
  eq(exportRes.status, 200, "export downloads");
  await call("/api/decrees", {
    body: { playerIds: [pid(5)], pointsDelta: 5, sinTag: "Pride", reason: "E2E post-export sin" },
  });
  res = await call("/api/restore", { body: { confirm: "RESTORE", dump: exportRes.json } });
  eq(res.status, 200, "restore accepts its own export");
  payload = state(res.json);
  for (const [playerId, total] of before) {
    eq(lbRow(payload, playerId).total, total, `restored total intact for #${playerId}`);
  }
  const badRestore = await call("/api/restore", { body: { confirm: "RESTORE", dump: { nope: 1 } } });
  eq(badRestore.status, 400, "garbage restore rejected");

  // --- verdict ----------------------------------------------------------------
  console.log(`\n${checks} checks, ${failures} failures`);
  if (failures > 0) process.exit(1);
  console.log("E2E SIM GREEN — the Creek is satisfied.");
}

main().catch((err) => {
  console.error("E2E sim crashed:", err);
  process.exit(1);
});
