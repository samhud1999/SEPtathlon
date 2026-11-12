"use client";

/**
 * God-mode amendment grid (events 1–6): one card per active player (plus
 * inactive players who already hold a result row). Local drafts; SAVE
 * AMENDMENTS posts ONE score call with every dirty row; an emptied field
 * sends an explicit null (clear, per contract).
 */

import { useState, type ReactNode } from "react";
import type { EventInfo, EventResultRow, PlayerInfo, ScoreInput } from "@/lib/types";
import { fmtPts } from "@/lib/format";
import styles from "./admin.module.css";
import { parseNum, useAdmin } from "./shared";

interface Draft {
  raw?: string;
  wa?: string;
  wb?: string;
  order?: string;
  ovrRank?: string;
  ovrPts?: string;
  notes?: string;
}

type DraftKey = keyof Draft;

const numText = (v: number | null | undefined): string => (v == null ? "" : String(v));

export default function GodModeTable({ event }: { event: EventInfo }) {
  const { state, mutate, toast } = useAdmin();
  const rows = state.eventResults[String(event.id)] ?? [];
  const rowOf = new Map(rows.map((r) => [r.playerId, r]));

  const players: PlayerInfo[] = [
    ...state.players.filter((p) => p.isActive),
    ...state.players.filter((p) => !p.isActive && rowOf.has(p.id)),
  ];

  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [saving, setSaving] = useState(false);

  const baseline = (playerId: number, key: DraftKey): string => {
    const row = rowOf.get(playerId);
    switch (key) {
      case "raw":
        return numText(row?.rawScore);
      case "wa":
        return numText(row?.weightAGrams);
      case "wb":
        return numText(row?.weightBGrams);
      case "order":
        return numText(row?.eliminationOrder);
      case "ovrRank":
        return numText(row?.manualRankOverride);
      case "ovrPts":
        return numText(row?.manualPointsOverride);
      case "notes":
        return row?.notes ?? "";
    }
  };

  const textOf = (playerId: number, key: DraftKey): string =>
    drafts[playerId]?.[key] ?? baseline(playerId, key);

  const isDirty = (playerId: number, key: DraftKey): boolean => {
    const d = drafts[playerId]?.[key];
    return d !== undefined && d !== baseline(playerId, key);
  };

  const setField = (playerId: number, key: DraftKey, value: string) =>
    setDrafts((prev) => ({ ...prev, [playerId]: { ...prev[playerId], [key]: value } }));

  const dirtyCount = players.filter((p) =>
    (Object.keys(drafts[p.id] ?? {}) as DraftKey[]).some((k) => isDirty(p.id, k)),
  ).length;

  /** Build ONE score call from every dirty row, or return a human error. */
  const buildResults = (): { results: ScoreInput[] } | { error: string } => {
    const results: ScoreInput[] = [];
    for (const p of players) {
      const d = drafts[p.id];
      if (!d) continue;
      const row = rowOf.get(p.id);
      const input: ScoreInput = { playerId: p.id };
      let dirty = false;

      const numField = (
        text: string | undefined,
        current: number | null,
        assign: (v: number | null) => void,
        rule: { label: string; int?: boolean; min?: number },
      ): string | null => {
        if (text === undefined) return null;
        const v = parseNum(text);
        if (v === undefined) return `${p.name}: ${rule.label} must be a number`;
        if (v !== null) {
          if (rule.int && !Number.isInteger(v)) return `${p.name}: ${rule.label} must be a whole number`;
          if (rule.min !== undefined && v < rule.min)
            return `${p.name}: ${rule.label} must be ≥ ${rule.min}`;
        }
        if (v !== current) {
          assign(v);
          dirty = true;
        }
        return null;
      };

      const errors = [
        numField(d.raw, row?.rawScore ?? null, (v) => (input.rawScore = v), {
          label: "raw score",
          min: 0,
        }),
        numField(d.wa, row?.weightAGrams ?? null, (v) => (input.weightAGrams = v), {
          label: "half A",
          min: 0,
        }),
        numField(d.wb, row?.weightBGrams ?? null, (v) => (input.weightBGrams = v), {
          label: "half B",
          min: 0,
        }),
        numField(d.order, row?.eliminationOrder ?? null, (v) => (input.eliminationOrder = v), {
          label: "elimination order",
          int: true,
          min: 1,
        }),
        numField(d.ovrRank, row?.manualRankOverride ?? null, (v) => (input.manualRankOverride = v), {
          label: "rank override",
          int: true,
          min: 1,
        }),
        numField(d.ovrPts, row?.manualPointsOverride ?? null, (v) => (input.manualPointsOverride = v), {
          label: "points override",
        }),
      ].filter((e): e is string => e !== null);
      const firstError = errors[0];
      if (firstError !== undefined) return { error: firstError };

      if (d.notes !== undefined) {
        const v = d.notes.trim() === "" ? null : d.notes;
        if (v !== (row?.notes ?? null)) {
          input.notes = v;
          dirty = true;
        }
      }

      if (dirty) results.push(input);
    }
    if (results.length === 0) return { error: "Nothing changed" };
    return { results };
  };

  const save = async () => {
    const built = buildResults();
    if ("error" in built) {
      toast("error", built.error);
      return;
    }
    setSaving(true);
    const r = await mutate(`/api/events/${event.id}/score`, built);
    setSaving(false);
    if (r.ok) {
      setDrafts({});
      toast("ok", "⚖ Recalculated — the ledger stands amended");
    }
  };

  const godInput = (
    p: PlayerInfo,
    key: DraftKey,
    label: string,
    inputMode: "decimal" | "numeric",
  ) => (
    <GField label={label}>
      <input
        className={`${styles.input} ${styles.numInput} ${isDirty(p.id, key) ? styles.dirty : ""}`}
        inputMode={inputMode}
        placeholder="—"
        aria-label={`${p.name} ${label}`}
        value={textOf(p.id, key)}
        onChange={(e) => setField(p.id, key, e.target.value)}
      />
    </GField>
  );

  return (
    <div className={styles.stack}>
      <h2 className={styles.sectionTitle}>God-mode — amend E{event.id} ledger</h2>
      <p className={styles.fine}>
        Edit any cell, then SAVE AMENDMENTS commits them in one stroke. Emptying a field clears the
        stored value.
      </p>
      {players.map((p) => {
        const row: EventResultRow | undefined = rowOf.get(p.id);
        const jokerHere = row?.jokerApplied === true || p.jokerEventId === event.id;
        return (
          <div key={p.id} className={`${styles.playerCard} ${p.isActive ? "" : styles.cardDim}`}>
            <div className={styles.row}>
              <span className={styles.cardName}>
                {p.name}
                {p.isActive ? "" : " (benched)"}
              </span>
              {jokerHere ? <span className={styles.matchTag}>🃏 JOKER ×2</span> : null}
            </div>
            <div className={styles.godGrid}>
              {event.scoringType === "FRUIT_SPLIT" ? (
                <>
                  {godInput(p, "wa", "Half A (g)", "decimal")}
                  {godInput(p, "wb", "Half B (g)", "decimal")}
                </>
              ) : event.scoringType === "ELIMINATION" ? (
                godInput(p, "order", "Elim order", "numeric")
              ) : (
                godInput(p, "raw", "Raw score", "decimal")
              )}
              <GField label="Auto rank">
                <div className={styles.godRead}>{row?.calculatedRank ?? "—"}</div>
              </GField>
              {godInput(p, "ovrRank", "Ovr rank", "numeric")}
              <GField label="Auto pts">
                <div className={styles.godRead}>{row ? fmtPts(row.basePoints) : "—"}</div>
              </GField>
              {godInput(p, "ovrPts", "Ovr pts", "decimal")}
              <GField label="Final pts">
                <div className={styles.godRead}>{row ? fmtPts(row.finalEventPoints) : "—"}</div>
              </GField>
            </div>
            <GField label="Notes">
              <input
                className={`${styles.input} ${isDirty(p.id, "notes") ? styles.dirty : ""}`}
                maxLength={500}
                placeholder="—"
                aria-label={`${p.name} notes`}
                value={textOf(p.id, "notes")}
                onChange={(e) => setField(p.id, "notes", e.target.value)}
              />
            </GField>
          </div>
        );
      })}
      {players.length === 0 ? <p className={styles.muted}>No tributes to amend.</p> : null}

      <div className={styles.saveBar}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGold} ${styles.btnBig}`}
          disabled={dirtyCount === 0 || saving}
          onClick={() => void save()}
        >
          {saving ? "AMENDING…" : `⚖ SAVE AMENDMENTS${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`}
        </button>
      </div>
    </div>
  );
}

function GField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.godField}>
      <span className={styles.godLabel}>{label}</span>
      {children}
    </div>
  );
}
