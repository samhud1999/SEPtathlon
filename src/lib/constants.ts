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
  { id: 7, slug: "dance-on-the-creek", name: "Dance on the Creek", sin: "Lust", scoringType: "DANCE_OFF" },
];

export const SIN_TAGS: readonly string[] = [
  "Sloth", "Greed", "Pride", "Wrath", "Envy", "Gluttony", "Lust", "Blessing of the Creek",
];

/** Index = players.rock_curse_level (0–3). */
export const CURSE_LEVELS = ["Clean", "Off-Hand", "Knees", "Blind Backwards"] as const;

export const TV_MODES = ["LEADERBOARD", "LIVE_EVENT", "BLOOD_STAGE"] as const satisfies readonly TvMode[];
export const EVENT_STATUSES = ["UPCOMING", "NEXT", "LIVE", "COMPLETED"] as const satisfies readonly EventStatus[];
export const SCORING_TYPES = ["ELIMINATION", "RAW_HIGH", "FRUIT_SPLIT", "DANCE_OFF"] as const satisfies readonly ScoringType[];
/** Vestigial — only the export/restore schema still reads the card columns. */
export const BLOOD_CARDS = ["PURE", "BLOOD"] as const satisfies readonly BloodCard[];

/** Dance on the Creek: every duo is scored out of this. */
export const DANCE_MAX_SCORE = 10;

export const DEFAULT_LIVES = 3;
export const MAX_LIVES = 9;
export const MAX_CURSE_LEVEL = 3;

export const ADMIN_COOKIE = "creekos_admin";

export const DECREES_IN_STATE = 20;
export const BROADCASTS_IN_STATE = 10;
export const BROADCAST_KEEP = 50;
export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
export const SNAPSHOT_KEEP = 48;
