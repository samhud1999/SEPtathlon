"use client";

/**
 * Guided mode for E5 — 50/50 Fruit Split: Half A / Half B gram inputs that
 * commit together on blur, live error % + rank from state, clubhouse leader
 * highlighted.
 */

import { useState, type FocusEvent } from "react";
import type { EventInfo } from "@/lib/types";
import { fmtErrPct, fmtPts, rankLabel } from "@/lib/format";
import styles from "./admin.module.css";
import { parseNum, tiedRanks, useAdmin } from "./shared";
import { Avatar } from "./ui";

interface FruitDraft {
  a?: string;
  b?: string;
}

export default function GuidedFruit({ event }: { event: EventInfo }) {
  const { state, mutate, toast } = useAdmin();
  const players = state.players.filter((p) => p.isActive);
  const rows = state.eventResults[String(event.id)] ?? [];
  const rowOf = new Map(rows.map((r) => [r.playerId, r]));
  const tied = tiedRanks(rows.map((r) => r.calculatedRank));

  const [drafts, setDrafts] = useState<Record<number, FruitDraft>>({});

  const stateText = (playerId: number, side: "a" | "b"): string => {
    const row = rowOf.get(playerId);
    const v = side === "a" ? row?.weightAGrams : row?.weightBGrams;
    return v == null ? "" : String(v);
  };
  const textOf = (playerId: number, side: "a" | "b"): string =>
    drafts[playerId]?.[side] ?? stateText(playerId, side);
  const setDraft = (playerId: number, side: "a" | "b", text: string) =>
    setDrafts((prev) => ({ ...prev, [playerId]: { ...prev[playerId], [side]: text } }));
  const clearDraft = (playerId: number) =>
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[playerId];
      return next;
    });

  /** Commit both halves together once focus leaves the row. */
  const commit = async (playerId: number, e: FocusEvent<HTMLInputElement>) => {
    // Still inside the same row (A → B)? Wait for the second blur.
    const to = e.relatedTarget;
    if (to instanceof HTMLElement && to.dataset["fruitRow"] === String(playerId)) return;
    const d = drafts[playerId];
    if (!d) return;
    const a = parseNum(textOf(playerId, "a"));
    const b = parseNum(textOf(playerId, "b"));
    if (a === undefined || b === undefined || (a !== null && a < 0) || (b !== null && b < 0)) {
      toast("error", "Weights must be numbers ≥ 0");
      return;
    }
    const row = rowOf.get(playerId);
    if (a === (row?.weightAGrams ?? null) && b === (row?.weightBGrams ?? null)) {
      clearDraft(playerId);
      return;
    }
    // quiet: weigh-ins trickle in; the COMPLETED status change banners instead.
    const r = await mutate(`/api/events/${event.id}/score`, {
      results: [{ playerId, weightAGrams: a, weightBGrams: b }],
      quiet: true,
    });
    if (r.ok) clearDraft(playerId);
  };

  return (
    <div className={styles.stack}>
      <h2 className={styles.sectionTitle}>Weigh-ins — {event.name}</h2>
      {players.map((p) => {
        const row = rowOf.get(p.id);
        const isLeader = row?.calculatedRank === 1;
        const dirty = drafts[p.id] !== undefined;
        return (
          <div key={p.id} className={`${styles.playerCard} ${isLeader ? styles.leaderCard : ""}`}>
            <div className={styles.row}>
              <Avatar name={p.name} size={40} />
              <span className={styles.cardName}>{p.name}</span>
              {isLeader ? <span className={styles.leaderTag}>👑 CLUBHOUSE LEADER</span> : null}
            </div>
            <div className={styles.fruitInputs}>
              <input
                className={`${styles.input} ${styles.numInput} ${dirty ? styles.dirty : ""}`}
                inputMode="decimal"
                enterKeyHint="next"
                placeholder="Half A (g)"
                aria-label={`${p.name} half A grams`}
                data-fruit-row={p.id}
                value={textOf(p.id, "a")}
                onChange={(e) => setDraft(p.id, "a", e.target.value)}
                onBlur={(e) => void commit(p.id, e)}
              />
              <input
                className={`${styles.input} ${styles.numInput} ${dirty ? styles.dirty : ""}`}
                inputMode="decimal"
                enterKeyHint="done"
                placeholder="Half B (g)"
                aria-label={`${p.name} half B grams`}
                data-fruit-row={p.id}
                value={textOf(p.id, "b")}
                onChange={(e) => setDraft(p.id, "b", e.target.value)}
                onBlur={(e) => void commit(p.id, e)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </div>
            <div className={styles.row}>
              <span className={`${styles.mono} ${styles.grow}`}>
                {row?.calculatedErrorPct != null ? (
                  <>
                    off by{" "}
                    <span className={isLeader ? styles.goldText : undefined}>
                      {fmtErrPct(row.calculatedErrorPct)}
                    </span>
                  </>
                ) : (
                  <span className={styles.fine}>awaiting both halves</span>
                )}
              </span>
              <span
                className={`${styles.previewBadge} ${row?.calculatedRank == null ? styles.badgeMuted : ""}`}
              >
                {row?.calculatedRank != null
                  ? `${rankLabel(row.calculatedRank, tied.has(row.calculatedRank))} · ${fmtPts(row.finalEventPoints)} pts`
                  : "unranked"}
              </span>
            </div>
          </div>
        );
      })}
      {players.length === 0 ? <p className={styles.muted}>No active tributes.</p> : null}
      <p className={styles.fine}>Both halves save together when you leave the row.</p>
    </div>
  );
}
