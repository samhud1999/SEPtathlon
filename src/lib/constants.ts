import type { BloodCard, EventStatus, ScoringType, TvMode } from "./types";

/** PRD §3.1 — Master Points Lookup (rank → points). */
export const MASTER_POINTS: Readonly<Record<number, number>> = {
  1: 20, 2: 16, 3: 14, 4: 12, 5: 11,
  6: 10, 7: 9, 8: 8, 9: 7, 10: 6,
  11: 5, 12: 4, 13: 3, 14: 2, 15: 1,
};

/** Ranks beyond 15 score 1 (design doc §Decisions.2); rank < 1 scores 0. */
export function pointsForRank(rank: number): number {
  if (!Number.isInteger(rank) || rank < 1) return 0;
  return MASTER_POINTS[rank] ?? 1;
}

export const EVENTS_SEED: ReadonlyArray<{
  id: number;
  slug: string;
  name: string;
  sin: string;
  scoringType: ScoringType;
}> = [
  { id: 1, slug: "stubby-fan", name: "Stubby Fan", sin: "Sloth", scoringType: "ELIMINATION" },
  { id: 2, slug: "krillion", name: "Krillion", sin: "Greed", scoringType: "RAW_HIGH" },
  { id: 3, slug: "weekly-50", name: "The Weekly 50", sin: "Pride", scoringType: "RAW_HIGH" },
  { id: 4, slug: "rock-hurl", name: "Rock Hurl", sin: "Wrath", scoringType: "ELIMINATION" },
  { id: 5, slug: "fruit-split", name: "50/50 Fruit Split", sin: "Envy", scoringType: "FRUIT_SPLIT" },
  { id: 6, slug: "grape-bobbing", name: "Grape Bobbing", sin: "Gluttony", scoringType: "RAW_HIGH" },
  { id: 7, slug: "blood-on-the-creek", name: "Blood on the Creek", sin: "Lust", scoringType: "BLOOD_MATRIX" },
];

export const SIN_TAGS: readonly string[] = [
  "Sloth", "Greed", "Pride", "Wrath", "Envy", "Gluttony", "Lust", "Blessing of the Creek",
];

/** Index = players.rock_curse_level (0–3). */
export const CURSE_LEVELS = ["Clean", "Off-Hand", "Knees", "Blind Backwards"] as const;

export const TV_MODES = ["LEADERBOARD", "LIVE_EVENT", "BLOOD_STAGE"] as const satisfies readonly TvMode[];
export const EVENT_STATUSES = ["UPCOMING", "NEXT", "LIVE", "COMPLETED"] as const satisfies readonly EventStatus[];
export const SCORING_TYPES = ["ELIMINATION", "RAW_HIGH", "FRUIT_SPLIT", "BLOOD_MATRIX"] as const satisfies readonly ScoringType[];
export const BLOOD_CARDS = ["PURE", "BLOOD"] as const satisfies readonly BloodCard[];

/**
 * Blood on the Creek payoff matrix (design doc §Decisions.1 — PRD leaves the
 * values open; every delta remains editable per-matchup in admin).
 * Key `${cardA}|${cardB}` → [deltaA, deltaB] at 1× stakes.
 */
export const BLOOD_MATRIX_1V1: Readonly<Record<string, readonly [number, number]>> = {
  "PURE|PURE": [3, 3],
  "BLOOD|PURE": [5, -3],
  "PURE|BLOOD": [-3, 5],
  "BLOOD|BLOOD": [-2, -2],
};

/** 3-way standoff: payoff by how many of the three drew BLOOD, at 1× stakes. */
export const BLOOD_3WAY: Readonly<Record<number, { blood: number; pure: number }>> = {
  0: { blood: 0, pure: 3 },
  1: { blood: 6, pure: -2 },
  2: { blood: 1, pure: -4 },
  3: { blood: -3, pure: 0 },
};

/** PRD §2: Round 3 = 2× stakes. */
export const ROUND_STAKES: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2 };

export const DEFAULT_LIVES = 3;
export const MAX_LIVES = 9;
export const MAX_CURSE_LEVEL = 3;

export const ADMIN_COOKIE = "creekos_admin";

export const DECREES_IN_STATE = 20;
export const BROADCASTS_IN_STATE = 10;
export const BROADCAST_KEEP = 50;
export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
export const SNAPSHOT_KEEP = 48;
