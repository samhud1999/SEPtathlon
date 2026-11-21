"use client";

import type { EventInfo, EventResultRow, StatePayload } from "@/lib/types";
import { CURSE_LEVELS, DEFAULT_LIVES } from "@/lib/constants";
import { duoScore } from "@/lib/dance";
import { fmtErrPct, fmtPts, ordinal, rankLabel } from "@/lib/format";
import { nextEvent } from "@/lib/events";
import styles from "./tv.module.css";

const TYPE_FLAVOR: Record<string, string> = {
  ELIMINATION: "Last one standing wins",
  RAW_HIGH: "Highest score wins",
  FRUIT_SPLIT: "Closest to a perfect half wins",
  DANCE_OFF: "Duos dance, the Creek scores /10",
};

function effectiveRank(row: EventResultRow): number {
  return row.manualRankOverride ?? row.calculatedRank ?? Number.MAX_SAFE_INTEGER;
}

function Stubbies({ lives }: { lives: number }) {
  const shown = Math.max(0, Math.min(lives, DEFAULT_LIVES));
  return (
    <span className={styles.stubbies} title={`${lives} lives remaining`}>
      {Array.from({ length: DEFAULT_LIVES }, (_, i) => (
        <span key={i} className={`${styles.stubby}${i < shown ? "" : ` ${styles.stubbyOut}`}`} />
      ))}
      {lives > DEFAULT_LIVES && <span className={styles.stubbyExtra}>+{lives - DEFAULT_LIVES}</span>}
    </span>
  );
}

function EliminationSpot({
  payload,
  event,
}: {
  payload: StatePayload;
  event: EventInfo;
}) {
  const rows = payload.eventResults[String(event.id)] ?? [];
  const rowByPlayer = new Map(rows.map((r) => [r.playerId, r]));
  const playerById = new Map(payload.players.map((p) => [p.id, p]));
  const isRockHurl = event.id === 4;

  const alive = payload.players
    .filter((p) => p.isActive && (rowByPlayer.get(p.id)?.eliminationOrder ?? null) === null)
    .map((p) => ({
      player: p,
      lives: rowByPlayer.get(p.id)?.livesRemaining ?? DEFAULT_LIVES,
    }))
    .sort((a, b) => b.lives - a.lives || a.player.name.localeCompare(b.player.name));

  const fallen = rows
    .filter((r) => r.eliminationOrder !== null)
    .sort((a, b) => (b.eliminationOrder ?? 0) - (a.eliminationOrder ?? 0));

  return (
    <>
      <div className={styles.sectionLabel}>
        <span>Still standing</span>
        <span className={styles.countTag}>{alive.length}</span>
      </div>
      {alive.length === 0 ? (
        <div className={styles.spotEmpty}>None remain. The Creek is satisfied.</div>
      ) : (
        <div className={styles.aliveGrid}>
          {alive.map(({ player, lives }) => (
            <div key={player.id} className={styles.aliveCard}>
              <span className={styles.aliveInfo}>
                <span className={styles.aliveName}>{player.name}</span>
                {isRockHurl && (
                  <span
                    className={`${styles.curseTag}${
                      player.rockCurseLevel === 0 ? ` ${styles.curseClean}` : ""
                    }`}
                  >
                    {CURSE_LEVELS[player.rockCurseLevel] ?? `Level ${player.rockCurseLevel}`}
                  </span>
                )}
              </span>
              <Stubbies lives={lives} />
            </div>
          ))}
        </div>
      )}
      {fallen.length > 0 && (
        <>
          <div className={styles.sectionLabel}>
            <span>The fallen</span>
            <span className={styles.countTag}>{fallen.length}</span>
          </div>
          <div className={styles.fallenList}>
            {fallen.map((r) => (
              <div key={r.playerId} className={styles.fallenRow}>
                <span className={styles.fallenOrd}>
                  {r.eliminationOrder === null ? "—" : `${ordinal(r.eliminationOrder)} out`}
                </span>
                <span className={styles.fallenName}>
                  {playerById.get(r.playerId)?.name ?? `Tribute #${r.playerId}`}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function RawHighSpot({
  payload,
  event,
  expanded,
}: {
  payload: StatePayload;
  event: EventInfo;
  expanded: boolean;
}) {
  const playerById = new Map(payload.players.map((p) => [p.id, p]));
  const rows = (payload.eventResults[String(event.id)] ?? [])
    .filter((r) => r.rawScore !== null)
    .sort((a, b) => effectiveRank(a) - effectiveRank(b));

  if (rows.length === 0) {
    return <div className={styles.spotEmpty}>No scores yet. The trial has only begun…</div>;
  }

  const rankCounts = new Map<number, number>();
  for (const r of rows) {
    const rank = effectiveRank(r);
    rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
  }

  const shown = rows.slice(0, expanded ? 15 : 8);

  return (
    <>
      <div className={styles.sectionLabel}>
        <span>Top scores</span>
        <span className={styles.countTag}>{rows.length} scored</span>
      </div>
      <div className={styles.scoreList}>
        {shown.map((r) => {
          const rank = effectiveRank(r);
          const hasRank = rank !== Number.MAX_SAFE_INTEGER;
          return (
            <div key={r.playerId} className={styles.scoreRow}>
              <span className={styles.scoreRank}>
                {hasRank ? rankLabel(rank, (rankCounts.get(rank) ?? 0) > 1) : "—"}
              </span>
              <span className={styles.scoreName}>
                {playerById.get(r.playerId)?.name ?? `Tribute #${r.playerId}`}
              </span>
              <span className={styles.scoreRaw}>{r.rawScore === null ? "—" : fmtPts(r.rawScore)}</span>
              <span className={styles.scorePts}>{fmtPts(r.finalEventPoints)} pts</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function FruitSplitSpot({
  payload,
  event,
}: {
  payload: StatePayload;
  event: EventInfo;
}) {
  const playerById = new Map(payload.players.map((p) => [p.id, p]));
  const rows = (payload.eventResults[String(event.id)] ?? [])
    .filter((r) => r.calculatedErrorPct !== null)
    .sort((a, b) => effectiveRank(a) - effectiveRank(b));

  const leader = rows[0];
  if (leader === undefined) {
    return <div className={styles.spotEmpty}>The scales await the first split…</div>;
  }

  const rest = rows.slice(1);

  return (
    <>
      <div className={styles.hero}>
        <span className={styles.heroLabel}>Leader in the clubhouse</span>
        <span className={styles.heroName}>
          {playerById.get(leader.playerId)?.name ?? `Tribute #${leader.playerId}`}
        </span>
        <span className={styles.heroErr}>
          {leader.calculatedErrorPct === null ? "—" : fmtErrPct(leader.calculatedErrorPct)}
        </span>
        <span className={styles.heroHint}>the error to beat</span>
      </div>
      {rest.length > 0 && (
        <div className={styles.restList}>
          {rest.map((r, i) => (
            <div key={r.playerId} className={styles.restRow}>
              <span className={styles.scoreRank}>{ordinal(i + 2)}</span>
              <span className={styles.scoreName}>
                {playerById.get(r.playerId)?.name ?? `Tribute #${r.playerId}`}
              </span>
              <span className={styles.restErr}>
                {r.calculatedErrorPct === null ? "—" : fmtErrPct(r.calculatedErrorPct)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function DanceSpot({ payload }: { payload: StatePayload }) {
  const duos = [...payload.blood.matchups].sort((a, b) => a.id - b.id);
  if (duos.length === 0) {
    return <div className={styles.spotEmpty}>The duos have not been drawn…</div>;
  }

  return (
    <>
      <div className={styles.sectionLabel}>
        <span>Duos</span>
        <span className={styles.countTag}>{duos.length}</span>
      </div>
      <div className={styles.prevList}>
        {duos.map((m) => {
          const score = duoScore(m);
          return (
            <div key={m.id} className={styles.prevMatch}>
              {m.players.map((seat, i) => (
                <span key={seat.playerId} className={styles.prevSeat}>
                  {i > 0 && <span className={styles.prevVs}>&amp;</span>}
                  <span className={styles.prevName}>{seat.name}</span>
                </span>
              ))}
              {score === null ? (
                <span className={`${styles.seatChip} ${styles.seatChipAwaiting}`}>AWAITING</span>
              ) : (
                <span className={`${styles.seatChip} ${styles.seatChipLocked}`}>{fmtPts(score)} / 10</span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Teaser({ payload }: { payload: StatePayload }) {
  const next = nextEvent(payload.events);

  if (next === null) {
    return (
      <div className={styles.teaser}>
        <span className={styles.teaserLabel}>The Septathlon</span>
        <span className={styles.teaserSin}>All Trials Complete</span>
      </div>
    );
  }

  return (
    <div className={styles.teaser}>
      <span className={styles.teaserLabel}>Next trial</span>
      <span className={styles.teaserSin}>The Sin of {next.sin}</span>
      <span className={styles.teaserName}>
        E{next.id} · {next.name}
      </span>
      {TYPE_FLAVOR[next.scoringType] ? (
        <span className={styles.teaserFlavor}>{TYPE_FLAVOR[next.scoringType]}</span>
      ) : null}
    </div>
  );
}

export default function Spotlight({
  payload,
  expanded,
}: {
  payload: StatePayload;
  expanded: boolean;
}) {
  const live =
    payload.liveEventId === null
      ? null
      : (payload.events.find((e) => e.id === payload.liveEventId) ?? null);

  return (
    <section
      className={`${styles.panel} ${styles.spot}${expanded ? ` ${styles.spotExpanded}` : ""}`}
    >
      {live === null ? (
        <>
          <header className={styles.spotHead}>
            <div className={styles.spotSin}>The Trials Ahead</div>
          </header>
          <div className={styles.spotBody}>
            <Teaser payload={payload} />
          </div>
        </>
      ) : (
        <>
          <header className={styles.spotHead}>
            <div className={styles.spotSin}>The Sin of {live.sin}</div>
            <div className={styles.spotEventRow}>
              <span className={styles.spotEvent}>
                E{live.id} · {live.name}
              </span>
              <span className={styles.liveTag}>LIVE</span>
            </div>
          </header>
          <div className={styles.spotBody}>
            {live.scoringType === "ELIMINATION" && (
              <EliminationSpot payload={payload} event={live} />
            )}
            {live.scoringType === "RAW_HIGH" && (
              <RawHighSpot payload={payload} event={live} expanded={expanded} />
            )}
            {live.scoringType === "FRUIT_SPLIT" && (
              <FruitSplitSpot payload={payload} event={live} />
            )}
            {live.scoringType === "DANCE_OFF" && <DanceSpot payload={payload} />}
          </div>
        </>
      )}
    </section>
  );
}
