"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { EventInfo, StatePayload } from "@/lib/types";
import { nextEvent } from "@/lib/events";
import styles from "./tv.module.css";

function Clock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const update = () =>
      setTime(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }),
      );
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, []);

  return <div className={styles.clock}>{time ?? "--:--:--"}</div>;
}

function EventChip({ live, next }: { live: EventInfo | null; next: EventInfo | null }) {
  if (live !== null) {
    return (
      <div className={`${styles.liveChip} ${styles.liveChipOn}`}>
        <span className={`${styles.chipDot} ${styles.chipDotLive}`} />
        <span className={styles.chipTag}>LIVE</span>
        <span className={styles.chipSin}>The Sin of {live.sin}</span>
        <span className={styles.chipName}>{live.name}</span>
      </div>
    );
  }
  if (next !== null) {
    return (
      <div className={styles.liveChip}>
        <span className={styles.chipDot} />
        <span className={styles.chipTag}>NEXT</span>
        <span className={styles.chipSin}>The Sin of {next.sin}</span>
        <span className={styles.chipName}>{next.name}</span>
      </div>
    );
  }
  return (
    <div className={styles.liveChip}>
      <span className={styles.chipDot} />
      <span className={styles.chipTag}>COMPLETE</span>
      <span className={styles.chipName}>All trials judged</span>
    </div>
  );
}

export default function Header({
  payload,
  wakeHeld,
  showHint,
}: {
  payload: StatePayload;
  wakeHeld: boolean;
  showHint: boolean;
}) {
  const live =
    payload.liveEventId === null
      ? null
      : (payload.events.find((e) => e.id === payload.liveEventId) ?? null);
  const next = nextEvent(payload.events);

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <div className={styles.title}>THE SEPTATHLON</div>
      </div>
      <div className={styles.headerSpacer} />
      <EventChip live={live} next={next} />
      <AnimatePresence>
        {showHint && (
          <motion.div
            className={styles.hintChip}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
          >
            Press F11 for fullscreen
          </motion.div>
        )}
      </AnimatePresence>
      <span
        className={`${styles.wakeDot} ${wakeHeld ? styles.wakeHeld : styles.wakeOff}`}
        title={wakeHeld ? "Screen wake lock held" : "Screen wake lock unavailable"}
      />
      <Clock />
    </header>
  );
}
