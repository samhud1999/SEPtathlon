/**
 * Database bootstrap: driver selection, boot-time migration (PRD §7.4), and
 * idempotent seeding. Postgres (postgres-js) when DATABASE_URL is set —
 * required in production; embedded PGlite at ./data/creekos otherwise.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { EVENTS_SEED } from "@/lib/constants";
import { appState, events } from "./schema";

/**
 * One nominal DB type for the whole app. postgres-js and PGlite drizzle
 * instances are structurally identical for the core API we use; the
 * postgres-js instance is cast once, here at the boundary.
 */
export type AppDb = PgliteDatabase<Record<string, never>>;
export type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];
export type DbOrTx = AppDb | Tx;

const MIGRATIONS = { migrationsFolder: join(process.cwd(), "drizzle") };

const g = globalThis as typeof globalThis & { __creekosDb?: Promise<AppDb> };

export async function ensureSeeded(db: DbOrTx): Promise<void> {
  await db
    .insert(events)
    .values(
      EVENTS_SEED.map((e) => ({
        id: e.id,
        slug: e.slug,
        name: e.name,
        sin: e.sin,
        scoringType: e.scoringType,
        status: "UPCOMING",
      })),
    )
    .onConflictDoNothing();
  await db.insert(appState).values({ id: 1 }).onConflictDoNothing();
}

async function init(): Promise<AppDb> {
  const url = process.env.DATABASE_URL?.trim();

  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(url, { max: 5, onnotice: () => {} });
    const db = drizzle(client);
    await migrate(db, MIGRATIONS);
    const app = db as unknown as AppDb;
    await ensureSeeded(app);
    return app;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL is required in production. On Railway, add the Postgres service and a reference variable DATABASE_URL=${{Postgres.DATABASE_URL}} (see README).",
    );
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = join(process.cwd(), "data");
  await mkdir(dataDir, { recursive: true });
  const client = new PGlite(join(dataDir, "creekos"));
  const db = drizzle(client);
  await migrate(db, MIGRATIONS);
  await ensureSeeded(db);
  return db;
}

export function getDb(): Promise<AppDb> {
  if (!g.__creekosDb) g.__creekosDb = init();
  return g.__creekosDb;
}

/** Test hook: inject a database as the process singleton. */
export function _setDb(db: AppDb): void {
  g.__creekosDb = Promise.resolve(db);
}

/** Fresh in-memory PGlite database, migrated and seeded — for tests. */
export async function createTestDb(): Promise<AppDb> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const db = drizzle(new PGlite());
  await migrate(db, MIGRATIONS);
  await ensureSeeded(db);
  return db;
}
