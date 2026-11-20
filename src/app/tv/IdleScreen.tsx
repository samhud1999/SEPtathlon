"use client";

import type { EventInfo } from "@/lib/types";
import { EVENTS_SEED } from "@/lib/constants";
import styles from "./tv.module.css";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;

interface IdleEvent {
  id: number;
  name: string;
  sin: string;
}

export default function IdleScreen({ events }: { events: EventInfo[] }) {
  const list: ReadonlyArray<IdleEvent> =
    events.length > 0 ? [...events].sort((a, b) => a.id - b.id) : EVENTS_SEED;

  return (
    <div className={styles.idle}>
      <div className={styles.idleTitle}>THE SEPTATHLON</div>
      <div className={styles.idleEvents}>
        {list.map((ev) => (
          <div key={ev.id} className={styles.idleEvent}>
            <span className={styles.idleNum}>{ROMAN[ev.id - 1] ?? String(ev.id)}</span>
            <span className={styles.idleName}>{ev.name}</span>
            <span className={styles.idleSin}>The Sin of {ev.sin}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
