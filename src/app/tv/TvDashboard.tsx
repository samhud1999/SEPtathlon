"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Broadcast, StatePayload } from "@/lib/types";
import styles from "./tv.module.css";
import Header from "./Header";
import Leaderboard, { type FlashMap } from "./Leaderboard";
import Spotlight from "./Spotlight";
import JudgmentFeed from "./JudgmentFeed";
import DanceStage from "./DanceStage";
import Overlays from "./Overlays";
import IdleScreen from "./IdleScreen";

const POLL_MS = 2500;
const OVERLAY_GAP_MS = 400;

const EVENT_KEYS = ["1", "2", "3", "4", "5", "6"] as const;

interface View {
  payload: StatePayload;
  flash: FlashMap;
}

/** Diff two consecutive payloads into a per-player map of changed cells (+1 up / −1 down). */
function diffBoards(prev: StatePayload | null, next: StatePayload): FlashMap {
  const map: FlashMap = new Map();
  if (prev === null) return map;
  const prevRows = new Map(prev.leaderboard.map((r) => [r.playerId, r]));
  for (const row of next.leaderboard) {
    const old = prevRows.get(row.playerId);
    if (old === undefined) continue;
    const cells = new Map<string, 1 | -1>();
    for (const key of EVENT_KEYS) {
      const a = old.eventPoints[key];
      const b = row.eventPoints[key];
      if (a !== b) cells.set(`e${key}`, (b ?? 0) >= (a ?? 0) ? 1 : -1);
    }
    if (old.bloodTotal !== row.bloodTotal) {
      cells.set("dance", row.bloodTotal > old.bloodTotal ? 1 : -1);
    }
    if (old.decreeTotal !== row.decreeTotal) {
      cells.set("decree", row.decreeTotal > old.decreeTotal ? 1 : -1);
    }
    if (old.total !== row.total) cells.set("total", row.total > old.total ? 1 : -1);
    if (cells.size > 0) map.set(row.playerId, cells);
  }
  return map;
}

function overlayHoldMs(b: Broadcast): number {
  switch (b.type) {
    case "DECREE":
      return 5000;
    default:
      return 4000;
  }
}

export default function TvDashboard({ endpoint }: { endpoint: string }) {
  const [view, setView] = useState<View | null>(null);
  const [signalLost, setSignalLost] = useState(false);
  const [overlay, setOverlay] = useState<Broadcast | null>(null);
  const [wakeHeld, setWakeHeld] = useState(false);
  const [showHint, setShowHint] = useState(true);

  const versionRef = useRef<number | null>(null);
  const failsRef = useRef(0);
  const maxBroadcastRef = useRef<number | null>(null);
  const queueRef = useRef<Broadcast[]>([]);
  const overlayRef = useRef<Broadcast | null>(null);
  const timersRef = useRef<Set<number>>(new Set());
  const pumpRef = useRef<() => void>(() => undefined);

  /** Play queued broadcasts one at a time; TV_MODE entries are consumed silently. */
  const pump = useCallback(() => {
    if (overlayRef.current !== null) return;
    const queue = queueRef.current;
    let next = queue.shift();
    while (next !== undefined && next.type === "TV_MODE") next = queue.shift();
    if (next === undefined) return;
    overlayRef.current = next;
    setOverlay(next);
    const hold = window.setTimeout(() => {
      timersRef.current.delete(hold);
      overlayRef.current = null;
      setOverlay(null);
      const gap = window.setTimeout(() => {
        timersRef.current.delete(gap);
        pumpRef.current();
      }, OVERLAY_GAP_MS);
      timersRef.current.add(gap);
    }, overlayHoldMs(next));
    timersRef.current.add(hold);
  }, []);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  // ---- polling loop -------------------------------------------------------
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as StatePayload;
        if (!alive) return;

        failsRef.current = 0;
        setSignalLost(false);

        // Broadcast bookkeeping: never replay anything from the first payload.
        const ids = payload.broadcasts.map((b) => b.id);
        const maxId = ids.length > 0 ? Math.max(...ids) : 0;
        const seen = maxBroadcastRef.current;
        if (seen === null) {
          maxBroadcastRef.current = maxId;
        } else if (maxId > seen) {
          const fresh = payload.broadcasts
            .filter((b) => b.id > seen)
            .sort((a, b) => a.id - b.id);
          queueRef.current.push(...fresh);
          maxBroadcastRef.current = maxId;
          pumpRef.current();
        }

        // Skip re-render entirely when the version has not moved.
        if (versionRef.current !== payload.version) {
          versionRef.current = payload.version;
          setView((prev) => ({
            payload,
            flash: diffBoards(prev?.payload ?? null, payload),
          }));
        }
      } catch {
        if (!alive) return;
        failsRef.current += 1;
        if (failsRef.current >= 2) setSignalLost(true);
      } finally {
        if (alive) timer = window.setTimeout(() => void tick(), POLL_MS);
      }
    };

    void tick();
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [endpoint]);

  // ---- overlay timer cleanup ---------------------------------------------
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

  // ---- screen wake lock ---------------------------------------------------
  useEffect(() => {
    let disposed = false;
    let sentinel: WakeLockSentinel | null = null;

    const acquire = async () => {
      if (disposed || typeof navigator === "undefined" || !("wakeLock" in navigator)) {
        setWakeHeld(false);
        return;
      }
      if (document.visibilityState !== "visible") return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (disposed) {
          void lock.release().catch(() => undefined);
          return;
        }
        sentinel = lock;
        setWakeHeld(true);
        lock.addEventListener("release", () => {
          if (!disposed) setWakeHeld(false);
        });
      } catch {
        if (!disposed) setWakeHeld(false);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (sentinel !== null) void sentinel.release().catch(() => undefined);
    };
  }, []);

  // ---- fullscreen hint fade ----------------------------------------------
  useEffect(() => {
    const t = window.setTimeout(() => setShowHint(false), 10_000);
    return () => window.clearTimeout(t);
  }, []);

  const signalBadge = signalLost ? (
    <div className={styles.signalLost} role="status">
      <span className={styles.signalDot} />
      SIGNAL LOST
    </div>
  ) : null;

  // Before the first payload lands: a quiet title card, never a crash.
  if (view === null) {
    return (
      <div className={styles.root}>
        <div className={styles.awaitWrap}>
          <div>
            <div className={styles.awaitTitle}>THE SEPTATHLON</div>
            <div className={styles.awaitSub}>Loading…</div>
          </div>
        </div>
        {signalBadge}
      </div>
    );
  }

  const { payload, flash } = view;

  // Empty roster → idle screen (polling continues underneath).
  if (payload.players.length === 0) {
    return (
      <div className={styles.root}>
        <Header payload={payload} wakeHeld={wakeHeld} showHint={showHint} />
        <main className={`${styles.main} ${styles.mainSingle}`}>
          <IdleScreen events={payload.events} />
        </main>
        {signalBadge}
        <Overlays overlay={overlay} />
      </div>
    );
  }

  const mainClass =
    payload.tvMode === "BLOOD_STAGE"
      ? `${styles.main} ${styles.mainStage}`
      : payload.tvMode === "LIVE_EVENT"
        ? `${styles.main} ${styles.mainLive}`
        : `${styles.main} ${styles.mainBoard}`;

  const sidebarClass =
    payload.tvMode === "LIVE_EVENT" ? `${styles.sidebar} ${styles.sidebarLive}` : styles.sidebar ?? "";

  return (
    <div className={styles.root}>
      <Header payload={payload} wakeHeld={wakeHeld} showHint={showHint} />
      <main className={mainClass}>
        {payload.tvMode === "BLOOD_STAGE" ? (
          <DanceStage payload={payload} />
        ) : (
          <>
            <Leaderboard payload={payload} flash={flash} />
            <aside className={sidebarClass}>
              <Spotlight payload={payload} expanded={payload.tvMode === "LIVE_EVENT"} />
              <JudgmentFeed decrees={payload.decrees} />
            </aside>
          </>
        )}
      </main>
      {signalBadge}
      <Overlays overlay={overlay} />
    </div>
  );
}
