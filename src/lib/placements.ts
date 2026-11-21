/**
 * Drag-to-rank placements (events 1–6). Pure helpers over an ordered list of
 * entries: each entry is a tribute, and `tiedWithAbove` folds it into the slot
 * of the entry before it. A slot's members all take the slot's start rank as
 * their `manualRankOverride`; the engine's locked-group logic then splits the
 * covered ranks' points exactly as the tie rules require.
 */

import { computeEventStandings } from "./scoring";
import type { EventResultRow, ScoreInput, ScoringType, Standing, StandingInput } from "./types";

export interface PlacementEntry {
  playerId: number;
  tiedWithAbove: boolean;
}

/**
 * Seed from the current standings: effective rank order (calculatedRank
 * ascending, unranked last in roster order); consecutive tributes who share a
 * saved non-null manualRankOverride come back as a tie.
 */
export function seedEntries(
  players: ReadonlyArray<{ id: number }>,
  rows: ReadonlyArray<EventResultRow>,
): PlacementEntry[] {
  const rowOf = new Map(rows.map((r) => [r.playerId, r]));
  const ordered = players
    .map((p, index) => ({ id: p.id, index, rank: rowOf.get(p.id)?.calculatedRank ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);

  return ordered.map((p, i) => {
    const mine = rowOf.get(p.id)?.manualRankOverride ?? null;
    const prev = i > 0 ? (rowOf.get(ordered[i - 1]!.id)?.manualRankOverride ?? null) : null;
    return { playerId: p.id, tiedWithAbove: i > 0 && mine != null && mine === prev };
  });
}

/** Groups of playerIds, one per slot, in finishing order. Entry 0 always opens a slot. */
export function toSlots(entries: ReadonlyArray<PlacementEntry>): number[][] {
  const slots: number[][] = [];
  entries.forEach((e, i) => {
    if (i > 0 && e.tiedWithAbove) slots[slots.length - 1]!.push(e.playerId);
    else slots.push([e.playerId]);
  });
  return slots;
}

/** playerId → start rank of its slot (1 + members in earlier slots). */
export function entryRanks(entries: ReadonlyArray<PlacementEntry>): Map<number, number> {
  const ranks = new Map<number, number>();
  let next = 1;
  for (const slot of toSlots(entries)) {
    for (const id of slot) ranks.set(id, next);
    next += slot.length;
  }
  return ranks;
}

/** Array move; the moved tribute lands as its own slot (untied). */
export function moveEntry(
  entries: ReadonlyArray<PlacementEntry>,
  from: number,
  to: number,
): PlacementEntry[] {
  const arr = [...entries];
  if (from === to || from < 0 || from >= arr.length || to < 0 || to >= arr.length) return arr;
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, { ...(moved as PlacementEntry), tiedWithAbove: false });
  return arr;
}

/** Flip a tribute's tie with the slot above; the first entry has nothing above it. */
export function toggleTie(entries: ReadonlyArray<PlacementEntry>, playerId: number): PlacementEntry[] {
  return entries.map((e, i) =>
    i > 0 && e.playerId === playerId ? { ...e, tiedWithAbove: !e.tiedWithAbove } : e,
  );
}

/** Save body: every placed tribute locked to its slot rank; `alsoClear` ids reverted to auto. */
export function placementInputs(
  entries: ReadonlyArray<PlacementEntry>,
  alsoClear: ReadonlyArray<number> = [],
): ScoreInput[] {
  const ranks = entryRanks(entries);
  return [
    ...entries.map((e) => ({ playerId: e.playerId, manualRankOverride: ranks.get(e.playerId) ?? null })),
    ...alsoClear.map((playerId) => ({ playerId, manualRankOverride: null })),
  ];
}

/** Clear body: every listed tribute back to automatic ranking. */
export function clearInputs(playerIds: ReadonlyArray<number>): ScoreInput[] {
  return playerIds.map((playerId) => ({ playerId, manualRankOverride: null }));
}

/**
 * What the engine will award once these placements are saved — runs the real
 * `computeEventStandings` with every tribute locked to its slot rank, so the
 * preview includes tie splits, the joker and any points override.
 */
export function projectPlacements(
  scoringType: ScoringType,
  eventId: number,
  entries: ReadonlyArray<PlacementEntry>,
  jokerByPlayer: ReadonlyMap<number, number | null>,
  pointsOverrides: ReadonlyMap<number, number | null>,
): Map<number, Standing> {
  const ranks = entryRanks(entries);
  const inputs: StandingInput[] = entries.map((e) => ({
    playerId: e.playerId,
    rawScore: null,
    eliminationOrder: null,
    weightAGrams: null,
    weightBGrams: null,
    manualRankOverride: ranks.get(e.playerId) ?? null,
    manualPointsOverride: pointsOverrides.get(e.playerId) ?? null,
    jokerEventId: jokerByPlayer.get(e.playerId) ?? null,
  }));
  return new Map(computeEventStandings(scoringType, eventId, inputs).map((s) => [s.playerId, s]));
}
