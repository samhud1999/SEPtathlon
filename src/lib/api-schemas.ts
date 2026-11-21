import { z } from "zod";
import {
  BLOOD_CARDS,
  DANCE_MAX_SCORE,
  EVENT_STATUSES,
  MAX_CURSE_LEVEL,
  MAX_LIVES,
  SCORING_TYPES,
  TV_MODES,
} from "./constants";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const id = z.number().int().positive();
const playerName = z.string().trim().min(1).max(50);
const epithet = z.string().trim().min(1).max(100);
const sinTag = z.string().trim().min(1).max(30);
const reason = z.string().trim().min(1).max(300);
const notes = z.string().max(500);
const nonNegative = z.number().finite().min(0);

export const LoginBody = z.object({ pin: z.string().trim().min(1).max(32) });

// ---------------------------------------------------------------------------
// Players (PRD §4 Tab 3)
// ---------------------------------------------------------------------------

export const PlayerActionBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: playerName,
    epithet: epithet.optional(),
  }),
  z.object({
    action: z.literal("update"),
    playerId: id,
    name: playerName.optional(),
    epithet: epithet.optional(),
    isActive: z.boolean().optional(),
    rockCurseLevel: z.number().int().min(0).max(MAX_CURSE_LEVEL).optional(),
  }),
]);

// ---------------------------------------------------------------------------
// Scores (PRD §4 Tab 2 — omitted = unchanged, null = clear)
// ---------------------------------------------------------------------------

export const ScoreInputSchema = z.object({
  playerId: id,
  rawScore: nonNegative.nullish(),
  weightAGrams: nonNegative.nullish(),
  weightBGrams: nonNegative.nullish(),
  livesRemaining: z.number().int().min(0).max(MAX_LIVES).nullish(),
  eliminate: z.boolean().optional(),
  revive: z.boolean().optional(),
  eliminationOrder: z.number().int().min(1).nullish(),
  manualRankOverride: z.number().int().min(1).nullish(),
  manualPointsOverride: z.number().finite().nullish(),
  notes: notes.nullish(),
});

export const ScoreBody = z.object({
  results: z.array(ScoreInputSchema).min(1).max(50),
  quiet: z.boolean().optional(),
});

export const PreviewBody = z.object({
  results: z.array(ScoreInputSchema).min(1).max(50),
});

export const EventStatusBody = z.object({ status: z.enum(EVENT_STATUSES) });

export const JokerBody = z.object({
  playerId: id,
  active: z.boolean(),
  force: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Decrees (PRD §4 Tab 1)
// ---------------------------------------------------------------------------

export const DecreeCreateBody = z.object({
  playerIds: z.array(id).min(1).max(30),
  pointsDelta: z
    .number()
    .finite()
    .refine((n) => n !== 0, { message: "A decree must move points" }),
  sinTag,
  reason,
});

export const DecreePatchBody = z
  .object({
    playerId: id.optional(),
    pointsDelta: z
      .number()
      .finite()
      .refine((n) => n !== 0, { message: "A decree must move points" })
      .optional(),
    sinTag: sinTag.optional(),
    reason: reason.optional(),
    isVoided: z.boolean().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "Empty patch" });

// ---------------------------------------------------------------------------
// Dance on the Creek (event 7) — duos live in blood_matchups, routes /api/blood/*
// ---------------------------------------------------------------------------

const roundNumber = z.number().int().min(1).max(3);

export const BloodGenerateBody = z.object({ roundNumber });

export const BloodCreateBody = z.object({
  roundNumber,
  playerIds: z.array(id).min(2).max(3),
});

/** A duo's score out of 10 (decimals allowed); null clears it. */
export const BloodPatchBody = z.object({
  score: z.number().finite().min(0).max(DANCE_MAX_SCORE).nullable(),
});

// ---------------------------------------------------------------------------
// TV + system (PRD §4 Tab 4)
// ---------------------------------------------------------------------------

export const TvModeBody = z.object({ mode: z.enum(TV_MODES) });

export const SnapshotCreateBody = z.object({ note: z.string().trim().max(200).optional() });

export const ConfirmRestore = z.object({ confirm: z.literal("RESTORE") });

// ---------------------------------------------------------------------------
// Export / restore — the dump is validated BEFORE anything is touched
// ---------------------------------------------------------------------------

const isoDate = z.string().min(1);

const playerExport = z.object({
  id,
  name: playerName,
  epithet: z.string().max(100),
  isActive: z.boolean(),
  jokerEventId: z.number().int().nullable(),
  rockCurseLevel: z.number().int().min(0).max(MAX_CURSE_LEVEL),
  createdAt: isoDate,
});

/** Pre-dance exports call event 7 BLOOD_MATRIX; they restore as DANCE_OFF. */
const LEGACY_SCORING_TYPES = [...SCORING_TYPES, "BLOOD_MATRIX"] as const;

const eventExport = z.object({
  id,
  slug: z.string().max(30),
  name: z.string().max(100),
  sin: z.string().max(30),
  scoringType: z
    .enum(LEGACY_SCORING_TYPES)
    .transform((v) => (v === "BLOOD_MATRIX" ? "DANCE_OFF" : v)),
  status: z.enum(EVENT_STATUSES),
});

const eventResultExport = z.object({
  eventId: id,
  playerId: id,
  rawScore: z.number().nullable(),
  eliminationOrder: z.number().int().nullable(),
  livesRemaining: z.number().int().nullable(),
  weightAGrams: z.number().nullable(),
  weightBGrams: z.number().nullable(),
  calculatedErrorPct: z.number().nullable(),
  calculatedRank: z.number().int().nullable(),
  manualRankOverride: z.number().int().nullable(),
  basePoints: z.number(),
  jokerApplied: z.boolean(),
  manualPointsOverride: z.number().nullable(),
  finalEventPoints: z.number(),
  notes: z.string().nullable(),
});

const bloodMatchupExport = z.object({
  id,
  roundNumber,
  matchupType: z.enum(["1V1", "3WAY"]),
  playerAId: id,
  playerBId: id,
  playerCId: z.number().int().nullable(),
  cardA: z.enum(BLOOD_CARDS).nullable(),
  cardB: z.enum(BLOOD_CARDS).nullable(),
  cardC: z.enum(BLOOD_CARDS).nullable(),
  deltaA: z.number(),
  deltaB: z.number(),
  deltaC: z.number(),
  isRevealed: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

const decreeExport = z.object({
  id,
  playerId: id,
  pointsDelta: z.number(),
  sinTag: z.string().max(30),
  reason: z.string(),
  isVoided: z.boolean(),
  createdAt: isoDate,
});

export const ExportShapeSchema = z.object({
  formatVersion: z.literal(1),
  exportedAt: isoDate,
  players: z.array(playerExport),
  events: z.array(eventExport),
  eventResults: z.array(eventResultExport),
  bloodMatchups: z.array(bloodMatchupExport),
  decrees: z.array(decreeExport),
  appState: z.object({
    tvMode: z.enum(TV_MODES),
    stateVersion: z.number().int().min(0),
    currentRanksJson: z.string(),
    prevRanksJson: z.string(),
  }),
});

export const RestoreBody = z.object({
  confirm: z.literal("RESTORE"),
  dump: ExportShapeSchema,
});
