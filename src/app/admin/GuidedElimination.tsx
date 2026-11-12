"use client";

/**
 * Guided mode for ELIMINATION events (E1 Stubby Fan, E4 Rock Hurl):
 * lives taps (quiet), two-tap ELIMINATE, REVIVE, and the E4 curse stepper.
 */

import { useState } from "react";
import type { EventInfo } from "@/lib/types";
import { CURSE_LEVELS, DEFAULT_LIVES, MAX_CURSE_LEVEL } from "@/lib/constants";
import { ordinal } from "@/lib/format";
import styles from "./admin.module.css";
import { useAdmin } from "./shared";
import { ArmButton, Avatar } from "./ui";

export default function GuidedElimination({ event }: { event: EventInfo }) {
  const { state, mutate } = useAdmin();
  const rows = state.eventResults[String(event.id)] ?? [];
  const rowOf = new Map(rows.map((r) => [r.playerId, r]));

  const decorated = state.players
    .filter((p) => p.isActive)
    .map((p) => {
      const row = rowOf.get(p.id);
      return {
        p,
        lives: row?.livesRemaining ?? DEFAULT_LIVES,
        eliminated: row?.eliminationOrder != null,
        rank: row?.calculatedRank ?? null,
      };
    });

  const alive = decorated
    .filter((d) => !d.eliminated)
    .sort((a, b) => a.p.name.localeCompare(b.p.name));
  const fallen = decorated
    .filter((d) => d.eliminated)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

  // One in-flight call per player at a time (double-tap safety on top of the API's own).
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
  const withPending = async (playerId: number, fn: () => Promise<unknown>) => {
    setPending((s) => new Set(s).add(playerId));
    try {
      await fn();
    } finally {
      setPending((s) => {
        const next = new Set(s);
        next.delete(playerId);
        return next;
      });
    }
  };

  const loseLife = (playerId: number, lives: number) =>
    withPending(playerId, () =>
      mutate(`/api/events/${event.id}/score`, {
        results: [{ playerId, livesRemaining: Math.max(0, lives - 1) }],
        quiet: true,
      }),
    );

  const eliminate = (playerId: number) =>
    withPending(playerId, () =>
      mutate(`/api/events/${event.id}/score`, { results: [{ playerId, eliminate: true }] }),
    );

  const revive = (playerId: number) =>
    withPending(playerId, () =>
      mutate(`/api/events/${event.id}/score`, {
        results: [{ playerId, revive: true }],
        quiet: true, // corrections shouldn't banner the TV
      }),
    );

  const setCurse = (playerId: number, level: number) =>
    void mutate("/api/players", {
      action: "update",
      playerId,
      rockCurseLevel: Math.min(MAX_CURSE_LEVEL, Math.max(0, level)),
    });

  return (
    <div className={styles.stack}>
      <h2 className={styles.sectionTitle}>
        Still standing ({alive.length}) — {event.name}
      </h2>
      {alive.map(({ p, lives }) => (
        <div key={p.id} className={styles.playerCard}>
          <div className={styles.row}>
            <Avatar name={p.name} size={40} />
            <span className={styles.cardName}>{p.name}</span>
            <span className={styles.livesRow} aria-label={`${lives} lives remaining`}>
              {[0, 1, 2].map((i) => (
                <span key={i} className={`${styles.lifePip} ${i < lives ? "" : styles.lifeOut}`} />
              ))}
              {lives > 3 ? <span className={`${styles.mono} ${styles.goldText}`}>+{lives - 3}</span> : null}
            </span>
          </div>
          <div className={styles.elimBtns}>
            <button
              type="button"
              className={`${styles.btn}`}
              disabled={lives <= 0 || pending.has(p.id)}
              onClick={() => void loseLife(p.id, lives)}
            >
              −1 LIFE
            </button>
            <ArmButton
              label="☠ ELIMINATE"
              armedLabel="TAP TO CONFIRM ☠"
              className={styles.btnOutlineCrimson}
              disabled={pending.has(p.id)}
              onFire={() => void eliminate(p.id)}
            />
          </div>
          {event.id === 4 ? (
            <div className={styles.curseRow}>
              <span className={styles.curseLabel}>
                🪨 Curse:{" "}
                <span className={p.rockCurseLevel > 0 ? styles.curseVal : undefined}>
                  {CURSE_LEVELS[p.rockCurseLevel] ?? "Clean"}
                </span>
              </span>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSquare}`}
                disabled={p.rockCurseLevel <= 0}
                aria-label={`Lower ${p.name} curse`}
                onClick={() => setCurse(p.id, p.rockCurseLevel - 1)}
              >
                −
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSquare}`}
                disabled={p.rockCurseLevel >= MAX_CURSE_LEVEL}
                aria-label={`Raise ${p.name} curse`}
                onClick={() => setCurse(p.id, p.rockCurseLevel + 1)}
              >
                +
              </button>
            </div>
          ) : null}
        </div>
      ))}
      {alive.length === 0 ? <p className={styles.muted}>No tributes remain standing.</p> : null}

      {fallen.length > 0 ? (
        <>
          <h2 className={styles.sectionTitle}>The fallen ({fallen.length})</h2>
          {fallen.map(({ p, rank }) => (
            <div key={p.id} className={`${styles.playerCard} ${styles.cardDim}`}>
              <div className={styles.row}>
                <Avatar name={p.name} size={40} />
                <span className={styles.cardName}>{p.name}</span>
                <span className={styles.ordinalTag}>
                  {rank != null ? `${ordinal(rank)} of the Creek` : "—"}
                </span>
              </div>
              <button
                type="button"
                className={`${styles.btn}`}
                disabled={pending.has(p.id)}
                onClick={() => void revive(p.id)}
              >
                ✦ REVIVE
              </button>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
