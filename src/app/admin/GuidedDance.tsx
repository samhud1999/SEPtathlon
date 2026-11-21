"use client";

/**
 * Guided mode for E7 — Dance on the Creek: DRAW DUOS (confirm first when duos
 * already exist, since a redraw wipes them and their scores), one card per duo
 * with a 0–10 score input, clear-score / delete via an overflow menu, and a
 * manual duo builder for benched or late tributes. Duos come straight from the
 * state payload — nothing is hidden from the TV any more.
 */

import { useState } from "react";
import type { BloodMatchupPublic } from "@/lib/types";
import { DANCE_MAX_SCORE } from "@/lib/constants";
import { duoNames, duoScore } from "@/lib/dance";
import { fmtPts } from "@/lib/format";
import { round1 } from "@/lib/scoring";
import styles from "./admin.module.css";
import { parseNum, useAdmin } from "./shared";
import { ArmButton, Sheet } from "./ui";

export default function GuidedDance() {
  const { state, mutate, toast } = useAdmin();
  const [drawConfirm, setDrawConfirm] = useState(false);
  const [builderSel, setBuilderSel] = useState<ReadonlySet<number>>(new Set());

  const duos = [...state.blood.matchups].sort((a, b) => a.id - b.id);
  const activePlayers = state.players.filter((p) => p.isActive);

  const draw = async () => {
    const r = await mutate("/api/blood/generate", { roundNumber: 1 });
    if (r.ok) toast("ok", "Duos drawn — take the floor");
  };

  const toggleBuilder = (playerId: number) =>
    setBuilderSel((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else if (next.size < 3) next.add(playerId);
      return next;
    });

  const forge = async () => {
    if (builderSel.size < 2 || builderSel.size > 3) return;
    const r = await mutate("/api/blood/matchups", {
      roundNumber: 1,
      playerIds: Array.from(builderSel),
    });
    if (r.ok) {
      setBuilderSel(new Set());
      toast("ok", "Duo forged");
    }
  };

  return (
    <div className={styles.stack}>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnGold} ${styles.btnBig}`}
        onClick={() => {
          if (duos.length > 0) setDrawConfirm(true);
          else void draw();
        }}
      >
        💃 DRAW DUOS
      </button>

      {duos.length === 0 ? (
        <p className={styles.muted}>No duos yet. Draw them when the dance floor is ready.</p>
      ) : (
        duos.map((m) => <DuoCard key={m.id} m={m} />)
      )}

      <h2 className={styles.sectionTitle}>Manual duo — pick 2–3 tributes</h2>
      <div className={`${styles.row} ${styles.wrap}`}>
        {activePlayers.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`${styles.chip} ${builderSel.has(p.id) ? styles.chipOn : ""}`}
            aria-pressed={builderSel.has(p.id)}
            onClick={() => toggleBuilder(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`${styles.btn}`}
        disabled={builderSel.size < 2}
        onClick={() => void forge()}
      >
        FORGE DUO ({builderSel.size}/3)
      </button>

      {drawConfirm ? (
        <Sheet open title="Draw fresh duos?" onClose={() => setDrawConfirm(false)}>
          <p className={styles.muted}>
            Reshuffle wipes the current duos and their scores. Draw fresh pairs?
          </p>
          <div className={styles.sheetActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.grow}`}
              onClick={() => setDrawConfirm(false)}
            >
              KEEP THEM
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCrimson} ${styles.grow}`}
              onClick={() => {
                setDrawConfirm(false);
                void draw();
              }}
            >
              WIPE &amp; REDRAW
            </button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

function DuoCard({ m }: { m: BloodMatchupPublic }) {
  const { mutate, toast } = useAdmin();
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const score = duoScore(m);
  const dirty = draft !== undefined;

  const patch = (body: { score: number | null }) =>
    mutate(`/api/blood/matchups/${m.id}`, body, { method: "PATCH" });

  const save = async () => {
    if (draft === undefined) return;
    const n = parseNum(draft);
    if (n === undefined || n === null) {
      toast("error", `Enter a score from 0 to ${DANCE_MAX_SCORE}`);
      return;
    }
    const s = round1(Math.min(DANCE_MAX_SCORE, Math.max(0, n)));
    const r = await patch({ score: s });
    if (r.ok) {
      setDraft(undefined);
      toast("ok", `${duoNames(m)} scored ${fmtPts(s)}/${DANCE_MAX_SCORE}`);
    }
  };

  const clearScore = async () => {
    setMenuOpen(false);
    const r = await patch({ score: null });
    if (r.ok) toast("ok", "Score cleared — duo drops from the Dance total");
  };

  const remove = async () => {
    setMenuOpen(false);
    const r = await mutate(`/api/blood/matchups/${m.id}`, undefined, { method: "DELETE" });
    if (r.ok) toast("ok", "Duo struck from the floor");
  };

  return (
    <div className={styles.playerCard}>
      <div className={styles.row}>
        <span className={styles.matchTag}>
          #{m.id} · {m.matchupType === "3WAY" ? "TRIO" : "DUO"}
        </span>
        <span className={`${styles.matchTag} ${score !== null ? styles.matchTagLive : ""}`}>
          {score === null ? "AWAITING" : `SCORED ${fmtPts(score)}/${DANCE_MAX_SCORE}`}
        </span>
        <div className={styles.menuWrap}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSquare} ${styles.btnGhost}`}
            aria-label={`Duo ${m.id} actions`}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          {menuOpen ? (
            <>
              <button
                type="button"
                className={styles.menuScrim}
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
              />
              <div className={styles.menuPop} role="menu">
                {score !== null ? (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSmall}`}
                    onClick={() => void clearScore()}
                  >
                    CLEAR SCORE
                  </button>
                ) : null}
                <ArmButton
                  label="DELETE"
                  armedLabel="DELETE — SURE?"
                  className={`${styles.btnSmall} ${styles.btnOutlineCrimson}`}
                  onFire={() => void remove()}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>

      {m.players.map((seat) => (
        <div key={seat.playerId} className={styles.seatRow}>
          <span className={styles.cardName}>{seat.name}</span>
        </div>
      ))}

      <div className={styles.row}>
        <input
          className={`${styles.input} ${styles.numInput} ${styles.scoreInput} ${dirty ? styles.dirty : ""}`}
          inputMode="decimal"
          enterKeyHint="done"
          placeholder={`0–${DANCE_MAX_SCORE}`}
          aria-label={`Score out of ${DANCE_MAX_SCORE} for duo ${m.id}`}
          value={draft ?? (score === null ? "" : String(score))}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
        />
        <span className={styles.scoreOf}>/ {DANCE_MAX_SCORE}</span>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGold} ${styles.grow}`}
          disabled={!dirty}
          onClick={() => void save()}
        >
          SAVE
        </button>
      </div>
    </div>
  );
}
