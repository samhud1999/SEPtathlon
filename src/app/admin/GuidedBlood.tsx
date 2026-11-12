"use client";

/**
 * Guided mode for E7 — Blood on the Creek: round selector (R3 = 2× stakes),
 * generate round (confirm when it wipes unrevealed matchups), per-seat
 * PURE/BLOOD toggles, two-tap REVEAL ON TV & COMMIT, post-reveal delta nudges,
 * unreveal/delete via an overflow menu, and a manual matchup builder.
 * Full cards come from the authed GET /api/blood/matchups.
 */

import { useCallback, useEffect, useState } from "react";
import type { BloodCard, BloodMatchupPublic } from "@/lib/types";
import { fmtSigned } from "@/lib/format";
import styles from "./admin.module.css";
import { useAdmin, type MatchupsRes } from "./shared";
import { ArmButton, Seg, Sheet } from "./ui";

type RoundStr = "1" | "2" | "3";

const SEAT_KEYS = ["A", "B", "C"] as const;

interface Seat {
  key: "A" | "B" | "C";
  playerId: number;
  name: string;
  card: BloodCard | null;
  delta: number;
}

/** The authed GET returns the seats shape with real card values. */
function seatsOf(m: BloodMatchupPublic): Seat[] {
  return m.players.map((p, i) => ({
    key: SEAT_KEYS[i] ?? "C",
    playerId: p.playerId,
    name: p.name,
    card: p.card,
    delta: p.delta,
  }));
}

export default function GuidedBlood() {
  const { state, request, mutate, toast } = useAdmin();
  const [round, setRound] = useState<RoundStr>("1");
  const roundNumber = Number(round);
  const [matchups, setMatchups] = useState<BloodMatchupPublic[] | null>(null);
  const [genConfirm, setGenConfirm] = useState(false);
  const [builderSel, setBuilderSel] = useState<ReadonlySet<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await request<MatchupsRes>("/api/blood/matchups", {
        silent: true,
        background: true,
      });
      setMatchups(res.matchups);
    } catch {
      /* offline badge / login gate cover it */
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load, state.version]);

  const inRound = (matchups ?? [])
    .filter((m) => m.roundNumber === roundNumber)
    .sort((a, b) => Number(a.isRevealed) - Number(b.isRevealed) || a.id - b.id);
  const unrevealedCount = inRound.filter((m) => !m.isRevealed).length;

  const generate = async () => {
    const r = await mutate("/api/blood/generate", { roundNumber });
    if (r.ok) toast("ok", `Round ${roundNumber} matchups drawn`);
  };

  const toggleBuilder = (playerId: number) =>
    setBuilderSel((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else if (next.size < 3) next.add(playerId);
      return next;
    });

  const createManual = async () => {
    if (builderSel.size < 2 || builderSel.size > 3) return;
    const r = await mutate("/api/blood/matchups", {
      roundNumber,
      playerIds: Array.from(builderSel),
    });
    if (r.ok) {
      setBuilderSel(new Set());
      toast("ok", "Matchup forged");
    }
  };

  const activePlayers = state.players.filter((p) => p.isActive);

  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <div className={styles.grow}>
          <Seg<RoundStr>
            ariaLabel="Blood round"
            options={[
              { value: "1", label: "Round 1" },
              { value: "2", label: "Round 2" },
              { value: "3", label: "Round 3" },
            ]}
            value={round}
            onChange={setRound}
          />
        </div>
        {round === "3" ? <span className={styles.stakesBadge}>2× STAKES</span> : null}
      </div>

      <button
        type="button"
        className={`${styles.btn} ${styles.btnGold} ${styles.btnBig}`}
        onClick={() => {
          if (unrevealedCount > 0) setGenConfirm(true);
          else void generate();
        }}
      >
        ⚔ GENERATE ROUND {roundNumber} MATCHUPS
      </button>

      {matchups === null ? (
        <p className={styles.muted}>Consulting the standoff ledger…</p>
      ) : inRound.length === 0 ? (
        <p className={styles.muted}>No matchups in round {roundNumber} yet.</p>
      ) : (
        inRound.map((m) => <MatchupCard key={m.id} m={m} />)
      )}

      <h2 className={styles.sectionTitle}>Manual matchup — pick 2–3 tributes</h2>
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
        onClick={() => void createManual()}
      >
        FORGE MATCHUP ({builderSel.size}/3)
      </button>

      {genConfirm ? (
        <Sheet open title={`Regenerate round ${roundNumber}?`} onClose={() => setGenConfirm(false)}>
          <p className={styles.muted}>
            Round {roundNumber} already holds {unrevealedCount} unrevealed matchup
            {unrevealedCount === 1 ? "" : "s"}. Regenerating wipes them and draws fresh pairs.
            Revealed results are kept.
          </p>
          <div className={styles.sheetActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.grow}`}
              onClick={() => setGenConfirm(false)}
            >
              KEEP THEM
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCrimson} ${styles.grow}`}
              onClick={() => {
                setGenConfirm(false);
                void generate();
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

function MatchupCard({ m }: { m: BloodMatchupPublic }) {
  const { mutate, toast } = useAdmin();
  const [menuOpen, setMenuOpen] = useState(false);
  const seats = seatsOf(m);
  const allCarded = seats.every((s) => s.card !== null);

  const patch = (body: Record<string, unknown>) => mutate(`/api/blood/matchups/${m.id}`, body, { method: "PATCH" });

  const setCard = (seat: Seat, card: BloodCard) =>
    void patch({ [`card${seat.key}`]: seat.card === card ? null : card });

  const nudge = (seat: Seat, dir: 1 | -1) => void patch({ [`delta${seat.key}`]: seat.delta + dir });

  const reveal = async () => {
    const r = await patch({ reveal: true });
    if (r.ok) toast("ok", "🩸 REVEALED ON TV");
  };

  const unreveal = async () => {
    setMenuOpen(false);
    const r = await patch({ unreveal: true });
    if (r.ok) toast("ok", "Matchup hidden again — deltas excluded");
  };

  const remove = async () => {
    setMenuOpen(false);
    const r = await mutate(`/api/blood/matchups/${m.id}`, undefined, { method: "DELETE" });
    if (r.ok) toast("ok", "Matchup struck from the ledger");
  };

  return (
    <div className={styles.playerCard}>
      <div className={styles.row}>
        <span className={styles.matchTag}>
          #{m.id} · {m.matchupType}
        </span>
        <span className={`${styles.matchTag} ${m.isRevealed ? styles.matchTagLive : ""}`}>
          {m.isRevealed ? "REVEALED" : "SEALED"}
        </span>
        <div className={styles.menuWrap}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSquare} ${styles.btnGhost}`}
            aria-label={`Matchup ${m.id} actions`}
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
                {m.isRevealed ? (
                  <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => void unreveal()}>
                    UNREVEAL
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

      {seats.map((seat) => (
        <div key={seat.key} className={styles.seatRow}>
          <span className={styles.cardName}>{seat.name}</span>
          {m.isRevealed ? (
            <>
              <span
                className={`${styles.cardFace} ${seat.card === "BLOOD" ? styles.cardBloodOn : styles.cardPureOn}`}
              >
                {seat.card ?? "—"}
              </span>
              <span
                className={`${styles.deltaVal} ${seat.delta >= 0 ? styles.deltaPos : styles.deltaNeg}`}
              >
                {fmtSigned(seat.delta)}
              </span>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSquare}`}
                aria-label={`Lower delta for seat ${seat.key}`}
                onClick={() => nudge(seat, -1)}
              >
                −
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSquare}`}
                aria-label={`Raise delta for seat ${seat.key}`}
                onClick={() => nudge(seat, 1)}
              >
                +
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSmall} ${styles.cardBtn} ${
                  seat.card === "PURE" ? styles.cardPureOn : ""
                }`}
                aria-pressed={seat.card === "PURE"}
                onClick={() => setCard(seat, "PURE")}
              >
                PURE
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSmall} ${styles.cardBtn} ${
                  seat.card === "BLOOD" ? styles.cardBloodOn : ""
                }`}
                aria-pressed={seat.card === "BLOOD"}
                onClick={() => setCard(seat, "BLOOD")}
              >
                BLOOD
              </button>
            </>
          )}
        </div>
      ))}

      {!m.isRevealed ? (
        <ArmButton
          label={allCarded ? "🩸 REVEAL ON TV & COMMIT" : "AWAITING CARDS…"}
          armedLabel="TAP AGAIN — REVEAL NOW"
          className={styles.btnGold}
          disabled={!allCarded}
          onFire={() => void reveal()}
        />
      ) : null}
    </div>
  );
}
