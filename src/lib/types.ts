/**
 * Shared compile-time contract for CreekOS.
 * `fixtures/sample-state.json` is the normative example of `StatePayload`.
 * Do not edit without orchestrator sign-off — every agent codes against this file.
 */

export type TvMode = "LEADERBOARD" | "LIVE_EVENT" | "BLOOD_STAGE";
export type EventStatus = "UPCOMING" | "NEXT" | "LIVE" | "COMPLETED";
export type ScoringType = "ELIMINATION" | "RAW_HIGH" | "FRUIT_SPLIT" | "BLOOD_MATRIX";
export type BloodCard = "PURE" | "BLOOD";

export interface EventInfo {
  id: number;
  slug: string;
  name: string;
  sin: string;
  scoringType: ScoringType;
  status: EventStatus;
}

export interface PlayerInfo {
  id: number;
  name: string;
  epithet: string;
  isActive: boolean;
  /** 1–6 when the Mortal Sin Joker is placed, null if unused */
  jokerEventId: number | null;
  /** 0 Clean · 1 Off-Hand · 2 Knees · 3 Blind Backwards */
  rockCurseLevel: number;
}

export interface EventResultRow {
  playerId: number;
  rawScore: number | null;
  eliminationOrder: number | null;
  livesRemaining: number | null;
  weightAGrams: number | null;
  weightBGrams: number | null;
  calculatedErrorPct: number | null;
  calculatedRank: number | null;
  manualRankOverride: number | null;
  basePoints: number;
  jokerApplied: boolean;
  manualPointsOverride: number | null;
  finalEventPoints: number;
  notes: string | null;
}

export interface LeaderboardRow {
  playerId: number;
  name: string;
  epithet: string;
  /** competition ranking: ties share a rank, the next rank skips */
  rank: number;
  /** prevRank − rank (positive = climbed); null when no previous ranking exists */
  trend: number | null;
  total: number;
  /** event id ("1"–"6") → finalEventPoints; key absent when the player has no result row */
  eventPoints: Record<string, number>;
  bloodTotal: number;
  decreeTotal: number;
  jokerEventId: number | null;
  rockCurseLevel: number;
}

export interface BloodSeat {
  playerId: number;
  name: string;
  /** a pick is locked in (safe to show as "LOCKED" on TV) */
  cardSet: boolean;
  /** ALWAYS null in the public payload until the matchup is revealed */
  card: BloodCard | null;
  delta: number;
}

export interface BloodMatchupPublic {
  id: number;
  roundNumber: number;
  matchupType: "1V1" | "3WAY";
  isRevealed: boolean;
  /** drives the TV's 90-second standoff countdown */
  createdAt: string;
  updatedAt: string;
  players: BloodSeat[];
}

export interface DecreeRow {
  id: number;
  playerId: number;
  playerName: string;
  pointsDelta: number;
  sinTag: string;
  reason: string;
  isVoided: boolean;
  createdAt: string;
}

export type Broadcast = { id: number; createdAt: string } & (
  | {
      type: "DECREE";
      payload: { playerNames: string[]; pointsDelta: number; sinTag: string; reason: string };
    }
  | {
      type: "EVENT_SCORE";
      payload: { eventId: number; eventName: string; message: string };
    }
  | {
      type: "BLOOD_REVEAL";
      payload: { matchupId: number; roundNumber: number; headline: string; lines: string[] };
    }
  | {
      type: "TV_MODE";
      payload: { mode: TvMode };
    }
);

export type BroadcastType = Broadcast["type"];

export interface StatePayload {
  version: number;
  serverTime: string;
  tvMode: TvMode;
  liveEventId: number | null;
  events: EventInfo[];
  players: PlayerInfo[];
  leaderboard: LeaderboardRow[];
  /** keyed by event id "1"–"6" (never "7"); every key present, possibly [] */
  eventResults: Record<string, EventResultRow[]>;
  blood: { matchups: BloodMatchupPublic[] };
  /** last 20, newest first, voided included + flagged */
  decrees: DecreeRow[];
  /** last 10, ascending id */
  broadcasts: Broadcast[];
}

// ---------------------------------------------------------------------------
// Scoring engine shapes (Task 2)
// ---------------------------------------------------------------------------

export interface StandingInput {
  playerId: number;
  rawScore: number | null;
  eliminationOrder: number | null;
  weightAGrams: number | null;
  weightBGrams: number | null;
  manualRankOverride: number | null;
  manualPointsOverride: number | null;
  /** the player's joker placement (players.joker_event_id), NOT a per-row flag */
  jokerEventId: number | null;
}

export interface Standing {
  playerId: number;
  calculatedErrorPct: number | null;
  calculatedRank: number | null;
  basePoints: number;
  jokerApplied: boolean;
  finalEventPoints: number;
}

// ---------------------------------------------------------------------------
// API input shapes (validated by src/lib/api-schemas.ts)
// ---------------------------------------------------------------------------

/** Omitted field = leave unchanged · explicit null = clear it. */
export interface ScoreInput {
  playerId: number;
  rawScore?: number | null;
  weightAGrams?: number | null;
  weightBGrams?: number | null;
  livesRemaining?: number | null;
  /** assigns the next elimination order (no-op if already eliminated) */
  eliminate?: boolean;
  /** clears elimination order; livesRemaining defaults to 1 if not provided */
  revive?: boolean;
  eliminationOrder?: number | null;
  manualRankOverride?: number | null;
  manualPointsOverride?: number | null;
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// Export / restore (PRD §4 Tab 4)
// ---------------------------------------------------------------------------

export interface PlayerExport extends PlayerInfo {
  createdAt: string;
}

export interface EventResultExport extends EventResultRow {
  eventId: number;
}

export interface BloodMatchupExport {
  id: number;
  roundNumber: number;
  matchupType: "1V1" | "3WAY";
  playerAId: number;
  playerBId: number;
  playerCId: number | null;
  cardA: BloodCard | null;
  cardB: BloodCard | null;
  cardC: BloodCard | null;
  deltaA: number;
  deltaB: number;
  deltaC: number;
  isRevealed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DecreeExport {
  id: number;
  playerId: number;
  pointsDelta: number;
  sinTag: string;
  reason: string;
  isVoided: boolean;
  createdAt: string;
}

export interface ExportShape {
  formatVersion: 1;
  exportedAt: string;
  players: PlayerExport[];
  events: EventInfo[];
  eventResults: EventResultExport[];
  bloodMatchups: BloodMatchupExport[];
  decrees: DecreeExport[];
  appState: {
    tvMode: TvMode;
    stateVersion: number;
    currentRanksJson: string;
    prevRanksJson: string;
  };
}
