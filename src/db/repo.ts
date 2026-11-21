/**
 * Repository barrel — every API route and script talks to the database
 * through this module. All mutators return the fresh StatePayload.
 */

import { and, asc, desc, eq, inArray, max, ne } from "drizzle-orm";
import { DEFAULT_LIVES } from "@/lib/constants";
import { fmtSigned, ordinal } from "@/lib/format";
import { computeBloodDeltas, computeEventStandings } from "@/lib/scoring";
import type {
  BloodCard,
  BloodMatchupPublic,
  DecreeRow,
  EventStatus,
  ScoreInput,
  ScoringType,
  Standing,
  StandingInput,
  StatePayload,
  TvMode,
} from "@/lib/types";
import {
  addBroadcast,
  badRequest,
  conflict,
  mutate,
  notFound,
  recalcEvent,
  RepoError,
} from "./core";
import { getDb, type DbOrTx } from "./index";
import { appState, bloodMatchups, decrees, eventResults, events, players } from "./schema";
import { getStatePayload, toMatchupShape } from "./state";

export { RepoError } from "./core";
export { _setDb, createTestDb, ensureSeeded, getDb } from "./index";
export { getStatePayload, getStateVersion } from "./state";
export {
  createSnapshot,
  exportDump,
  getSnapshotJson,
  listSnapshots,
  restoreDump,
  restoreSnapshot,
} from "./backup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EventRow = typeof events.$inferSelect;
type ResultRow = typeof eventResults.$inferSelect;

async function requireEvent(tx: DbOrTx, eventId: number): Promise<EventRow> {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!event) throw notFound(`Event ${eventId}`);
  return event;
}

async function requirePlayers(tx: DbOrTx, ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(inArray(players.id, unique));
  const map = new Map(rows.map((r) => [r.id, r.name]));
  for (const id of unique) {
    if (!map.has(id)) throw notFound(`Player ${id}`);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Players (PRD §4 Tab 3)
// ---------------------------------------------------------------------------

export async function createPlayer(input: {
  name: string;
  epithet?: string;
}): Promise<StatePayload> {
  await mutate(async (tx) => {
    const values: typeof players.$inferInsert = { name: input.name };
    if (input.epithet !== undefined) values.epithet = input.epithet;
    await tx.insert(players).values(values);
  });
  return getStatePayload();
}

export async function updatePlayer(
  playerId: number,
  patch: { name?: string; epithet?: string; isActive?: boolean; rockCurseLevel?: number },
): Promise<StatePayload> {
  await mutate(async (tx) => {
    await requirePlayers(tx, [playerId]);
    const set: Partial<typeof players.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.epithet !== undefined) set.epithet = patch.epithet;
    if (patch.isActive !== undefined) set.isActive = patch.isActive;
    if (patch.rockCurseLevel !== undefined) set.rockCurseLevel = patch.rockCurseLevel;
    if (Object.keys(set).length > 0) {
      await tx.update(players).set(set).where(eq(players.id, playerId));
    }
  });
  return getStatePayload();
}

// ---------------------------------------------------------------------------
// Scores (PRD §3 + §4 Tab 2)
// ---------------------------------------------------------------------------

function applyPlainFields(set: Partial<typeof eventResults.$inferInsert>, input: ScoreInput): void {
  if (input.rawScore !== undefined) set.rawScore = input.rawScore;
  if (input.weightAGrams !== undefined) set.weightAGrams = input.weightAGrams;
  if (input.weightBGrams !== undefined) set.weightBGrams = input.weightBGrams;
  if (input.livesRemaining !== undefined) set.livesRemaining = input.livesRemaining;
  if (input.eliminationOrder !== undefined) set.eliminationOrder = input.eliminationOrder;
  if (input.manualRankOverride !== undefined) set.manualRankOverride = input.manualRankOverride;
  if (input.manualPointsOverride !== undefined)
    set.manualPointsOverride = input.manualPointsOverride;
  if (input.notes !== undefined) set.notes = input.notes;
}

export async function upsertScores(
  eventId: number,
  inputs: ScoreInput[],
  opts?: { quiet?: boolean },
): Promise<StatePayload> {
  await mutate(async (tx) => {
    const event = await requireEvent(tx, eventId);
    if (event.scoringType === "DANCE_OFF") {
      throw badRequest("Dance on the Creek is scored per duo, not per tribute");
    }
    const names = await requirePlayers(
      tx,
      inputs.map((i) => i.playerId),
    );

    const newlyEliminated: number[] = [];

    for (const input of inputs) {
      let [row] = await tx
        .select()
        .from(eventResults)
        .where(and(eq(eventResults.eventId, eventId), eq(eventResults.playerId, input.playerId)));
      if (!row) {
        const inserted = await tx
          .insert(eventResults)
          .values({
            eventId,
            playerId: input.playerId,
            livesRemaining: event.scoringType === "ELIMINATION" ? DEFAULT_LIVES : null,
          })
          .returning();
        row = inserted[0] as ResultRow;
      }

      const set: Partial<typeof eventResults.$inferInsert> = {};
      applyPlainFields(set, input);

      if (input.revive) {
        set.eliminationOrder = null;
        set.livesRemaining = input.livesRemaining ?? 1;
      } else if (
        input.eliminate &&
        row.eliminationOrder == null &&
        set.eliminationOrder === undefined
      ) {
        const [agg] = await tx
          .select({ maxOrder: max(eventResults.eliminationOrder) })
          .from(eventResults)
          .where(eq(eventResults.eventId, eventId));
        set.eliminationOrder = (agg?.maxOrder ?? 0) + 1;
        set.livesRemaining = 0;
        newlyEliminated.push(input.playerId);
      }

      if (Object.keys(set).length > 0) {
        set.updatedAt = new Date();
        await tx.update(eventResults).set(set).where(eq(eventResults.id, row.id));
      }
    }

    await recalcEvent(tx, eventId);

    if (!opts?.quiet) {
      let message = `${event.name} scores committed`;
      const only = inputs[0];
      if (inputs.length === 1 && only && newlyEliminated.includes(only.playerId)) {
        const [after] = await tx
          .select({ calculatedRank: eventResults.calculatedRank })
          .from(eventResults)
          .where(
            and(eq(eventResults.eventId, eventId), eq(eventResults.playerId, only.playerId)),
          );
        const name = names.get(only.playerId) ?? "A tribute";
        message =
          after?.calculatedRank != null
            ? `${name} ELIMINATED — ${ordinal(after.calculatedRank)} of the Creek`
            : `${name} ELIMINATED`;
      }
      await addBroadcast(tx, "EVENT_SCORE", { eventId, eventName: event.name, message });
    }
  });
  return getStatePayload();
}

export async function previewScores(eventId: number, inputs: ScoreInput[]): Promise<Standing[]> {
  const db = await getDb();
  const event = await requireEvent(db, eventId);
  if (event.scoringType === "DANCE_OFF") {
    throw badRequest("Dance on the Creek has no score preview");
  }
  await requirePlayers(
    db,
    inputs.map((i) => i.playerId),
  );

  const rows = await db.select().from(eventResults).where(eq(eventResults.eventId, eventId));
  const jokers = new Map(
    (await db.select({ id: players.id, jokerEventId: players.jokerEventId }).from(players)).map(
      (p) => [p.id, p.jokerEventId],
    ),
  );

  const merged = new Map<number, StandingInput & { livesRemaining: number | null }>();
  for (const r of rows) {
    merged.set(r.playerId, {
      playerId: r.playerId,
      rawScore: r.rawScore,
      eliminationOrder: r.eliminationOrder,
      weightAGrams: r.weightAGrams,
      weightBGrams: r.weightBGrams,
      manualRankOverride: r.manualRankOverride,
      manualPointsOverride: r.manualPointsOverride,
      jokerEventId: jokers.get(r.playerId) ?? null,
      livesRemaining: r.livesRemaining,
    });
  }
  let simMaxOrder = rows.reduce((m, r) => Math.max(m, r.eliminationOrder ?? 0), 0);
  for (const input of inputs) {
    const base = merged.get(input.playerId) ?? {
      playerId: input.playerId,
      rawScore: null,
      eliminationOrder: null,
      weightAGrams: null,
      weightBGrams: null,
      manualRankOverride: null,
      manualPointsOverride: null,
      jokerEventId: jokers.get(input.playerId) ?? null,
      livesRemaining: event.scoringType === "ELIMINATION" ? DEFAULT_LIVES : null,
    };
    if (input.rawScore !== undefined) base.rawScore = input.rawScore;
    if (input.weightAGrams !== undefined) base.weightAGrams = input.weightAGrams;
    if (input.weightBGrams !== undefined) base.weightBGrams = input.weightBGrams;
    if (input.eliminationOrder !== undefined) base.eliminationOrder = input.eliminationOrder;
    if (input.manualRankOverride !== undefined) base.manualRankOverride = input.manualRankOverride;
    if (input.manualPointsOverride !== undefined)
      base.manualPointsOverride = input.manualPointsOverride;
    if (input.revive) base.eliminationOrder = null;
    else if (input.eliminate && base.eliminationOrder == null) base.eliminationOrder = ++simMaxOrder;
    merged.set(input.playerId, base);
  }

  return computeEventStandings(event.scoringType as ScoringType, eventId, [...merged.values()]);
}

export async function setEventStatus(eventId: number, status: EventStatus): Promise<StatePayload> {
  await mutate(async (tx) => {
    const event = await requireEvent(tx, eventId);
    // Only one event can be LIVE and only one can be marked NEXT at a time.
    if (status === "LIVE" || status === "NEXT") {
      await tx
        .update(events)
        .set({ status: "UPCOMING", updatedAt: new Date() })
        .where(and(eq(events.status, status), ne(events.id, eventId)));
    }
    await tx.update(events).set({ status, updatedAt: new Date() }).where(eq(events.id, eventId));
    // Guided typed-score entry is quiet; the lifecycle moments banner the TV.
    if (status === "LIVE" && event.status !== "LIVE") {
      await addBroadcast(tx, "EVENT_SCORE", {
        eventId,
        eventName: event.name,
        message: `${event.name} IS LIVE — the Sin of ${event.sin} awaits`,
      });
    } else if (status === "COMPLETED" && event.status !== "COMPLETED") {
      await addBroadcast(tx, "EVENT_SCORE", {
        eventId,
        eventName: event.name,
        message: `${event.name} COMPLETE — scores are final`,
      });
    }
  });
  return getStatePayload();
}

export async function setJoker(
  playerId: number,
  eventId: number | null,
  force: boolean,
): Promise<StatePayload> {
  if (eventId != null && (eventId < 1 || eventId > 6)) {
    throw badRequest("The Mortal Sin Joker only works on Events 1–6");
  }
  await mutate(async (tx) => {
    const [player] = await tx.select().from(players).where(eq(players.id, playerId));
    if (!player) throw notFound(`Player ${playerId}`);
    if (
      eventId != null &&
      player.jokerEventId != null &&
      player.jokerEventId !== eventId &&
      !force
    ) {
      throw conflict(`Joker already cast on Event ${player.jokerEventId}`);
    }
    const prev = player.jokerEventId;
    await tx.update(players).set({ jokerEventId: eventId }).where(eq(players.id, playerId));
    if (prev != null && prev !== eventId) await recalcEvent(tx, prev);
    if (eventId != null) await recalcEvent(tx, eventId);
  });
  return getStatePayload();
}

// ---------------------------------------------------------------------------
// Decrees (PRD §4 Tab 1)
// ---------------------------------------------------------------------------

export async function castDecree(
  playerIds: number[],
  pointsDelta: number,
  sinTag: string,
  reason: string,
): Promise<StatePayload> {
  await mutate(async (tx) => {
    const names = await requirePlayers(tx, playerIds);
    await tx.insert(decrees).values(
      playerIds.map((playerId) => ({ playerId, pointsDelta, sinTag, reason })),
    );
    await addBroadcast(tx, "DECREE", {
      playerNames: playerIds.map((id) => names.get(id) ?? `Tribute #${id}`),
      pointsDelta,
      sinTag,
      reason,
    });
  });
  return getStatePayload();
}

export async function patchDecree(
  id: number,
  patch: {
    playerId?: number;
    pointsDelta?: number;
    sinTag?: string;
    reason?: string;
    isVoided?: boolean;
  },
): Promise<StatePayload> {
  await mutate(async (tx) => {
    const [row] = await tx.select().from(decrees).where(eq(decrees.id, id));
    if (!row) throw notFound(`Decree ${id}`);
    if (patch.playerId !== undefined) await requirePlayers(tx, [patch.playerId]);
    const set: Partial<typeof decrees.$inferInsert> = {};
    if (patch.playerId !== undefined) set.playerId = patch.playerId;
    if (patch.pointsDelta !== undefined) set.pointsDelta = patch.pointsDelta;
    if (patch.sinTag !== undefined) set.sinTag = patch.sinTag;
    if (patch.reason !== undefined) set.reason = patch.reason;
    if (patch.isVoided !== undefined) set.isVoided = patch.isVoided;
    if (Object.keys(set).length > 0) {
      await tx.update(decrees).set(set).where(eq(decrees.id, id));
    }
  });
  return getStatePayload();
}

export async function listDecrees(): Promise<DecreeRow[]> {
  const db = await getDb();
  const rows = await db.select().from(decrees).orderBy(desc(decrees.id));
  const names = new Map(
    (await db.select({ id: players.id, name: players.name }).from(players)).map((p) => [
      p.id,
      p.name,
    ]),
  );
  return rows.map((d) => ({
    id: d.id,
    playerId: d.playerId,
    playerName: names.get(d.playerId) ?? `Tribute #${d.playerId}`,
    pointsDelta: d.pointsDelta,
    sinTag: d.sinTag,
    reason: d.reason,
    isVoided: d.isVoided,
    createdAt: d.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Blood on the Creek (PRD §4 Tab 2 Event 7)
// ---------------------------------------------------------------------------

/** Admin view: full matchups including unrevealed cards. */
export async function listBloodMatchups(): Promise<BloodMatchupPublic[]> {
  const db = await getDb();
  const rows = await db.select().from(bloodMatchups).orderBy(asc(bloodMatchups.id));
  const names = new Map(
    (await db.select({ id: players.id, name: players.name }).from(players)).map((p) => [
      p.id,
      p.name,
    ]),
  );
  return rows.map((m) => toMatchupShape(m, (id) => names.get(id) ?? `Tribute #${id}`, true));
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

export async function generateBloodRound(roundNumber: number): Promise<StatePayload> {
  if (roundNumber < 1 || roundNumber > 3) throw badRequest("Rounds are 1, 2 and 3");
  await mutate(async (tx) => {
    const revealed = await tx
      .select()
      .from(bloodMatchups)
      .where(and(eq(bloodMatchups.roundNumber, roundNumber), eq(bloodMatchups.isRevealed, true)));
    const locked = new Set<number>();
    for (const m of revealed) {
      locked.add(m.playerAId);
      locked.add(m.playerBId);
      if (m.playerCId != null) locked.add(m.playerCId);
    }

    await tx
      .delete(bloodMatchups)
      .where(and(eq(bloodMatchups.roundNumber, roundNumber), eq(bloodMatchups.isRevealed, false)));

    const actives = await tx
      .select({ id: players.id })
      .from(players)
      .where(eq(players.isActive, true));
    const candidates = shuffle(actives.map((p) => p.id).filter((id) => !locked.has(id)));
    if (candidates.length < 2) {
      throw badRequest("Not enough unseated tributes to pair for this round");
    }

    const values: Array<typeof bloodMatchups.$inferInsert> = [];
    let i = 0;
    while (candidates.length - i >= 2) {
      if (candidates.length - i === 3) {
        values.push({
          roundNumber,
          matchupType: "3WAY",
          playerAId: candidates[i] as number,
          playerBId: candidates[i + 1] as number,
          playerCId: candidates[i + 2] as number,
        });
        i += 3;
      } else {
        values.push({
          roundNumber,
          matchupType: "1V1",
          playerAId: candidates[i] as number,
          playerBId: candidates[i + 1] as number,
        });
        i += 2;
      }
    }
    await tx.insert(bloodMatchups).values(values);
  });
  return getStatePayload();
}

export async function createBloodMatchup(input: {
  roundNumber: number;
  playerIds: number[];
}): Promise<StatePayload> {
  if (input.roundNumber < 1 || input.roundNumber > 3) throw badRequest("Rounds are 1, 2 and 3");
  if (new Set(input.playerIds).size !== input.playerIds.length) {
    throw badRequest("A tribute cannot face themselves");
  }
  await mutate(async (tx) => {
    await requirePlayers(tx, input.playerIds);
    const [a, b, c] = input.playerIds;
    await tx.insert(bloodMatchups).values({
      roundNumber: input.roundNumber,
      matchupType: input.playerIds.length === 3 ? "3WAY" : "1V1",
      playerAId: a as number,
      playerBId: b as number,
      playerCId: c ?? null,
    });
  });
  return getStatePayload();
}

export async function patchBloodMatchup(
  id: number,
  patch: {
    cardA?: BloodCard | null;
    cardB?: BloodCard | null;
    cardC?: BloodCard | null;
    reveal?: boolean;
    unreveal?: boolean;
    deltaA?: number;
    deltaB?: number;
    deltaC?: number;
  },
): Promise<StatePayload> {
  await mutate(async (tx) => {
    const [m] = await tx.select().from(bloodMatchups).where(eq(bloodMatchups.id, id));
    if (!m) throw notFound(`Matchup ${id}`);

    const working = { ...m };
    if (patch.unreveal) working.isRevealed = false;

    const cardEdits: Array<["cardA" | "cardB" | "cardC", BloodCard | null | undefined]> = [
      ["cardA", patch.cardA],
      ["cardB", patch.cardB],
      ["cardC", patch.cardC],
    ];
    for (const [field, value] of cardEdits) {
      if (value === undefined) continue;
      if (working.isRevealed) throw conflict("Unreveal the matchup before changing cards");
      if (field === "cardC" && working.matchupType !== "3WAY" && value != null) {
        throw badRequest("This matchup has no third seat");
      }
      working[field] = value;
    }

    let revealedNow = false;
    if (patch.reveal) {
      const cards = [working.cardA, working.cardB];
      if (working.matchupType === "3WAY") cards.push(working.cardC);
      if (cards.some((c) => c == null)) {
        throw conflict("All tributes must lock a card before the reveal");
      }
      const deltas = computeBloodDeltas(working.roundNumber, cards as BloodCard[]);
      working.deltaA = deltas[0] as number;
      working.deltaB = deltas[1] as number;
      if (working.matchupType === "3WAY") working.deltaC = deltas[2] as number;
      working.isRevealed = true;
      revealedNow = true;
    }

    for (const [field, value] of [
      ["deltaA", patch.deltaA],
      ["deltaB", patch.deltaB],
      ["deltaC", patch.deltaC],
    ] as const) {
      if (value === undefined) continue;
      if (!working.isRevealed) throw badRequest("Deltas apply to revealed matchups only");
      working[field] = value;
    }

    await tx
      .update(bloodMatchups)
      .set({
        cardA: working.cardA,
        cardB: working.cardB,
        cardC: working.cardC,
        deltaA: working.deltaA,
        deltaB: working.deltaB,
        deltaC: working.deltaC,
        isRevealed: working.isRevealed,
        updatedAt: new Date(),
      })
      .where(eq(bloodMatchups.id, id));

    if (revealedNow) {
      const seats: Array<{ playerId: number; card: BloodCard; delta: number }> = [
        { playerId: working.playerAId, card: working.cardA as BloodCard, delta: working.deltaA },
        { playerId: working.playerBId, card: working.cardB as BloodCard, delta: working.deltaB },
      ];
      if (working.matchupType === "3WAY" && working.playerCId != null) {
        seats.push({
          playerId: working.playerCId,
          card: working.cardC as BloodCard,
          delta: working.deltaC,
        });
      }
      const names = await requirePlayers(
        tx,
        seats.map((s) => s.playerId),
      );
      const allPure = seats.every((s) => s.card === "PURE");
      const allBlood = seats.every((s) => s.card === "BLOOD");
      const headline = allPure
        ? "HONOUR AMONG TRIBUTES"
        : allBlood
          ? "MUTUAL DESTRUCTION"
          : "BETRAYAL";
      await addBroadcast(tx, "BLOOD_REVEAL", {
        matchupId: id,
        roundNumber: working.roundNumber,
        headline,
        lines: seats.map((s) =>
          s.card === "BLOOD"
            ? `${names.get(s.playerId)} drew BLOOD (${fmtSigned(s.delta)})`
            : `${names.get(s.playerId)} kept PURE (${fmtSigned(s.delta)})`,
        ),
      });
    }
  });
  return getStatePayload();
}

export async function deleteBloodMatchup(id: number): Promise<StatePayload> {
  await mutate(async (tx) => {
    const [m] = await tx.select().from(bloodMatchups).where(eq(bloodMatchups.id, id));
    if (!m) throw notFound(`Matchup ${id}`);
    await tx.delete(bloodMatchups).where(eq(bloodMatchups.id, id));
  });
  return getStatePayload();
}

// ---------------------------------------------------------------------------
// TV mode (PRD §4 Tab 4)
// ---------------------------------------------------------------------------

export async function setTvMode(mode: TvMode): Promise<StatePayload> {
  await mutate(async (tx) => {
    await tx.update(appState).set({ tvMode: mode, updatedAt: new Date() }).where(eq(appState.id, 1));
    await addBroadcast(tx, "TV_MODE", { mode });
  });
  return getStatePayload();
}
