/**
 * /api/state payload assembly — the exact StatePayload contract shape
 * (fixtures/sample-state.json is the normative example).
 */

import { asc, desc, eq } from "drizzle-orm";
import { BROADCASTS_IN_STATE, DECREES_IN_STATE } from "@/lib/constants";
import { rankByTotal } from "@/lib/scoring";
import type {
  BloodCard,
  BloodMatchupPublic,
  Broadcast,
  EventResultRow,
  EventStatus,
  ScoringType,
  StatePayload,
  TvMode,
} from "@/lib/types";
import { computeTotals } from "./core";
import { getDb, type DbOrTx } from "./index";
import {
  appState,
  bloodMatchups,
  broadcasts,
  decrees,
  events,
  players,
  eventResults,
} from "./schema";

export async function getStateVersion(): Promise<number> {
  const db = await getDb();
  const [state] = await db
    .select({ stateVersion: appState.stateVersion })
    .from(appState)
    .where(eq(appState.id, 1));
  return state?.stateVersion ?? 0;
}

type MatchupRow = typeof bloodMatchups.$inferSelect;

export function toMatchupShape(
  m: MatchupRow,
  nameOf: (id: number) => string,
  revealCards: boolean,
): BloodMatchupPublic {
  const seats: Array<{ playerId: number; card: string | null }> = [
    { playerId: m.playerAId, card: m.cardA },
    { playerId: m.playerBId, card: m.cardB },
  ];
  if (m.matchupType === "3WAY" && m.playerCId != null) {
    seats.push({ playerId: m.playerCId, card: m.cardC });
  }
  const deltas = [m.deltaA, m.deltaB, m.deltaC];
  return {
    id: m.id,
    roundNumber: m.roundNumber,
    matchupType: m.matchupType as "1V1" | "3WAY",
    isRevealed: m.isRevealed,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    players: seats.map((s, i) => ({
      playerId: s.playerId,
      name: nameOf(s.playerId),
      cardSet: s.card != null,
      card: revealCards || m.isRevealed ? ((s.card as BloodCard | null) ?? null) : null,
      delta: deltas[i] ?? 0,
    })),
  };
}

export async function getStatePayload(): Promise<StatePayload> {
  const db: DbOrTx = await getDb();

  const [allEvents, allPlayers, [state], allResults, allMatchups, recentDecrees, recentBroadcasts] =
    [
      await db.select().from(events).orderBy(asc(events.id)),
      await db.select().from(players).orderBy(asc(players.id)),
      await db.select().from(appState).where(eq(appState.id, 1)),
      await db.select().from(eventResults),
      await db.select().from(bloodMatchups).orderBy(asc(bloodMatchups.id)),
      await db.select().from(decrees).orderBy(desc(decrees.id)).limit(DECREES_IN_STATE),
      await db.select().from(broadcasts).orderBy(desc(broadcasts.id)).limit(BROADCASTS_IN_STATE),
    ];

  if (!state) throw new Error("app_state missing — database not seeded");

  const nameOf = (id: number): string =>
    allPlayers.find((p) => p.id === id)?.name ?? `Tribute #${id}`;

  const totals = await computeTotals(db);
  const actives = allPlayers.filter((p) => p.isActive);
  const ranks = rankByTotal(
    actives.map((p) => ({ playerId: p.id, total: totals.get(p.id)?.total ?? 0 })),
  );
  const prevRanks = JSON.parse(state.prevRanksJson) as Record<string, number>;

  const leaderboard = actives
    .map((p) => {
      const t = totals.get(p.id) ?? { eventPoints: {}, blood: 0, decree: 0, total: 0 };
      const rank = ranks.get(p.id) ?? actives.length;
      const prev = prevRanks[String(p.id)];
      return {
        playerId: p.id,
        name: p.name,
        epithet: p.epithet,
        rank,
        trend: prev != null ? prev - rank : null,
        total: t.total,
        eventPoints: t.eventPoints,
        bloodTotal: t.blood,
        decreeTotal: t.decree,
        jokerEventId: p.jokerEventId,
        rockCurseLevel: p.rockCurseLevel,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  const eventResultsByEvent: Record<string, EventResultRow[]> = {};
  for (let eventId = 1; eventId <= 6; eventId++) {
    eventResultsByEvent[String(eventId)] = allResults
      .filter((r) => r.eventId === eventId)
      .map((r) => ({
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
      }))
      .sort((a, b) => {
        if (a.calculatedRank == null && b.calculatedRank == null) return a.playerId - b.playerId;
        if (a.calculatedRank == null) return 1;
        if (b.calculatedRank == null) return -1;
        return a.calculatedRank - b.calculatedRank || a.playerId - b.playerId;
      });
  }

  return {
    version: state.stateVersion,
    serverTime: new Date().toISOString(),
    tvMode: state.tvMode as TvMode,
    liveEventId: allEvents.find((e) => e.status === "LIVE")?.id ?? null,
    events: allEvents.map((e) => ({
      id: e.id,
      slug: e.slug,
      name: e.name,
      sin: e.sin,
      scoringType: e.scoringType as ScoringType,
      status: e.status as EventStatus,
    })),
    players: allPlayers.map((p) => ({
      id: p.id,
      name: p.name,
      epithet: p.epithet,
      isActive: p.isActive,
      jokerEventId: p.jokerEventId,
      rockCurseLevel: p.rockCurseLevel,
    })),
    leaderboard,
    eventResults: eventResultsByEvent,
    blood: { matchups: allMatchups.map((m) => toMatchupShape(m, nameOf, false)) },
    decrees: recentDecrees.map((d) => ({
      id: d.id,
      playerId: d.playerId,
      playerName: nameOf(d.playerId),
      pointsDelta: d.pointsDelta,
      sinTag: d.sinTag,
      reason: d.reason,
      isVoided: d.isVoided,
      createdAt: d.createdAt.toISOString(),
    })),
    broadcasts: recentBroadcasts.reverse().map(
      (b) =>
        ({
          id: b.id,
          type: b.type,
          createdAt: b.createdAt.toISOString(),
          payload: JSON.parse(b.payloadJson),
        }) as Broadcast,
    ),
  };
}
