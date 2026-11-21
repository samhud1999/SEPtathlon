/**
 * Export / restore / snapshots (PRD §4 Tab 4). Restore validates BEFORE it
 * touches anything, snapshots the current state, then swaps atomically.
 */

import { desc, eq, sql } from "drizzle-orm";
import { ExportShapeSchema } from "@/lib/api-schemas";
import type { ExportShape, StatePayload } from "@/lib/types";
import { badRequest, buildDump, insertSnapshot, mutate, notFound, RepoError } from "./core";
import { ensureSeeded, getDb } from "./index";
import {
  appState,
  bloodMatchups,
  broadcasts,
  decrees,
  eventResults,
  events,
  players,
  snapshots,
} from "./schema";
import { getStatePayload } from "./state";

export async function exportDump(): Promise<ExportShape> {
  return buildDump(await getDb());
}

const SERIAL_TABLES = [
  "players",
  "event_results",
  "blood_matchups",
  "dumbledore_decrees",
  "broadcasts",
] as const;

export async function restoreDump(dump: unknown): Promise<StatePayload> {
  const parsed = ExportShapeSchema.safeParse(dump);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RepoError(
      `Not a valid CreekOS export: ${issue ? `${issue.path.join(".")} — ${issue.message}` : "unknown"}`,
      400,
    );
  }
  const data = parsed.data;

  await mutate(async (tx) => {
    await insertSnapshot(tx, "pre-restore");

    await tx.delete(broadcasts);
    await tx.delete(decrees);
    await tx.delete(bloodMatchups);
    await tx.delete(eventResults);
    await tx.delete(players);
    await tx.delete(events);

    if (data.events.length > 0) {
      await tx.insert(events).values(
        data.events.map((e) => ({ ...e, updatedAt: new Date() })),
      );
    }
    // Events are canon: a legacy dump's "Blood on the Creek" comes back as the dance-off.
    await ensureSeeded(tx);
    if (data.players.length > 0) {
      await tx.insert(players).values(
        data.players.map((p) => ({
          id: p.id,
          name: p.name,
          epithet: p.epithet,
          isActive: p.isActive,
          jokerEventId: p.jokerEventId,
          rockCurseLevel: p.rockCurseLevel,
          createdAt: new Date(p.createdAt),
        })),
      );
    }
    if (data.eventResults.length > 0) {
      await tx.insert(eventResults).values(
        data.eventResults.map((r) => ({ ...r, updatedAt: new Date() })),
      );
    }
    if (data.bloodMatchups.length > 0) {
      await tx.insert(bloodMatchups).values(
        data.bloodMatchups.map((m) => ({
          ...m,
          createdAt: new Date(m.createdAt),
          updatedAt: new Date(m.updatedAt),
        })),
      );
    }
    if (data.decrees.length > 0) {
      await tx.insert(decrees).values(
        data.decrees.map((d) => ({ ...d, createdAt: new Date(d.createdAt) })),
      );
    }

    await tx
      .update(appState)
      .set({
        tvMode: data.appState.tvMode,
        stateVersion: data.appState.stateVersion,
        currentRanksJson: data.appState.currentRanksJson,
        prevRanksJson: data.appState.prevRanksJson,
        updatedAt: new Date(),
      })
      .where(eq(appState.id, 1));

    for (const table of SERIAL_TABLES) {
      await tx.execute(
        sql.raw(
          `SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE((SELECT MAX(id)+1 FROM ${table}), 1), false)`,
        ),
      );
    }
  });

  return getStatePayload();
}

export async function listSnapshots(): Promise<
  Array<{ id: number; note: string | null; createdAt: string; bytes: number }>
> {
  const db = await getDb();
  const rows = await db
    .select({
      id: snapshots.id,
      note: snapshots.note,
      createdAt: snapshots.createdAt,
      bytes: sql<number>`length(${snapshots.jsonDump})`,
    })
    .from(snapshots)
    .orderBy(desc(snapshots.id));
  return rows.map((r) => ({
    id: r.id,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    bytes: Number(r.bytes),
  }));
}

/** Manual snapshot — does not bump the state version. */
export async function createSnapshot(note?: string): Promise<StatePayload> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await insertSnapshot(tx, note?.trim() ? note.trim() : "manual");
  });
  return getStatePayload();
}

export async function getSnapshotJson(id: number): Promise<string> {
  const db = await getDb();
  const [row] = await db.select().from(snapshots).where(eq(snapshots.id, id));
  if (!row) throw notFound(`Snapshot ${id}`);
  return row.jsonDump;
}

export async function restoreSnapshot(id: number): Promise<StatePayload> {
  const json = await getSnapshotJson(id);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw badRequest("Snapshot is corrupted");
  }
  return restoreDump(parsed);
}
