/**
 * CreekOS schema — PRD §2 tables (snake_case) plus lives_remaining,
 * blood created_at, and the app_state / broadcasts / snapshots support tables.
 */

import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
  epithet: varchar("epithet", { length: 100 }).notNull().default("Tribute of the Creek"),
  isActive: boolean("is_active").notNull().default(true),
  jokerEventId: integer("joker_event_id"),
  rockCurseLevel: integer("rock_curse_level").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: integer("id").primaryKey(),
  slug: varchar("slug", { length: 30 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  sin: varchar("sin", { length: 30 }).notNull(),
  scoringType: varchar("scoring_type", { length: 30 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("UPCOMING"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const eventResults = pgTable(
  "event_results",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    rawScore: doublePrecision("raw_score"),
    eliminationOrder: integer("elimination_order"),
    livesRemaining: integer("lives_remaining"),
    weightAGrams: doublePrecision("weight_a_grams"),
    weightBGrams: doublePrecision("weight_b_grams"),
    calculatedErrorPct: doublePrecision("calculated_error_pct"),
    calculatedRank: integer("calculated_rank"),
    manualRankOverride: integer("manual_rank_override"),
    basePoints: doublePrecision("base_points").notNull().default(0),
    jokerApplied: boolean("joker_applied").notNull().default(false),
    manualPointsOverride: doublePrecision("manual_points_override"),
    finalEventPoints: doublePrecision("final_event_points").notNull().default(0),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("event_results_event_player_uq").on(t.eventId, t.playerId)],
);

export const bloodMatchups = pgTable("blood_matchups", {
  id: serial("id").primaryKey(),
  roundNumber: integer("round_number").notNull(),
  matchupType: varchar("matchup_type", { length: 10 }).notNull().default("1V1"),
  playerAId: integer("player_a_id")
    .notNull()
    .references(() => players.id, { onDelete: "cascade" }),
  playerBId: integer("player_b_id")
    .notNull()
    .references(() => players.id, { onDelete: "cascade" }),
  playerCId: integer("player_c_id").references(() => players.id, { onDelete: "cascade" }),
  cardA: varchar("card_a", { length: 10 }),
  cardB: varchar("card_b", { length: 10 }),
  cardC: varchar("card_c", { length: 10 }),
  deltaA: doublePrecision("delta_a").notNull().default(0),
  deltaB: doublePrecision("delta_b").notNull().default(0),
  deltaC: doublePrecision("delta_c").notNull().default(0),
  isRevealed: boolean("is_revealed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const decrees = pgTable("dumbledore_decrees", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id")
    .notNull()
    .references(() => players.id, { onDelete: "cascade" }),
  pointsDelta: doublePrecision("points_delta").notNull(),
  sinTag: varchar("sin_tag", { length: 30 }).notNull(),
  reason: text("reason").notNull(),
  isVoided: boolean("is_voided").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const appState = pgTable("app_state", {
  id: integer("id").primaryKey(),
  tvMode: varchar("tv_mode", { length: 20 }).notNull().default("LEADERBOARD"),
  stateVersion: integer("state_version").notNull().default(0),
  currentRanksJson: text("current_ranks_json").notNull().default("{}"),
  prevRanksJson: text("prev_ranks_json").notNull().default("{}"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const broadcasts = pgTable("broadcasts", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 20 }).notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const snapshots = pgTable("snapshots", {
  id: serial("id").primaryKey(),
  note: varchar("note", { length: 200 }),
  jsonDump: text("json_dump").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
