"use client";

/**
 * "Placements" entry mode for the six ranked events: drag tributes (or tap
 * ▲▼) into finishing order, TIE ↑ folds a tribute into the slot above, and
 * SAVE writes one score call setting every tribute's manualRankOverride to its
 * slot's start rank. Points preview exactly what the engine will award.
 */

import { useEffect, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { EventInfo } from "@/lib/types";
import { fmtPts, rankLabel } from "@/lib/format";
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
import styles from "./admin.module.css";
import { useAdmin } from "./shared";
import { ArmButton } from "./ui";

/** Keep the local order in step with roster changes (benched or late tributes). */
function reconcile(
  entries: ReadonlyArray<PlacementEntry>,
  players: ReadonlyArray<{ id: number }>,
): PlacementEntry[] {
  const active = new Set(players.map((p) => p.id));
  const kept = entries.filter((e) => active.has(e.playerId));
  const have = new Set(kept.map((e) => e.playerId));
  const added = players
    .filter((p) => !have.has(p.id))
    .map((p) => ({ playerId: p.id, tiedWithAbove: false }));
  return [...kept, ...added];
}

export default function Placements({ event }: { event: EventInfo }) {
  const { state, mutate, toast } = useAdmin();
  const players = state.players.filter((p) => p.isActive);
  const rows = state.eventResults[String(event.id)] ?? [];

  const [entries, setEntries] = useState<PlacementEntry[]>(() => seedEntries(players, rows));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reseedAt, setReseedAt] = useState<number | null>(null);

  // After a save/clear lands, rebuild the list from the server's rows so what
  // is shown is exactly what is stored.
  useEffect(() => {
    if (reseedAt !== null && state.version >= reseedAt) {
      setEntries(seedEntries(players, rows));
      setReseedAt(null);
    }
    // players/rows derive from state; version is the signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.version, reseedAt]);

  const list = reconcile(entries, players);
  const listIds = new Set(list.map((e) => e.playerId));
  const ranks = entryRanks(list);
  const slotSize = new Map<number, number>();
  for (const slot of toSlots(list)) for (const id of slot) slotSize.set(id, slot.length);
  const standings = projectPlacements(
    event.scoringType,
    event.id,
    list,
    new Map(state.players.map((p) => [p.id, p.jokerEventId])),
    new Map(rows.map((r) => [r.playerId, r.manualPointsOverride])),
  );
  const nameOf = new Map(state.players.map((p) => [p.id, p.name]));
  const jokerOf = new Map(state.players.map((p) => [p.id, p.jokerEventId]));
  // Row-holders outside the active list (benched) who still hold an override
  // would collide with the saved slots — Save and Clear revert them too.
  const strayIds = rows
    .filter((r) => r.manualRankOverride != null && !listIds.has(r.playerId))
    .map((r) => r.playerId);

  const update = (next: PlacementEntry[]) => {
    setEntries(next);
    setDirty(true);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = list.findIndex((e) => e.playerId === active.id);
    const to = list.findIndex((e) => e.playerId === over.id);
    if (from < 0 || to < 0) return;
    update(moveEntry(list, from, to));
  };

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    const r = await mutate(`/api/events/${event.id}/score`, {
      results: placementInputs(list, strayIds),
    });
    setSaving(false);
    if (r.ok) {
      setDirty(false);
      setReseedAt(state.version + 1);
      toast("ok", "Placements locked in");
    }
  };

  const clear = async () => {
    const r = await mutate(`/api/events/${event.id}/score`, {
      results: clearInputs([...listIds, ...strayIds]),
      quiet: true,
    });
    if (r.ok) {
      setDirty(false);
      setReseedAt(state.version + 1);
      toast("ok", "Placements cleared — automatic ranking restored");
    }
  };

  if (players.length === 0) return <p className={styles.muted}>No active tributes.</p>;

  return (
    <div className={styles.stack}>
      <h2 className={styles.sectionTitle}>Placements — {event.name}</h2>
      <DndContext
        id={`placements-${event.id}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={list.map((e) => e.playerId)} strategy={verticalListSortingStrategy}>
          <div className={styles.placeList}>
            {list.map((entry, index) => (
              <PlacementRow
                key={entry.playerId}
                entry={entry}
                index={index}
                count={list.length}
                name={nameOf.get(entry.playerId) ?? `#${entry.playerId}`}
                joker={jokerOf.get(entry.playerId) === event.id}
                rank={ranks.get(entry.playerId) ?? index + 1}
                tied={(slotSize.get(entry.playerId) ?? 1) > 1}
                pts={standings.get(entry.playerId)?.finalEventPoints ?? 0}
                onTie={() => update(toggleTie(list, entry.playerId))}
                onMove={(dir) => update(moveEntry(list, index, index + dir))}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className={styles.saveBar}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGold} ${styles.grow}`}
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? "SAVING…" : "SAVE PLACEMENTS"}
        </button>
        <ArmButton
          label="CLEAR PLACEMENTS"
          armedLabel="TAP AGAIN — BACK TO AUTO"
          className={styles.btnOutlineCrimson}
          onFire={() => void clear()}
        />
      </div>
      <p className={styles.fine}>
        Drag the handle (or tap ▲▼) into finishing order. TIE ↑ shares the slot above; tied
        tributes split the covered ranks&apos; points. Points preview what SAVE will award.
      </p>
    </div>
  );
}

function PlacementRow({
  entry,
  index,
  count,
  name,
  joker,
  rank,
  tied,
  pts,
  onTie,
  onMove,
}: {
  entry: PlacementEntry;
  index: number;
  count: number;
  name: string;
  joker: boolean;
  rank: number;
  tied: boolean;
  pts: number;
  onTie: () => void;
  onMove: (dir: 1 | -1) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.playerId });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${styles.placeRow} ${isDragging ? styles.placeRowDragging : ""}`}
    >
      <div className={styles.placeMain}>
        <button
          type="button"
          ref={setActivatorNodeRef}
          className={`${styles.btn} ${styles.btnSquare} ${styles.dragHandle}`}
          aria-label={`Drag ${name}`}
          {...attributes}
          {...listeners}
        >
          ☰
        </button>
        <span className={styles.placeRank}>{rankLabel(rank, tied)}</span>
        <span className={`${styles.cardName} ${styles.grow}`}>
          {name}
          {joker ? " 🃏" : ""}
        </span>
        <span className={styles.placePts}>{fmtPts(pts)} pts</span>
      </div>
      <div className={styles.placeCtrls}>
        {index > 0 ? (
          <button
            type="button"
            className={`${styles.chip} ${entry.tiedWithAbove ? styles.chipOn : ""}`}
            aria-pressed={entry.tiedWithAbove}
            onClick={onTie}
          >
            {entry.tiedWithAbove ? "TIED ↑" : "TIE ↑"}
          </button>
        ) : (
          <span className={styles.fine}>Top of the order</span>
        )}
        <div className={styles.placeArrows}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSquare}`}
            aria-label={`Move ${name} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            ▲
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSquare}`}
            aria-label={`Move ${name} down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            ▼
          </button>
        </div>
      </div>
    </div>
  );
}
