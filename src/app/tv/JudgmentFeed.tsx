"use client";

import type { DecreeRow } from "@/lib/types";
import { fmtDayTime, fmtSigned } from "@/lib/format";
import styles from "./tv.module.css";

export default function JudgmentFeed({ decrees }: { decrees: DecreeRow[] }) {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <span className={styles.panelTitle}>The Scroll of Judgment</span>
        <span className={styles.panelSub}>⚡ decrees of the Commissioner</span>
      </header>
      <div className={styles.feedBody}>
        {decrees.length === 0 ? (
          <div className={styles.feedEmpty}>The Creek has issued no judgments… yet.</div>
        ) : (
          decrees.map((d) => (
            <article
              key={d.id}
              className={`${styles.decree}${d.isVoided ? ` ${styles.voided}` : ""}`}
            >
              <span className={`${styles.delta} ${d.pointsDelta > 0 ? styles.pos : styles.neg}`}>
                {fmtSigned(d.pointsDelta)}
              </span>
              <div className={styles.decreeMain}>
                <div className={styles.decreeTop}>
                  <span className={styles.decreeName}>{d.playerName}</span>
                  <span className={styles.sinChip}>{d.sinTag}</span>
                  {d.isVoided && <span className={styles.voidTag}>VOIDED</span>}
                  <span className={styles.decreeTime}>{fmtDayTime(d.createdAt)}</span>
                </div>
                <div className={styles.reason}>{d.reason}</div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
