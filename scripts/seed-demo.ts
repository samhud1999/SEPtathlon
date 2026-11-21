/**
 * Seeds a rich mid-tournament demo (close to fixtures/sample-state.json)
 * through the HTTP API. Refuses to run against a database that already has
 * players. Usage: BASE_URL=http://localhost:8765 ADMIN_PIN=2026 npm run seed:demo
 */

import type { StatePayload } from "../src/lib/types";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8765";
const ADMIN_PIN = process.env.ADMIN_PIN ?? "2026";

async function call(path: string, body?: unknown, method?: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: {
      "x-admin-pin": ADMIN_PIN,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${method ?? "POST"} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function main(): Promise<void> {
  const current = (await call("/api/state")) as StatePayload;
  if (current.players.length > 0) {
    console.error("Database already has tributes — refusing to seed demo data over them.");
    console.error("Export + restore an empty dump (or delete ./data) first.");
    process.exit(1);
  }

  const roster: Array<[string, string?]> = [
    ["Davo", "The Balcony Lurker"],
    ["Chooka", "Sovereign-in-Waiting"],
    ["Spud", "Saint of the Skillet"],
    ["Nugget"],
    ["Wazza", "Last Fan Standing"],
    ["Bluey"],
    ["Macca"],
    ["Johnno"],
    ["Robbo"],
    ["Gazza", "Twinkle Toes"],
    ["Smithy"],
    ["Deano"],
    ["Tommo", "Keeper of the Esky"],
  ];

  let payload: StatePayload = current;
  for (const [name, epithet] of roster) {
    payload = (await call("/api/players", {
      action: "create",
      name,
      ...(epithet ? { epithet } : {}),
    })) as StatePayload;
  }
  const id = new Map(payload.players.map((p) => [p.name, p.id]));
  const pid = (name: string): number => id.get(name) as number;
  console.log(`Seeded ${payload.players.length} tributes`);

  // Event 1 — Stubby Fan, completed. Elimination order mirrors the fixture.
  await call("/api/events/1/status", { status: "LIVE" });
  const e1Order = [
    "Tommo", "Deano", "Smithy", "Gazza", "Robbo", "Nugget",
    "Johnno", "Bluey", "Chooka", "Macca", "Spud", "Davo",
  ];
  for (const name of e1Order) {
    await call("/api/events/1/score", { results: [{ playerId: pid(name), eliminate: true }], quiet: true });
  }
  await call("/api/events/1/score", {
    results: [{ playerId: pid("Wazza"), livesRemaining: 2, notes: "Last fan standing" }],
    quiet: false,
  });
  await call("/api/events/1/status", { status: "COMPLETED" });
  console.log("Event 1 complete (Wazza survives)");

  // Event 2 — Krillion, completed, with the 72/72 tie and Chooka's joker.
  const e2: Array<[string, number]> = [
    ["Davo", 95], ["Chooka", 88], ["Spud", 72], ["Nugget", 72], ["Bluey", 70],
    ["Macca", 64], ["Wazza", 59], ["Johnno", 55], ["Gazza", 51], ["Robbo", 44],
    ["Deano", 31], ["Smithy", 28], ["Tommo", 12],
  ];
  await call("/api/events/2/status", { status: "LIVE" });
  await call("/api/events/2/score", {
    results: e2.map(([name, rawScore]) => ({ playerId: pid(name), rawScore })),
  });
  await call("/api/events/2/joker", { playerId: pid("Chooka"), active: true });
  await call("/api/events/2/status", { status: "COMPLETED" });
  console.log("Event 2 complete (Chooka jokers to 32)");

  // Event 3 — The Weekly 50, LIVE with partial scores.
  await call("/api/events/3/status", { status: "LIVE" });
  await call("/api/events/3/score", {
    results: [
      { playerId: pid("Nugget"), rawScore: 41 },
      { playerId: pid("Davo"), rawScore: 38 },
      { playerId: pid("Smithy"), rawScore: 33 },
      { playerId: pid("Chooka"), rawScore: 29 },
      { playerId: pid("Bluey"), rawScore: 22 },
    ],
  });
  console.log("Event 3 LIVE with 5 scores in");

  // Event 5 — three early weigh-ins.
  await call("/api/events/5/score", {
    results: [
      { playerId: pid("Gazza"), weightAGrams: 251.3, weightBGrams: 248.9 },
      { playerId: pid("Deano"), weightAGrams: 260, weightBGrams: 240 },
      { playerId: pid("Johnno"), weightAGrams: 300, weightBGrams: 255 },
    ],
    quiet: true,
  });

  // Curse levels for the Rock Hurl.
  await call("/api/players", { action: "update", playerId: pid("Davo"), rockCurseLevel: 2 });
  await call("/api/players", { action: "update", playerId: pid("Wazza"), rockCurseLevel: 1 });

  // Decrees.
  await call("/api/decrees", {
    playerIds: [pid("Davo")], pointsDelta: -3, sinTag: "Sloth",
    reason: "Left an empty tinny on the balcony rail",
  });
  await call("/api/decrees", {
    playerIds: [pid("Spud")], pointsDelta: 5, sinTag: "Blessing of the Creek",
    reason: "Cooked breakfast for the entire Sanctum",
  });
  await call("/api/decrees", {
    playerIds: [pid("Wazza")], pointsDelta: -2, sinTag: "Wrath",
    reason: "Spiked the totem tennis pole in anger",
  });
  const decrees = (await call("/api/decrees")) as { decrees: Array<{ id: number; playerName: string }> };
  const wazzaDecree = decrees.decrees.find((d) => d.playerName === "Wazza");
  if (wazzaDecree) await call(`/api/decrees/${wazzaDecree.id}`, { isVoided: true }, "PATCH");
  await call("/api/decrees", {
    playerIds: [pid("Tommo")], pointsDelta: 2, sinTag: "Blessing of the Creek",
    reason: "Saved the esky from the tide",
  });
  console.log("Decrees cast (one voided)");

  // Dance on the Creek: one scored duo, one still on the floor.
  payload = (await call("/api/blood/matchups", {
    roundNumber: 1, playerIds: [pid("Davo"), pid("Gazza")],
  })) as StatePayload;
  const duo1 = payload.blood.matchups.at(-1);
  await call(`/api/blood/matchups/${duo1?.id}`, { score: 5 }, "PATCH");
  await call("/api/blood/matchups", { roundNumber: 1, playerIds: [pid("Spud"), pid("Wazza")] });
  console.log("Dance: Davo & Gazza scored 5/10; Spud & Wazza await the judges");

  await call("/api/tv-mode", { mode: "LEADERBOARD" });
  const finalState = (await call("/api/state")) as StatePayload;
  console.log(`\nDemo seeded. Version ${finalState.version}. Leaderboard:`);
  for (const row of finalState.leaderboard) {
    console.log(`  ${String(row.rank).padStart(2)}. ${row.name.padEnd(8)} ${row.total}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
