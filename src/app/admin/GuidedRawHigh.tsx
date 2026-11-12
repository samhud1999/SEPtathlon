"use client";

/**
 * Guided mode for RAW_HIGH events (E2 Krillion, E3 Weekly 50, E6 Grape Bobbing):
 * big score inputs (commit on blur), per-row joker toggle with the 409 → force
 * flow, and a 400 ms-debounced live rank/points preview via /preview.
 */

import { useEffect, useRef, useState } from "react";
import type { EventInfo, Standing } from "@/lib/types";
import { fmtPts, rankLabel } from "@/lib/format";
import styles from "./admin.module.css";
import { parseNum, tiedRanks, useAdmin, useJoker, type PreviewRes } from "./shared";
import { Avatar } from "./ui";

const SCORE_LABELS: Readonly<Record<number, string>> = {
  2: "Krillion score",
  3: "Quiz points",
  6: "Grapes counted",
};

export default function GuidedRawHigh({ event }: { event: EventInfo }) {
  const { state, mutate, request, toast } = useAdmin();
  const joker = useJoker();

  const players = state.players.filter((p) => p.isActive);
  const rows = state.eventResults[String(event.id)] ?? [];
  const rowOf = new Map(rows.map((r) => [r.playerId, r]));

  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<Map<number, Standing> | null>(null);
  const previewSeq = useRef(0);

  const stateVal = (playerId: number): number | null => rowOf.get(playerId)?.rawScore ?? null;
  const textOf = (playerId: number): string => {
    const d = drafts[playerId];
    if (d !== undefined) return d;
    const v = stateVal(playerId);
    return v == null ? "" : String(v);
  };
  const setDraft = (playerId: number, text: string) =>
    setDrafts((prev) => ({ ...prev, [playerId]: text }));
  const clearDraft = (playerId: number) =>
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[playerId];
      return next;
    });

  // ---- commit on blur ----
  const commit = async (playerId: number) => {
    const d = drafts[playerId];
    if (d === undefined) return;
    const v = parseNum(d);
    if (v === undefined || (v !== null && v < 0)) {
      toast("error", "Score must be a number ≥ 0");
      return;
    }
    if (v === stateVal(playerId)) {
      clearDraft(playerId);
      return;
    }
    // quiet: typed entries shouldn't banner the TV per keystroke; marking the
    // event COMPLETED (status control) fires the broadcast instead.
    const r = await mutate(`/api/events/${event.id}/score`, {
      results: [{ playerId, rawScore: v }],
      quiet: true,
    });
    if (r.ok) clearDraft(playerId);
  };

  // ---- 400 ms debounced preview with ALL current drafts ----
  useEffect(() => {
    if (Object.keys(drafts).length === 0) {
      setPreview(null);
      return;
    }
    const seq = ++previewSeq.current;
    const timer = setTimeout(() => {
      const results = players.map((p) => {
        const d = drafts[p.id];
        const parsed = d !== undefined ? parseNum(d) : stateVal(p.id);
        const v = parsed === undefined ? null : parsed;
        return { playerId: p.id, rawScore: v !== null && v < 0 ? null : v };
      });
      void (async () => {
        try {
          const res = await request<PreviewRes>(`/api/events/${event.id}/preview`, {
            body: { results },
            silent: true,
            background: true,
          });
          if (seq === previewSeq.current) {
            setPreview(new Map(res.standings.map((s) => [s.playerId, s])));
          }
        } catch {
          /* preview is best-effort */
        }
      })();
    }, 400);
    return () => clearTimeout(timer);
    // players/rowOf are derived from state; the effect re-runs whenever a draft changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, event.id, request]);

  // ---- badge source: preview standings while drafting, state rows otherwise ----
  const standings = players.map((p) => {
    if (preview) {
      const s = preview.get(p.id);
      return { playerId: p.id, rank: s?.calculatedRank ?? null, pts: s?.finalEventPoints ?? 0 };
    }
    const row = rowOf.get(p.id);
    return { playerId: p.id, rank: row?.calculatedRank ?? null, pts: row?.finalEventPoints ?? 0 };
  });
  const tied = tiedRanks(standings.map((s) => s.rank));
  const badgeFor = (playerId: number): string | null => {
    const s = standings.find((x) => x.playerId === playerId);
    if (!s || s.rank == null) return null;
    return `${rankLabel(s.rank, tied.has(s.rank))} · ${fmtPts(s.pts)} pts`;
  };

  const scoreLabel = SCORE_LABELS[event.id] ?? "Raw score";

  return (
    <div className={styles.stack}>
      <h2 className={styles.sectionTitle}>
        {scoreLabel} — {event.name}
      </h2>
      {players.map((p) => {
        const badge = badgeFor(p.id);
        const jokerHere = p.jokerEventId === event.id;
        const dirty = drafts[p.id] !== undefined;
        return (
          <div key={p.id} className={styles.playerCard}>
            <div className={styles.row}>
              <Avatar name={p.name} size={40} />
              <span className={styles.cardName}>{p.name}</span>
              <input
                className={`${styles.input} ${styles.numInput} ${styles.rawInput} ${dirty ? styles.dirty : ""}`}
                inputMode="decimal"
                enterKeyHint="done"
                placeholder="—"
                aria-label={`${scoreLabel} for ${p.name}`}
                value={textOf(p.id)}
                onChange={(e) => setDraft(p.id, e.target.value)}
                onBlur={() => void commit(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </div>
            <div className={`${styles.row} ${styles.wrap}`}>
              <button
                type="button"
                className={`${styles.chip} ${jokerHere ? styles.chipOn : ""}`}
                aria-pressed={jokerHere}
                onClick={() => void joker.setJoker(p.id, event.id, p.jokerEventId, !jokerHere)}
              >
                🃏 Joker {jokerHere ? "×2" : ""}
              </button>
              <span className={`${styles.previewBadge} ${badge === null ? styles.badgeMuted : ""}`}>
                {badge ?? "unranked"}
              </span>
            </div>
            {joker.conflict?.playerId === p.id ? (
              <div className={styles.inlineConfirm}>
                <span className={styles.grow}>
                  Joker already on E{joker.conflict.fromEventId} — move it?
                </span>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSmall} ${styles.btnGold}`}
                  onClick={() => void joker.force()}
                >
                  MOVE IT
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSmall}`}
                  onClick={joker.cancel}
                >
                  KEEP
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
      {players.length === 0 ? <p className={styles.muted}>No active tributes.</p> : null}
      <p className={styles.fine}>
        Scores save when you leave the field. The badge previews rank &amp; points as you type.
      </p>
    </div>
  );
}
