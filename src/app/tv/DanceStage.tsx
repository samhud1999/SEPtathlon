"use client";

/**
 * TV stage for E7 — Dance on the Creek (mode BLOOD_STAGE, relabelled "Dance
 * stage"): a plain grid of duos with their /10 scores. No cards, no countdown.
 */

import { motion } from "motion/react";
import type { BloodMatchupPublic, StatePayload } from "@/lib/types";
import { duoScore } from "@/lib/dance";
import { fmtPts } from "@/lib/format";
import styles from "./tv.module.css";

function DuoCard({ m }: { m: BloodMatchupPublic }) {
  const score = duoScore(m);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className={styles.standoff}
    >
      <div className={styles.soHead}>
        <span className={styles.soTag}>
          {m.matchupType === "3WAY" ? "Trio" : "Duo"} {m.id}
        </span>
        <span className={styles.soTag}>{score === null ? "on the floor" : "scored"}</span>
      </div>
      <div className={styles.duoNames}>
        {m.players.map((seat) => (
          <span key={seat.playerId} className={styles.seatName}>
            {seat.name}
          </span>
        ))}
      </div>
      {score === null ? (
        <span className={styles.duoAwaiting}>AWAITING SCORE</span>
      ) : (
        <span className={styles.duoScore}>
          {fmtPts(score)}
          <span className={styles.duoScoreMax}>/ 10</span>
        </span>
      )}
    </motion.div>
  );
}

export default function DanceStage({ payload }: { payload: StatePayload }) {
  const event = payload.events.find((e) => e.id === 7);
  const duos = [...payload.blood.matchups].sort((a, b) => a.id - b.id);

  return (
    <section className={styles.stage}>
      <header className={styles.stageHead}>
        <h2 className={styles.stageTitle}>{event?.name ?? "Dance on the Creek"}</h2>
        <div className={styles.stageSub}>
          <span className={styles.stageSin}>The Sin of {event?.sin ?? "Lust"}</span>
        </div>
      </header>

      {duos.length === 0 ? (
        <div className={styles.stageEmpty}>No duos drawn. The Commissioner shuffles the fates…</div>
      ) : (
        <div className={styles.stageGrid}>
          {duos.map((m) => (
            <DuoCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </section>
  );
}
