import { describe, expect, it } from "vitest";
import {
  ceilToHalf,
  computeBloodDeltas,
  computeEventStandings,
  computeFruitErrorPct,
  rankByTotal,
  round1,
} from "@/lib/scoring";
import { pointsForRank } from "@/lib/constants";
import type { BloodCard, Standing, StandingInput } from "@/lib/types";

function row(playerId: number, partial: Partial<StandingInput> = {}): StandingInput {
  return {
    playerId,
    rawScore: null,
    eliminationOrder: null,
    weightAGrams: null,
    weightBGrams: null,
    manualRankOverride: null,
    manualPointsOverride: null,
    jokerEventId: null,
    ...partial,
  };
}

function byPlayer(standings: Standing[]): Map<number, Standing> {
  return new Map(standings.map((s) => [s.playerId, s]));
}

describe("ceilToHalf / round1", () => {
  it("keeps exact values (PRD ranks 3-4 tie mean)", () => {
    expect(ceilToHalf(13)).toBe(13);
  });
  it("rounds 16.6667 up to 17 (ranks 1-3 tie mean)", () => {
    expect(ceilToHalf(16.6667)).toBe(17);
  });
  it("keeps halves", () => {
    expect(ceilToHalf(16.5)).toBe(16.5);
  });
  it("rounds 13.25 up to 13.5", () => {
    expect(ceilToHalf(13.25)).toBe(13.5);
  });
  it("round1 rounds to one decimal", () => {
    expect(round1(13.333)).toBe(13.3);
    expect(round1(26)).toBe(26);
  });
});

describe("pointsForRank", () => {
  it("matches the PRD master table", () => {
    expect(pointsForRank(1)).toBe(20);
    expect(pointsForRank(2)).toBe(16);
    expect(pointsForRank(15)).toBe(1);
  });
  it("ranks beyond 15 score 1", () => {
    expect(pointsForRank(16)).toBe(1);
    expect(pointsForRank(40)).toBe(1);
  });
  it("invalid ranks score 0", () => {
    expect(pointsForRank(0)).toBe(0);
    expect(pointsForRank(-3)).toBe(0);
    expect(pointsForRank(2.5)).toBe(0);
  });
});

describe("computeFruitErrorPct", () => {
  it("510/490 is 1.0% off", () => {
    expect(computeFruitErrorPct(510, 490)).toBe(1);
  });
  it("251.3/248.9 is 0.240% off (fixture leader)", () => {
    expect(computeFruitErrorPct(251.3, 248.9)).toBe(0.24);
  });
  it("300/255 is 4.054% off", () => {
    expect(computeFruitErrorPct(300, 255)).toBe(4.054);
  });
  it("is symmetric", () => {
    expect(computeFruitErrorPct(490, 510)).toBe(1);
  });
  it("null when a weight is missing or total is zero", () => {
    expect(computeFruitErrorPct(null, 100)).toBeNull();
    expect(computeFruitErrorPct(100, null)).toBeNull();
    expect(computeFruitErrorPct(0, 0)).toBeNull();
  });
});

describe("computeEventStandings — RAW_HIGH", () => {
  it("ranks by raw score desc with master points", () => {
    const s = byPlayer(
      computeEventStandings("RAW_HIGH", 2, [
        row(1, { rawScore: 95 }),
        row(2, { rawScore: 88 }),
        row(3, { rawScore: 70 }),
      ]),
    );
    expect(s.get(1)).toMatchObject({ calculatedRank: 1, basePoints: 20, finalEventPoints: 20 });
    expect(s.get(2)).toMatchObject({ calculatedRank: 2, basePoints: 16 });
    expect(s.get(3)).toMatchObject({ calculatedRank: 3, basePoints: 14 });
  });

  it("splits a two-way tie at ranks 3-4 into 13 points each (PRD example)", () => {
    const s = byPlayer(
      computeEventStandings("RAW_HIGH", 2, [
        row(1, { rawScore: 95 }),
        row(2, { rawScore: 88 }),
        row(3, { rawScore: 72 }),
        row(4, { rawScore: 72 }),
        row(5, { rawScore: 70 }),
      ]),
    );
    expect(s.get(3)?.basePoints).toBe(13);
    expect(s.get(4)?.basePoints).toBe(13);
    expect(s.get(3)?.calculatedRank).toBe(3);
    expect(s.get(4)?.calculatedRank).toBe(4);
    expect(s.get(5)?.calculatedRank).toBe(5);
    expect(s.get(5)?.basePoints).toBe(11);
  });

  it("splits a three-way tie at rank 1 into 17 points each (ceil-to-half)", () => {
    const s = byPlayer(
      computeEventStandings("RAW_HIGH", 2, [
        row(1, { rawScore: 50 }),
        row(2, { rawScore: 50 }),
        row(3, { rawScore: 50 }),
        row(4, { rawScore: 10 }),
      ]),
    );
    expect(s.get(1)?.basePoints).toBe(17);
    expect(s.get(2)?.basePoints).toBe(17);
    expect(s.get(3)?.basePoints).toBe(17);
    expect(s.get(4)?.calculatedRank).toBe(4);
    expect(s.get(4)?.basePoints).toBe(12);
  });

  it("null rawScore is unranked with zero points", () => {
    const s = byPlayer(
      computeEventStandings("RAW_HIGH", 2, [row(1, { rawScore: 10 }), row(2)]),
    );
    expect(s.get(2)).toMatchObject({ calculatedRank: null, basePoints: 0, finalEventPoints: 0 });
    expect(s.get(1)?.calculatedRank).toBe(1);
  });

  it("applies the joker only on the matching event", () => {
    const s = byPlayer(
      computeEventStandings("RAW_HIGH", 2, [
        row(1, { rawScore: 95, jokerEventId: 2 }),
        row(2, { rawScore: 88, jokerEventId: 3 }),
      ]),
    );
    expect(s.get(1)).toMatchObject({ jokerApplied: true, basePoints: 20, finalEventPoints: 40 });
    expect(s.get(2)).toMatchObject({ jokerApplied: false, finalEventPoints: 16 });
  });

  it("doubles a tie split with the joker (13 -> 26)", () => {
    const s = byPlayer(
      computeEventStandings("RAW_HIGH", 2, [
        row(1, { rawScore: 95 }),
        row(2, { rawScore: 88 }),
        row(3, { rawScore: 72, jokerEventId: 2 }),
        row(4, { rawScore: 72 }),
        row(5, { rawScore: 70 }),
      ]),
    );
    expect(s.get(3)).toMatchObject({ basePoints: 13, jokerApplied: true, finalEventPoints: 26 });
    expect(s.get(4)?.finalEventPoints).toBe(13);
  });

  it("manualPointsOverride beats everything, including the joker", () => {
    const s = byPlayer(
      computeEventStandings("RAW_HIGH", 2, [
        row(1, { rawScore: 95, jokerEventId: 2, manualPointsOverride: 7.5 }),
        row(2, { rawScore: 88 }),
      ]),
    );
    expect(s.get(1)?.finalEventPoints).toBe(7.5);
    expect(s.get(1)?.basePoints).toBe(20);
  });

  it("manualPointsOverride applies even to an unranked row", () => {
    const s = byPlayer(
      computeEventStandings("RAW_HIGH", 2, [row(1, { rawScore: 10 }), row(2, { manualPointsOverride: 4 })]),
    );
    expect(s.get(2)).toMatchObject({ calculatedRank: null, finalEventPoints: 4 });
  });

  it("manualRankOverride locks the rank and autos fill around it", () => {
    const s = byPlayer(
      computeEventStandings("RAW_HIGH", 2, [
        row(1, { rawScore: 90 }),
        row(2, { rawScore: 10, manualRankOverride: 1 }),
        row(3, { rawScore: 50 }),
      ]),
    );
    expect(s.get(2)).toMatchObject({ calculatedRank: 1, basePoints: 20 });
    expect(s.get(1)).toMatchObject({ calculatedRank: 2, basePoints: 16 });
    expect(s.get(3)).toMatchObject({ calculatedRank: 3, basePoints: 14 });
  });

  it("two players locked to rank 2 tie-split ranks 2-3 (15 each)", () => {
    const s = byPlayer(
      computeEventStandings("RAW_HIGH", 2, [
        row(1, { rawScore: 90 }),
        row(2, { rawScore: 10, manualRankOverride: 2 }),
        row(3, { rawScore: 50, manualRankOverride: 2 }),
        row(4, { rawScore: 70 }),
      ]),
    );
    expect(s.get(2)?.basePoints).toBe(15);
    expect(s.get(3)?.basePoints).toBe(15);
    // autos fill the remaining ranks 1 and 4 in metric order
    expect(s.get(1)).toMatchObject({ calculatedRank: 1, basePoints: 20 });
    expect(s.get(4)).toMatchObject({ calculatedRank: 4, basePoints: 12 });
  });

  it("a locked rank beyond the field size still scores from the master table", () => {
    const s = byPlayer(
      computeEventStandings("RAW_HIGH", 2, [
        row(1, { rawScore: 90 }),
        row(2, { rawScore: 80, manualRankOverride: 15 }),
      ]),
    );
    expect(s.get(2)).toMatchObject({ calculatedRank: 15, basePoints: 1 });
    expect(s.get(1)).toMatchObject({ calculatedRank: 1, basePoints: 20 });
  });

  it("ranks beyond 15 score 1 point in a 16-player field", () => {
    const rows = Array.from({ length: 16 }, (_, i) => row(i + 1, { rawScore: 100 - i }));
    const s = byPlayer(computeEventStandings("RAW_HIGH", 2, rows));
    expect(s.get(16)).toMatchObject({ calculatedRank: 16, basePoints: 1 });
    expect(s.get(15)?.basePoints).toBe(1);
    expect(s.get(14)?.basePoints).toBe(2);
  });

  it("handles an empty field and an all-null field", () => {
    expect(computeEventStandings("RAW_HIGH", 2, [])).toEqual([]);
    const s = computeEventStandings("RAW_HIGH", 2, [row(1), row(2)]);
    expect(s.every((x) => x.calculatedRank === null && x.finalEventPoints === 0)).toBe(true);
  });
});

describe("computeEventStandings — ELIMINATION", () => {
  it("alive players beat all eliminated and tie together", () => {
    const s = byPlayer(
      computeEventStandings("ELIMINATION", 1, [
        row(1), // alive
        row(2), // alive
        row(3, { eliminationOrder: 2 }),
        row(4, { eliminationOrder: 1 }),
      ]),
    );
    // alive pair ties ranks 1-2: (20+16)/2 = 18
    expect(s.get(1)?.basePoints).toBe(18);
    expect(s.get(2)?.basePoints).toBe(18);
    expect(s.get(3)).toMatchObject({ calculatedRank: 3, basePoints: 14 });
    expect(s.get(4)).toMatchObject({ calculatedRank: 4, basePoints: 12 });
  });

  it("maps a full elimination positionally (last out ranks highest)", () => {
    const s = byPlayer(
      computeEventStandings("ELIMINATION", 1, [
        row(1, { eliminationOrder: 3 }),
        row(2, { eliminationOrder: 2 }),
        row(3, { eliminationOrder: 1 }),
        row(4), // never eliminated: the winner
      ]),
    );
    expect(s.get(4)).toMatchObject({ calculatedRank: 1, basePoints: 20 });
    expect(s.get(1)).toMatchObject({ calculatedRank: 2, basePoints: 16 });
    expect(s.get(2)).toMatchObject({ calculatedRank: 3, basePoints: 14 });
    expect(s.get(3)).toMatchObject({ calculatedRank: 4, basePoints: 12 });
  });

  it("equal elimination orders tie-split", () => {
    const s = byPlayer(
      computeEventStandings("ELIMINATION", 1, [
        row(1),
        row(2, { eliminationOrder: 5 }),
        row(3, { eliminationOrder: 5 }),
      ]),
    );
    expect(s.get(1)?.calculatedRank).toBe(1);
    // tie at ranks 2-3: (16+14)/2 = 15
    expect(s.get(2)?.basePoints).toBe(15);
    expect(s.get(3)?.basePoints).toBe(15);
  });

  it("gaps in order numbers are harmless (positional, not arithmetic)", () => {
    const s = byPlayer(
      computeEventStandings("ELIMINATION", 1, [
        row(1, { eliminationOrder: 7 }),
        row(2, { eliminationOrder: 3 }),
        row(3),
      ]),
    );
    expect(s.get(3)?.calculatedRank).toBe(1);
    expect(s.get(1)?.calculatedRank).toBe(2);
    expect(s.get(2)?.calculatedRank).toBe(3);
  });
});

describe("computeEventStandings — FRUIT_SPLIT and DANCE_OFF", () => {
  it("ranks fruit by lowest error and reports the computed error", () => {
    const s = byPlayer(
      computeEventStandings("FRUIT_SPLIT", 5, [
        row(10, { weightAGrams: 251.3, weightBGrams: 248.9 }),
        row(12, { weightAGrams: 260, weightBGrams: 240 }),
        row(8, { weightAGrams: 300, weightBGrams: 255 }),
        row(9), // no weigh-in yet
      ]),
    );
    expect(s.get(10)).toMatchObject({ calculatedRank: 1, basePoints: 20, calculatedErrorPct: 0.24 });
    expect(s.get(12)).toMatchObject({ calculatedRank: 2, calculatedErrorPct: 2 });
    expect(s.get(8)).toMatchObject({ calculatedRank: 3, calculatedErrorPct: 4.054 });
    expect(s.get(9)).toMatchObject({ calculatedRank: null, basePoints: 0 });
  });

  it("DANCE_OFF events have no standings", () => {
    expect(computeEventStandings("DANCE_OFF", 7, [row(1), row(2)])).toEqual([]);
  });
});

describe("computeBloodDeltas", () => {
  const d = (round: number, cards: BloodCard[]) => computeBloodDeltas(round, cards);

  it("covers every 1v1 cell at 1x stakes", () => {
    expect(d(1, ["PURE", "PURE"])).toEqual([3, 3]);
    expect(d(1, ["BLOOD", "PURE"])).toEqual([5, -3]);
    expect(d(1, ["PURE", "BLOOD"])).toEqual([-3, 5]);
    expect(d(2, ["BLOOD", "BLOOD"])).toEqual([-2, -2]);
  });

  it("round 3 doubles the stakes", () => {
    expect(d(3, ["BLOOD", "PURE"])).toEqual([10, -6]);
    expect(d(3, ["PURE", "PURE"])).toEqual([6, 6]);
  });

  it("covers the 3-way table by blood count", () => {
    expect(d(1, ["PURE", "PURE", "PURE"])).toEqual([3, 3, 3]);
    expect(d(1, ["BLOOD", "PURE", "PURE"])).toEqual([6, -2, -2]);
    expect(d(1, ["PURE", "BLOOD", "BLOOD"])).toEqual([-4, 1, 1]);
    expect(d(1, ["BLOOD", "BLOOD", "BLOOD"])).toEqual([-3, -3, -3]);
    expect(d(3, ["BLOOD", "PURE", "PURE"])).toEqual([12, -4, -4]);
  });

  it("throws on bad card counts and bad rounds", () => {
    expect(() => d(1, ["PURE"])).toThrow();
    expect(() => d(1, ["PURE", "PURE", "PURE", "PURE"])).toThrow();
    expect(() => d(0, ["PURE", "PURE"])).toThrow();
    expect(() => d(4, ["PURE", "PURE"])).toThrow();
  });
});

describe("rankByTotal", () => {
  it("uses competition ranking (1,2,3,3,5) regardless of input order", () => {
    const ranks = rankByTotal([
      { playerId: 6, total: 32 },
      { playerId: 2, total: 55 },
      { playerId: 8, total: 31 },
      { playerId: 1, total: 54 },
      { playerId: 3, total: 32 },
    ]);
    expect(ranks.get(2)).toBe(1);
    expect(ranks.get(1)).toBe(2);
    expect(ranks.get(6)).toBe(3);
    expect(ranks.get(3)).toBe(3);
    expect(ranks.get(8)).toBe(5);
  });

  it("handles empty input", () => {
    expect(rankByTotal([]).size).toBe(0);
  });
});
