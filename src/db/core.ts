/**
 * Mutation core: every write runs through mutate(), which finalizes the
 * transaction per PRD §3 — recompute totals, maintain rank history (trend),
 * bump state_version, prune broadcasts, and auto-snapshot when stale.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  BROADCAST_KEEP,
  SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_KEEP,
} from "@/lib/constants";
import { computeEventStandings, rankByTotal, round1 } from "@/lib/scoring";
import type { Broadcast, ExportShape, ScoringType, StandingInput, TvMode } from "@/lib/types";
import { getDb, type DbOrTx, type Tx } from "./index";
import {
  appState,
  bloodMatchups,
  broadcasts,
  decrees,
  eventResults,
  events,
  players,
  snapshots,
} from "./schema";

export class RepoError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "RepoError";
  }
}

export const notFound = (what: string) => new RepoError(`${what} not found`, 404);
export const badRequest = (msg: string) => new RepoError(msg, 400);
export const conflict = (msg: string) => new RepoError(msg, 409);

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface PlayerTotals {
  eventPoints: Record<string, number>;
  blood: number;
  decree: number;
  total: number;
}

export async function computeTotals(db: DbOrTx): Promise<Map<number, PlayerTotals>> {
  const [allPlayers, results, revealed, activeDecrees] = [
    await db.select({ id: players.id }).from(players),
    await db
      .select({
        eventId: eventResults.eventId,
        playerId: eventResults.playerId,
        finalEventPoints: eventResults.finalEventPoints,
      })
      .from(eventResults),
    await db.select().from(bloodMatchups).where(eq(bloodMatchups.isRevealed, true)),
    await db
      .select({ playerId: decrees.playerId, pointsDelta: decrees.pointsDelta })
      .from(decrees)
      .where(eq(decrees.isVoided, false)),
  ];

  const totals = new Map<number, PlayerTotals>();
  const ensure = (pid: number): PlayerTotals => {
    let t = totals.get(pid);
    if (!t) {
      t = { eventPoints: {}, blood: 0, decree: 0, total: 0 };
      totals.set(pid, t);
    }
    return t;
  };

  for (const p of allPlayers) ensure(p.id);
  for (const r of results) {
    if (r.eventId >= 1 && r.eventId <= 6) {
      ensure(r.playerId).eventPoints[String(r.eventId)] = round1(r.finalEventPoints);
    }
  }
  for (const m of revealed) {
    ensure(m.playerAId).blood += m.deltaA;
    ensure(m.playerBId).blood += m.deltaB;
    if (m.playerCId != null) ensure(m.playerCId).blood += m.deltaC;
  }
  for (const d of activeDecrees) {
    ensure(d.playerId).decree += d.pointsDelta;
  }
  for (const t of totals.values()) {
    t.blood = round1(t.blood);
    t.decree = round1(t.decree);
    const eventSum = Object.values(t.eventPoints).reduce((a, b) => a + b, 0);
    t.total = round1(eventSum + t.blood + t.decree);
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Event recalc (PRD §3.2–3.3)
// ---------------------------------------------------------------------------

export async function recalcEvent(tx: DbOrTx, eventId: number): Promise<void> {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!event || event.scoringType === "BLOOD_MATRIX") return;

  const rows = await tx.select().from(eventResults).where(eq(eventResults.eventId, eventId));
  if (rows.length === 0) return;

  const jokerByPlayer = new Map(
    (await tx.select({ id: players.id, jokerEventId: players.jokerEventId }).from(players)).map(
      (p) => [p.id, p.jokerEventId],
    ),
  );

  const inputs: StandingInput[] = rows.map((r) => ({
    playerId: r.playerId,
    rawScore: r.rawScore,
    eliminationOrder: r.eliminationOrder,
    weightAGrams: r.weightAGrams,
    weightBGrams: r.weightBGrams,
    manualRankOverride: r.manualRankOverride,
    manualPointsOverride: r.manualPointsOverride,
    jokerEventId: jokerByPlayer.get(r.playerId) ?? null,
  }));

  const standings = computeEventStandings(event.scoringType as ScoringType, eventId, inputs);
  for (const s of standings) {
    await tx
      .update(eventResults)
      .set({
        calculatedErrorPct: s.calculatedErrorPct,
        calculatedRank: s.calculatedRank,
        basePoints: s.basePoints,
        jokerApplied: s.jokerApplied,
        finalEventPoints: s.finalEventPoints,
        updatedAt: new Date(),
      })
      .where(and(eq(eventResults.eventId, eventId), eq(eventResults.playerId, s.playerId)));
  }
}

// ---------------------------------------------------------------------------
// Broadcasts
// ---------------------------------------------------------------------------

export async function addBroadcast(
  tx: DbOrTx,
  type: Broadcast["type"],
  payload: Broadcast["payload"],
): Promise<void> {
  await tx.insert(broadcasts).values({ type, payloadJson: JSON.stringify(payload) });
}

// ---------------------------------------------------------------------------
// Dump building (shared by export, snapshots, restore)
// ---------------------------------------------------------------------------

export async function buildDump(db: DbOrTx): Promise<ExportShape> {
  const [allPlayers, allEvents, allResults, allMatchups, allDecrees, [state]] = [
    await db.select().from(players).orderBy(asc(players.id)),
    await db.select().from(events).orderBy(asc(events.id)),
    await db.select().from(eventResults).orderBy(asc(eventResults.id)),
    await db.select().from(bloodMatchups).orderBy(asc(bloodMatchups.id)),
    await db.select().from(decrees).orderBy(asc(decrees.id)),
    await db.select().from(appState).where(eq(appState.id, 1)),
  ];
  if (!state) throw new Error("app_state missing — database not seeded");

  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    players: allPlayers.map((p) => ({
      id: p.id,
      name: p.name,
      epithet: p.epithet,
      isActive: p.isActive,
      jokerEventId: p.jokerEventId,
      rockCurseLevel: p.rockCurseLevel,
      createdAt: p.createdAt.toISOString(),
    })),
    events: allEvents.map((e) => ({
      id: e.id,
      slug: e.slug,
      name: e.name,
      sin: e.sin,
      scoringType: e.scoringType as ExportShape["events"][number]["scoringType"],
      status: e.status as ExportShape["events"][number]["status"],
    })),
    eventResults: allResults.map((r) => ({
      eventId: r.eventId,
      playerId: r.playerId,
      rawScore: r.rawScore,
      eliminationOrder: r.eliminationOrder,
      livesRemaining: r.livesRemaining,
      weightAGrams: r.weightAGrams,
      weightBGrams: r.weightBGrams,
      calculatedErrorPct: r.calculatedErrorPct,
      calculatedRank: r.calculatedRank,
      manualRankOverride: r.manualRankOverride,
      basePoints: r.basePoints,
      jokerApplied: r.jokerApplied,
      manualPointsOverride: r.manualPointsOverride,
      finalEventPoints: r.finalEventPoints,
      notes: r.notes,
    })),
    bloodMatchups: allMatchups.map((m) => ({
      id: m.id,
      roundNumber: m.roundNumber,
      matchupType: m.matchupType as "1V1" | "3WAY",
      playerAId: m.playerAId,
      playerBId: m.playerBId,
      playerCId: m.playerCId,
      cardA: m.cardA as ExportShape["bloodMatchups"][number]["cardA"],
      cardB: m.cardB as ExportShape["bloodMatchups"][number]["cardB"],
      cardC: m.cardC as ExportShape["bloodMatchups"][number]["cardC"],
      deltaA: m.deltaA,
      deltaB: m.deltaB,
      deltaC: m.deltaC,
      isRevealed: m.isRevealed,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
    decrees: allDecrees.map((d) => ({
      id: d.id,
      playerId: d.playerId,
      pointsDelta: d.pointsDelta,
      sinTag: d.sinTag,
      reason: d.reason,
      isVoided: d.isVoided,
      createdAt: d.createdAt.toISOString(),
    })),
    appState: {
      tvMode: state.tvMode as TvMode,
      stateVersion: state.stateVersion,
      currentRanksJson: state.currentRanksJson,
      prevRanksJson: state.prevRanksJson,
    },
  };
}

export async function insertSnapshot(tx: DbOrTx, note: string | null): Promise<void> {
  const dump = await buildDump(tx);
  await tx.insert(snapshots).values({ note, jsonDump: JSON.stringify(dump) });
  await tx.execute(
    sql`DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT ${SNAPSHOT_KEEP})`,
  );
}

// ---------------------------------------------------------------------------
// The mutation pipeline
// ---------------------------------------------------------------------------

function canonicalRanks(ranks: Map<number, number>): string {
  const obj: Record<string, number> = {};
  for (const key of [...ranks.keys()].sort((a, b) => a - b)) {
    obj[String(key)] = ranks.get(key) as number;
  }
  return JSON.stringify(obj);
}

async function finalize(tx: Tx): Promise<void> {
  const totals = await computeTotals(tx);
  const actives = await tx
    .select({ id: players.id })
    .from(players)
    .where(eq(players.isActive, true));
  const ranks = rankByTotal(
    actives.map((p) => ({ playerId: p.id, total: totals.get(p.id)?.total ?? 0 })),
  );
  const newRanksJson = canonicalRanks(ranks);

  const [state] = await tx.select().from(appState).where(eq(appState.id, 1));
  if (!state) throw new Error("app_state missing — database not seeded");

  const changedOrder = newRanksJson !== state.currentRanksJson;
  await tx
    .update(appState)
    .set({
      currentRanksJson: newRanksJson,
      prevRanksJson: changedOrder ? state.currentRanksJson : state.prevRanksJson,
      stateVersion: state.stateVersion + 1,
      updatedAt: new Date(),
    })
    .where(eq(appState.id, 1));

  await tx.execute(
    sql`DELETE FROM broadcasts WHERE id NOT IN (SELECT id FROM broadcasts ORDER BY id DESC LIMIT ${BROADCAST_KEEP})`,
  );

  const [latestSnap] = await tx
    .select({ createdAt: snapshots.createdAt })
    .from(snapshots)
    .orderBy(desc(snapshots.id))
    .limit(1);
  const stale = !latestSnap || Date.now() - latestSnap.createdAt.getTime() > SNAPSHOT_INTERVAL_MS;
  if (stale) await insertSnapshot(tx, "auto");
}

/** Run a write + PRD §3 recalculation as one atomic transaction. */
export async function mutate<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const result = await fn(tx);
    await finalize(tx);
    return result;
  });
}
