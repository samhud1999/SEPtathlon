import { describe, expect, it } from "vitest";
import {
  clearInputs,
  entryRanks,
  moveEntry,
  placementInputs,
  projectPlacements,
  seedEntries,
  toSlots,
  toggleTie,
  type PlacementEntry,
} from "@/lib/placements";
import type { EventResultRow } from "@/lib/types";

const e = (playerId: number, tiedWithAbove = false): PlacementEntry => ({ playerId, tiedWithAbove });
const row = (playerId: number, p: Partial<EventResultRow> = {}): EventResultRow => ({
  playerId,
  rawScore: null,
  eliminationOrder: null,
  livesRemaining: null,
  weightAGrams: null,
  weightBGrams: null,
  calculatedErrorPct: null,
  calculatedRank: null,
  manualRankOverride: null,
  basePoints: 0,
  jokerApplied: false,
  manualPointsOverride: null,
  finalEventPoints: 0,
  notes: null,
  ...p,
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

  it("moving an entry unties it and keeps everyone else", () => {
    expect(moveEntry([e(1), e(2, true), e(3)], 2, 0)).toEqual([e(3), e(1), e(2, true)]);
    expect(moveEntry([e(1), e(2, true), e(3)], 1, 2)).toEqual([e(1), e(3), e(2)]);
    const same = [e(1), e(2)];
    expect(moveEntry(same, 1, 1)).toEqual(same);
  });
});

describe("placements — seeding from rows", () => {
  it("orders by calculatedRank, unranked last in roster order, and restores saved ties", () => {
    const players = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const rows = [
      row(1, { calculatedRank: 2, manualRankOverride: 1 }),
      row(2, { calculatedRank: 1, manualRankOverride: 1 }),
      row(4, { calculatedRank: 3 }),
    ];
    expect(seedEntries(players, rows)).toEqual([e(2), e(1, true), e(4), e(3)]);
  });

  it("ignores rows for players not listed; players with no row sit at the end", () => {
    expect(seedEntries([{ id: 7 }, { id: 8 }], [row(99, { calculatedRank: 1 })])).toEqual([e(7), e(8)]);
  });
});

describe("placements — save bodies and projection", () => {
  it("Save sets each tribute's override to its slot rank and nulls stray ids", () => {
    expect(placementInputs([e(1), e(2, true), e(3)], [42])).toEqual([
      { playerId: 1, manualRankOverride: 1 },
      { playerId: 2, manualRankOverride: 1 },
      { playerId: 3, manualRankOverride: 3 },
      { playerId: 42, manualRankOverride: null },
    ]);
    expect(clearInputs([1, 2])).toEqual([
      { playerId: 1, manualRankOverride: null },
      { playerId: 2, manualRankOverride: null },
    ]);
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
