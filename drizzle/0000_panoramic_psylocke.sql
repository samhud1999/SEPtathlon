CREATE TABLE "app_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"tv_mode" varchar(20) DEFAULT 'LEADERBOARD' NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"current_ranks_json" text DEFAULT '{}' NOT NULL,
	"prev_ranks_json" text DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blood_matchups" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_number" integer NOT NULL,
	"matchup_type" varchar(10) DEFAULT '1V1' NOT NULL,
	"player_a_id" integer NOT NULL,
	"player_b_id" integer NOT NULL,
	"player_c_id" integer,
	"card_a" varchar(10),
	"card_b" varchar(10),
	"card_c" varchar(10),
	"delta_a" double precision DEFAULT 0 NOT NULL,
	"delta_b" double precision DEFAULT 0 NOT NULL,
	"delta_c" double precision DEFAULT 0 NOT NULL,
	"is_revealed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(20) NOT NULL,
	"payload_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dumbledore_decrees" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"points_delta" double precision NOT NULL,
	"sin_tag" varchar(30) NOT NULL,
	"reason" text NOT NULL,
	"is_voided" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"raw_score" double precision,
	"elimination_order" integer,
	"lives_remaining" integer,
	"weight_a_grams" double precision,
	"weight_b_grams" double precision,
	"calculated_error_pct" double precision,
	"calculated_rank" integer,
	"manual_rank_override" integer,
	"base_points" double precision DEFAULT 0 NOT NULL,
	"joker_applied" boolean DEFAULT false NOT NULL,
	"manual_points_override" double precision,
	"final_event_points" double precision DEFAULT 0 NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" integer PRIMARY KEY NOT NULL,
	"slug" varchar(30) NOT NULL,
	"name" varchar(100) NOT NULL,
	"sin" varchar(30) NOT NULL,
	"scoring_type" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'UPCOMING' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"epithet" varchar(100) DEFAULT 'Tribute of the Creek' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"joker_event_id" integer,
	"rock_curse_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"note" varchar(200),
	"json_dump" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blood_matchups" ADD CONSTRAINT "blood_matchups_player_a_id_players_id_fk" FOREIGN KEY ("player_a_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_matchups" ADD CONSTRAINT "blood_matchups_player_b_id_players_id_fk" FOREIGN KEY ("player_b_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_matchups" ADD CONSTRAINT "blood_matchups_player_c_id_players_id_fk" FOREIGN KEY ("player_c_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dumbledore_decrees" ADD CONSTRAINT "dumbledore_decrees_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_results" ADD CONSTRAINT "event_results_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_results" ADD CONSTRAINT "event_results_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_results_event_player_uq" ON "event_results" USING btree ("event_id","player_id");