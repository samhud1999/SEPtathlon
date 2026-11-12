"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Broadcast } from "@/lib/types";
import { fmtSigned } from "@/lib/format";
import styles from "./tv.module.css";

type DecreeBroadcast = Extract<Broadcast, { type: "DECREE" }>;
type ScoreBroadcast = Extract<Broadcast, { type: "EVENT_SCORE" }>;
type RevealBroadcast = Extract<Broadcast, { type: "BLOOD_REVEAL" }>;

function DecreeOverlay({ broadcast }: { broadcast: DecreeBroadcast }) {
  const { playerNames, pointsDelta, sinTag, reason } = broadcast.payload;
  return (
    <motion.div
      className={styles.veil}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      <motion.div
        className={styles.decreeOv}
        initial={{ scale: 0.82, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ type: "spring", stiffness: 130, damping: 16 }}
      >
        <div className={styles.ovTitle}>⚡ JUDGMENT FROM THE CREEK ⚡</div>
        <div className={styles.ovPoints}>
          <span className={pointsDelta > 0 ? styles.pos : styles.neg}>{fmtSigned(pointsDelta)}</span>{" "}
          POINTS TO <span className={styles.ovNames}>{playerNames.join(" & ")}</span>
        </div>
        <div className={styles.ovReason}>
          Sin of {sinTag}: {reason}
        </div>
      </motion.div>
    </motion.div>
  );
}

function ScoreBanner({ broadcast }: { broadcast: ScoreBroadcast }) {
  return (
    <motion.div
      className={styles.banner}
      initial={{ y: -110, x: "-50%", opacity: 0 }}
      animate={{ y: 0, x: "-50%", opacity: 1 }}
      exit={{ y: -110, x: "-50%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 180, damping: 22 }}
    >
      <span className={styles.bannerTag}>E{broadcast.payload.eventId}</span>
      <span className={styles.bannerEvent}>{broadcast.payload.eventName}</span>
      <span className={styles.bannerMsg}>{broadcast.payload.message}</span>
    </motion.div>
  );
}

function RevealOverlay({ broadcast }: { broadcast: RevealBroadcast }) {
  return (
    <motion.div
      className={`${styles.veil} ${styles.revealVeil}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className={styles.flashLayer}
        initial={{ opacity: 0.85 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      />
      <motion.div
        className={styles.revealBox}
        initial={{ scale: 1.18, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: "spring", stiffness: 150, damping: 18 }}
      >
        <div className={styles.revealRound}>
          ROUND {broadcast.payload.roundNumber} · STANDOFF {broadcast.payload.matchupId}
        </div>
        <div className={styles.revealHead}>{broadcast.payload.headline}</div>
        <div className={styles.revealLines}>
          {broadcast.payload.lines.map((line, i) => (
            <div key={i} className={styles.revealLine}>
              {line}
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function Overlays({ overlay }: { overlay: Broadcast | null }) {
  return (
    <AnimatePresence>
      {overlay !== null && overlay.type === "DECREE" && (
        <DecreeOverlay key={`decree-${overlay.id}`} broadcast={overlay} />
      )}
      {overlay !== null && overlay.type === "EVENT_SCORE" && (
        <ScoreBanner key={`score-${overlay.id}`} broadcast={overlay} />
      )}
      {overlay !== null && overlay.type === "BLOOD_REVEAL" && (
        <RevealOverlay key={`reveal-${overlay.id}`} broadcast={overlay} />
      )}
    </AnimatePresence>
  );
}
