import { describe, expect, it } from "vitest";
import { duoNames, duoScore } from "@/lib/dance";
import type { BloodMatchupPublic } from "@/lib/types";

const base = { id: 1, roundNumber: 1, matchupType: "1V1" as const, createdAt: "", updatedAt: "" };
const seat = (playerId: number, name: string, delta: number) => ({ playerId, name, delta });

describe("dance helpers", () => {
  it("an unscored duo has no score and a scored one reads seat A's delta", () => {
    const unscored: BloodMatchupPublic = { ...base, isRevealed: false, players: [seat(1, "Davo", 0), seat(2, "Gazza", 0)] };
    const scored: BloodMatchupPublic = { ...base, isRevealed: true, players: [seat(1, "Davo", 7.5), seat(2, "Gazza", 7.5)] };
    expect(duoScore(unscored)).toBeNull();
    expect(duoScore(scored)).toBe(7.5);
  });

  it("joins names with & (and a comma for a trio)", () => {
    expect(duoNames({ ...base, isRevealed: false, players: [seat(1, "Davo", 0), seat(2, "Gazza", 0)] })).toBe("Davo & Gazza");
    expect(
      duoNames({
        ...base,
        matchupType: "3WAY",
        isRevealed: false,
        players: [seat(1, "Davo", 0), seat(2, "Gazza", 0), seat(3, "Spud", 0)],
      }),
    ).toBe("Davo, Gazza & Spud");
  });
});
