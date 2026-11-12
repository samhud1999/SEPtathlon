"use client";

import { Fragment, useEffect, useState } from "react";
import { motion } from "motion/react";
import type { BloodMatchupPublic, BloodSeat, StatePayload } from "@/lib/types";
import { ROUND_STAKES } from "@/lib/constants";
import { fmtSigned } from "@/lib/format";
import styles from "./tv.module.css";

const STANDOFF_MS = 90_000;
const RING_RADIUS = 44;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function CountdownRing({ remainMs }: { remainMs: number }) {
  const frac = Math.max(0, Math.min(1, remainMs / STANDOFF_MS));
  const secs = Math.max(0, Math.ceil(remainMs / 1000));
  const low = remainMs <= 15_000;
  const due = remainMs <= 0;

  return (
    <div className={styles.ringWrap}>
      <svg className={styles.ring} viewBox="0 0 100 100" role="img" aria-label="Standoff countdown">
        <circle className={styles.ringTrack} cx="50" cy="50" r={RING_RADIUS} fill="none" strokeWidth="6" />
        <circle
          className={`${styles.ringArc}${low ? ` ${styles.ringLow}` : ""}`}
          cx="50"
          cy="50"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - frac)}
          transform="rotate(-90 50 50)"
        />
        <text
          x="50"
          y="60"
          textAnchor="middle"
          className={`${styles.ringText}${low ? ` ${styles.ringTextLow}` : ""}`}
        >
          {secs}
        </text>
      </svg>
      <span className={`${styles.ringLabel}${due ? ` ${styles.ringLabelDue}` : ""}`}>
        {due ? "JUDGMENT DUE" : "SECONDS"}
      </span>
    </div>
  );
}

function Seat({ seat, revealed }: { seat: BloodSeat; revealed: boolean }) {
  const showFace = revealed && seat.card !== null;
  return (
    <div className={styles.seat}>
      <div className={styles.seatName}>{seat.name}</div>
      {showFace ? (
        <motion.div
          key="face"
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className={`${styles.card} ${seat.card === "PURE" ? styles.cardPure : styles.cardBlood}`}
        >
          <span className={styles.cardWord}>{seat.card}</span>
          <span className={styles.cardDelta}>{fmtSigned(seat.delta)}</span>
        </motion.div>
      ) : (
        <div key="back" className={`${styles.card} ${styles.cardBack}`}>
          <span className={styles.cardSigil}>✦</span>
          <span
            className={`${styles.cardStatus} ${
              seat.cardSet ? styles.statusLocked : styles.statusAwaiting
            }`}
          >
            {seat.cardSet ? "LOCKED" : "AWAITING"}
          </span>
        </div>
      )}
    </div>
  );
}

function Standoff({
  matchup,
  now,
  skewMs,
}: {
  matchup: BloodMatchupPublic;
  now: number;
  skewMs: number;
}) {
  const createdMs = Date.parse(matchup.createdAt);
  const deadline = Number.isNaN(createdMs) ? 0 : createdMs + STANDOFF_MS;
  // Correct the local clock onto the server's clock before comparing.
  const serverNow = now + skewMs;
  const remainMs = Math.max(0, deadline - serverNow);

  const seats = matchup.players;
  const a = seats[0];
  const b = seats[1];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className={styles.standoff}
    >
      <div className={styles.soHead}>
        <span className={styles.soTag}>Standoff {matchup.id}</span>
        <span className={styles.soTag}>
          {matchup.matchupType === "3WAY" ? "3-way" : "1 v 1"} · R{matchup.roundNumber}
        </span>
      </div>

      {matchup.matchupType === "3WAY" ? (
        <>
          {!matchup.isRevealed && (
            <div className={styles.threeRing}>
              <CountdownRing remainMs={remainMs} />
            </div>
          )}
          <div className={styles.soSeats3}>
            {seats.map((seat, i) => (
              <Fragment key={seat.playerId}>
                {i > 0 && <span className={styles.vs}>VS</span>}
                <Seat seat={seat} revealed={matchup.isRevealed} />
              </Fragment>
            ))}
          </div>
        </>
      ) : a !== undefined && b !== undefined ? (
        <div className={styles.soSeats}>
          <Seat seat={a} revealed={matchup.isRevealed} />
          <div className={styles.vsCol}>
            <span className={styles.vs}>VS</span>
            {matchup.isRevealed ? (
              <span className={styles.revealedMark}>REVEALED</span>
            ) : (
              <CountdownRing remainMs={remainMs} />
            )}
          </div>
          <Seat seat={b} revealed={matchup.isRevealed} />
        </div>
      ) : null}
    </motion.div>
  );
}

export default function BloodStage({
  payload,
  skewMs,
}: {
  payload: StatePayload;
  skewMs: number;
}) {
  const now = useNow(200);
  const matchups = payload.blood.matchups;
  const round = matchups.length > 0 ? Math.max(...matchups.map((m) => m.roundNumber)) : null;
  const current =
    round === null
      ? []
      : matchups.filter((m) => m.roundNumber === round).sort((a, b) => a.id - b.id);
  const stakes = round === null ? 1 : (ROUND_STAKES[round] ?? 1);
  const sin = payload.events.find((e) => e.id === 7)?.sin ?? "Lust";

  return (
    <section className={styles.stage}>
      <header className={styles.stageHead}>
        <h2 className={styles.stageTitle}>Blood on the Creek</h2>
        <div className={styles.stageSub}>
          <span className={styles.stageSin}>The Sin of {sin}</span>
          {round !== null && <span className={styles.stageRound}>ROUND {round}</span>}
          {stakes > 1 && <span className={styles.stakes}>⚔ DOUBLE STAKES ×{stakes}</span>}
        </div>
      </header>

      {current.length === 0 ? (
        <div className={styles.stageEmpty}>
          No standoffs drawn. The Commissioner shuffles the fates…
        </div>
      ) : (
        <div className={styles.stageGrid}>
          {current.map((m) => (
            <Standoff key={m.id} matchup={m} now={now} skewMs={skewMs} />
          ))}
        </div>
      )}
    </section>
  );
}
