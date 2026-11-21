/**
 * CreekOS pure scoring engine (PRD §3 + design doc decisions 1–5).
 * No IO, no Date, no randomness — everything here is deterministic and unit-tested.
 */

import { pointsForRank } from "./constants";
import type { ScoringType, Standing, StandingInput } from "./types";

/** PRD §3.2 tie-splitting rounding: up to the nearest half. */
export function ceilToHalf(x: number): number {
  return Math.ceil(x * 2) / 2;
}

/** All leaderboard point values live at one-decimal precision. */
export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** |share of half A − 50%| in percent, 3 dp. Null until both halves are weighed. */
export function computeFruitErrorPct(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  const total = a + b;
  if (!(total > 0)) return null;
  return round3(Math.abs((a / total) * 100 - 50));
}

interface Entry {
  input: StandingInput;
  /** Higher is better; null = unranked (no metric yet). */
  sortValue: number | null;
  errorPct: number | null;
}

function metricFor(scoringType: ScoringType, input: StandingInput): Entry {
  switch (scoringType) {
    case "RAW_HIGH":
      return { input, sortValue: input.rawScore, errorPct: null };
    case "ELIMINATION":
      // Alive (no elimination order) outranks every eliminated player; later
      // eliminations (higher order) outrank earlier ones. Positional, so gaps
      // and equal orders behave sensibly.
      return {
        input,
        sortValue: input.eliminationOrder == null ? Number.POSITIVE_INFINITY : input.eliminationOrder,
        errorPct: null,
      };
    case "FRUIT_SPLIT": {
      const err = computeFruitErrorPct(input.weightAGrams, input.weightBGrams);
      return { input, sortValue: err == null ? null : -err, errorPct: err };
    }
    case "DANCE_OFF":
      return { input, sortValue: null, errorPct: null };
  }
}

function meanPointsForRanks(ranks: number[]): number {
  const sum = ranks.reduce((acc, r) => acc + pointsForRank(r), 0);
  return ceilToHalf(sum / ranks.length);
}

/**
 * Rank an event's participants and compute their points (PRD §3.2–3.3).
 * Returns one Standing per input row. DANCE_OFF events have no standings.
 */
export function computeEventStandings(
  scoringType: ScoringType,
  eventId: number,
  rows: StandingInput[],
): Standing[] {
  if (scoringType === "DANCE_OFF" || rows.length === 0) return [];

  const entries = rows.map((r) => metricFor(scoringType, r));

  const locked = entries.filter((e) => e.input.manualRankOverride != null);
  const autos = entries
    .filter((e) => e.input.manualRankOverride == null && e.sortValue != null)
    .sort((x, y) => {
      const diff = (y.sortValue as number) - (x.sortValue as number);
      if (diff !== 0 && !Number.isNaN(diff)) return diff;
      return x.input.playerId - y.input.playerId;
    });
  const unranked = entries.filter((e) => e.input.manualRankOverride == null && e.sortValue == null);

  // Locked players grouped by their exact override rank; a group of k locked to
  // rank R occupies rank slots R..R+k-1 (design doc decision 4).
  const lockedGroups = new Map<number, Entry[]>();
  for (const e of locked) {
    const r = e.input.manualRankOverride as number;
    const group = lockedGroups.get(r) ?? [];
    group.push(e);
    lockedGroups.set(r, group);
  }
  const consumedRanks = new Set<number>();
  for (const [r, group] of lockedGroups) {
    group.sort((a, b) => a.input.playerId - b.input.playerId);
    for (let i = 0; i < group.length; i++) consumedRanks.add(r + i);
  }

  // Autos fill the remaining rank slots 1,2,3,… in metric order.
  const assigned = new Map<number, number>(); // playerId -> rank
  let candidate = 1;
  for (const e of autos) {
    while (consumedRanks.has(candidate)) candidate++;
    assigned.set(e.input.playerId, candidate);
    candidate++;
  }

  const base = new Map<number, number>(); // playerId -> basePoints
  const rank = new Map<number, number>(); // playerId -> calculatedRank

  // Auto tie groups: consecutive autos sharing the exact same metric.
  let i = 0;
  while (i < autos.length) {
    let j = i + 1;
    while (j < autos.length && autos[j]!.sortValue === autos[i]!.sortValue) j++;
    const group = autos.slice(i, j);
    const ranks = group.map((e) => assigned.get(e.input.playerId) as number);
    const points = group.length > 1 ? meanPointsForRanks(ranks) : pointsForRank(ranks[0] as number);
    group.forEach((e, k) => {
      rank.set(e.input.playerId, ranks[k] as number);
      base.set(e.input.playerId, points);
    });
    i = j;
  }

  // Locked groups score from their locked slot(s).
  for (const [r, group] of lockedGroups) {
    const ranks = group.map((_, k) => r + k);
    const points = group.length > 1 ? meanPointsForRanks(ranks) : pointsForRank(r);
    group.forEach((e, k) => {
      rank.set(e.input.playerId, ranks[k] as number);
      base.set(e.input.playerId, points);
    });
  }

  for (const e of unranked) {
    base.set(e.input.playerId, 0);
  }

  const standings: Standing[] = entries.map((e) => {
    const playerId = e.input.playerId;
    const basePoints = base.get(playerId) ?? 0;
    const jokerApplied = e.input.jokerEventId === eventId;
    const finalEventPoints =
      e.input.manualPointsOverride != null
        ? e.input.manualPointsOverride
        : round1(basePoints * (jokerApplied ? 2 : 1));
    return {
      playerId,
      calculatedErrorPct: scoringType === "FRUIT_SPLIT" ? e.errorPct : null,
      calculatedRank: rank.get(playerId) ?? null,
      basePoints,
      jokerApplied,
      finalEventPoints,
    };
  });

  return standings.sort((a, b) => {
    if (a.calculatedRank == null && b.calculatedRank == null) return a.playerId - b.playerId;
    if (a.calculatedRank == null) return 1;
    if (b.calculatedRank == null) return -1;
    return a.calculatedRank - b.calculatedRank || a.playerId - b.playerId;
  });
}

/** Competition ranking over grand totals: ties share a rank, the next rank skips. */
export function rankByTotal(
  totals: ReadonlyArray<{ playerId: number; total: number }>,
): Map<number, number> {
  const sorted = [...totals].sort((a, b) => b.total - a.total || a.playerId - b.playerId);
  const ranks = new Map<number, number>();
  let prevTotal: number | null = null;
  let prevRank = 0;
  sorted.forEach((t, idx) => {
    const r = prevTotal != null && t.total === prevTotal ? prevRank : idx + 1;
    ranks.set(t.playerId, r);
    prevTotal = t.total;
    prevRank = r;
  });
  return ranks;
}
