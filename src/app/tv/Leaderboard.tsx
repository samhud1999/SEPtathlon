"use client";

import { AnimatePresence, motion } from "motion/react";
import type { LeaderboardRow, StatePayload } from "@/lib/types";
import { CURSE_LEVELS } from "@/lib/constants";
import { fmtPts, fmtSigned } from "@/lib/format";
import styles from "./tv.module.css";

/** The schema default; only show epithets someone actually wrote. */
const DEFAULT_EPITHET = "Tribute of the Creek";

export type FlashMap = Map<number, Map<string, 1 | -1>>;

const EVENT_KEYS = ["1", "2", "3", "4", "5", "6"] as const;

function flashClass(delta: 1 | -1 | undefined): string {
  if (delta === undefined) return "";
  return delta === 1 ? ` ${styles.flashUp}` : ` ${styles.flashDown}`;
}

function Trend({ trend }: { trend: number | null }) {
  if (trend === null || trend === 0) return <span className={styles.trendFlat}>–</span>;
  if (trend > 0) return <span className={styles.trendUp}>▲{trend}</span>;
  return <span className={styles.trendDown}>▼{Math.abs(trend)}</span>;
}

function Row({
  row,
  isLast,
  anyPoints,
  liveEventId,
  version,
  cellFlash,
}: {
  row: LeaderboardRow;
  isLast: boolean;
  anyPoints: boolean;
  liveEventId: number | null;
  version: number;
  cellFlash: Map<string, 1 | -1> | undefined;
}) {
  // Highlight first and last only once scoring has started (avoids a 12-way crown at 0).
  const isSovereign = anyPoints && row.rank === 1;
  const isVessel = anyPoints && isLast && row.rank !== 1;
  const curseHot = liveEventId === 4;

  const rowClass = `${styles.cols} ${styles.row}${isSovereign ? ` ${styles.rowFirst}` : ""}${
    isVessel ? ` ${styles.rowLast}` : ""
  }`;

  const numCell = (
    colKey: string,
    content: React.ReactNode,
    extraClass = "",
  ): React.ReactNode => {
    const delta = cellFlash?.get(colKey);
    return (
      <span
        key={delta !== undefined ? `f${version}` : "s"}
        className={`${styles.cellVal}${extraClass}${flashClass(delta)}`}
      >
        {content}
      </span>
    );
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 170, damping: 26, mass: 0.9 }}
      className={rowClass}
    >
      {isVessel && <span className={styles.jagged} aria-hidden />}

      <div className={styles.rankCell}>
        {isSovereign && <span className={styles.crown}>♛</span>}
        <span className={styles.rankNum}>{row.rank}</span>
      </div>

      <div className={styles.colWide}>
        <Trend trend={row.trend} />
      </div>

      <div className={styles.tribute}>
        <div className={styles.nameLine}>
          <span className={styles.name}>{row.name}</span>
          {row.jokerEventId !== null && (
            <span className={`${styles.badge} ${styles.badgeJoker}`} title="Mortal Sin Joker">
              🃏 E{row.jokerEventId}
            </span>
          )}
          {row.rockCurseLevel > 0 && (
            <span
              className={`${styles.badge} ${styles.badgeCurse}${
                curseHot ? ` ${styles.badgeCurseHot}` : ""
              }`}
              title="Rock Hurl curse"
            >
              🪨 {CURSE_LEVELS[row.rockCurseLevel] ?? `Level ${row.rockCurseLevel}`}
            </span>
          )}
        </div>
        {row.epithet && row.epithet !== DEFAULT_EPITHET ? (
          <div className={styles.subLine}>
            <span className={styles.epithet}>{row.epithet}</span>
          </div>
        ) : null}
      </div>

      {EVENT_KEYS.map((key) => {
        const pts = row.eventPoints[key];
        const isJokerCell = row.jokerEventId !== null && String(row.jokerEventId) === key;
        const isLiveCol = liveEventId !== null && String(liveEventId) === key;
        return (
          <div
            key={key}
            className={`${styles.cell} ${styles.colWide}${isLiveCol ? ` ${styles.cellLive}` : ""}`}
          >
            {numCell(
              `e${key}`,
              <>
                {pts === undefined ? "—" : fmtPts(pts)}
                {isJokerCell && <sup className={styles.x2}>×2</sup>}
              </>,
              pts === undefined ? ` ${styles.cellDim}` : "",
            )}
          </div>
        );
      })}

      <div
        className={`${styles.cell} ${styles.colWide}${liveEventId === 7 ? ` ${styles.cellLive}` : ""}`}
      >
        {numCell(
          "blood",
          row.bloodTotal === 0 ? "0" : fmtSigned(row.bloodTotal),
          row.bloodTotal === 0
            ? ` ${styles.cellDim}`
            : row.bloodTotal > 0
              ? ` ${styles.pos}`
              : ` ${styles.neg}`,
        )}
      </div>

      <div className={`${styles.cell} ${styles.colWide}`}>
        {numCell(
          "decree",
          row.decreeTotal === 0 ? "0" : fmtSigned(row.decreeTotal),
          row.decreeTotal === 0
            ? ` ${styles.cellDim}`
            : row.decreeTotal > 0
              ? ` ${styles.pos}`
              : ` ${styles.neg}`,
        )}
      </div>

      <div className={styles.cell}>
        <span
          key={cellFlash?.get("total") !== undefined ? `f${version}` : "s"}
          className={`${styles.total}${flashClass(cellFlash?.get("total"))}`}
        >
          {fmtPts(row.total)}
        </span>
      </div>
    </motion.div>
  );
}

export default function Leaderboard({
  payload,
  flash,
}: {
  payload: StatePayload;
  flash: FlashMap;
}) {
  const eventById = new Map(payload.events.map((e) => [e.id, e]));
  const rows = payload.leaderboard;
  const anyPoints = rows.some((r) => r.total !== 0);

  return (
    <section className={`${styles.panel} ${styles.board}`}>
      <div className={`${styles.cols} ${styles.boardHead}`}>
        <div className={styles.colHeadL}>Rank</div>
        <div className={`${styles.colHeadL} ${styles.colWide}`}>±</div>
        <div className={styles.colHeadL}>Tribute</div>
        {EVENT_KEYS.map((key) => {
          const ev = eventById.get(Number(key));
          const isLive = payload.liveEventId !== null && String(payload.liveEventId) === key;
          return (
            <div
              key={key}
              className={`${styles.evHead} ${styles.colWide}${isLive ? ` ${styles.evHeadLive}` : ""}`}
            >
              <span className={styles.evNum}>E{key}</span>
              <span className={styles.evSin}>{ev?.sin ?? ""}</span>
            </div>
          );
        })}
        <div
          className={`${styles.evHead} ${styles.colWide}${payload.liveEventId === 7 ? ` ${styles.evHeadLive}` : ""}`}
        >
          <span className={styles.evNum}>E7</span>
          <span className={styles.evSin}>{eventById.get(7)?.sin ?? "Blood"}</span>
        </div>
        <div className={`${styles.evHead} ${styles.colWide}`}>
          <span className={styles.evNum}>⚡</span>
          <span className={styles.evSin}>Decrees</span>
        </div>
        <div className={styles.evHead}>
          <span className={styles.evNum}>Total</span>
          <span className={styles.evSin}>points</span>
        </div>
      </div>

      <div className={styles.body}>
        {rows.length === 0 ? (
          <div className={styles.emptyBoard}>No active tributes stand upon the board.</div>
        ) : (
          <AnimatePresence initial={false}>
            {rows.map((row, i) => (
              <Row
                key={row.playerId}
                row={row}
                isLast={i === rows.length - 1 && rows.length > 1}
                anyPoints={anyPoints}
                liveEventId={payload.liveEventId}
                version={payload.version}
                cellFlash={flash.get(row.playerId)}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </section>
  );
}
