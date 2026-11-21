"use client";

/**
 * Tab 4 — 💾 System & Backups (PRD §4.4): TV remote, export/snapshots/restore
 * (typed-confirm, crimson, never one-tap), health readout, logout.
 */

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import type { TvMode } from "@/lib/types";
import { TV_MODE_LABEL } from "@/lib/dance";
import { fmtDayTime } from "@/lib/format";
import styles from "./admin.module.css";
import { fmtBytes, useAdmin, type SnapshotMeta, type SnapshotsRes } from "./shared";
import { ArmButton, Sheet } from "./ui";

const TV_BUTTONS: ReadonlyArray<{ mode: TvMode; icon: string; label: string }> = [
  { mode: "LEADERBOARD", icon: "🏆", label: "LEADERBOARD" },
  { mode: "LIVE_EVENT", icon: "🎯", label: "LIVE EVENT" },
  { mode: "BLOOD_STAGE", icon: "💃", label: "DANCE STAGE" },
];

export default function SystemTab() {
  const { state, mutate, request, toast, offline } = useAdmin();
  const router = useRouter();

  // ---- snapshots ----
  const [snaps, setSnaps] = useState<SnapshotMeta[] | null>(null);
  const loadSnaps = useCallback(async () => {
    try {
      const res = await request<SnapshotsRes>("/api/snapshots", { silent: true, background: true });
      setSnaps(res.snapshots);
    } catch {
      /* covered by offline badge / login gate */
    }
  }, [request]);

  useEffect(() => {
    void loadSnaps();
  }, [loadSnaps, state.version]);

  const [note, setNote] = useState("");
  const snapNow = async () => {
    const trimmed = note.trim();
    const r = await mutate("/api/snapshots", trimmed === "" ? {} : { note: trimmed.slice(0, 200) });
    if (r.ok) {
      setNote("");
      toast("ok", "Snapshot sealed");
      void loadSnaps();
    }
  };

  const [restoreTarget, setRestoreTarget] = useState<SnapshotMeta | null>(null);

  // ---- restore from file ----
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileDump, setFileDump] = useState<unknown>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileErr(null);
    setFileDump(null);
    setConfirmText("");
    setFileName(file.name);
    try {
      const text = await file.text();
      setFileDump(JSON.parse(text) as unknown);
    } catch {
      setFileErr("That file is not valid JSON — the Creek rejects it.");
    }
  };

  const summary = summarize(fileDump);

  const restoreFromFile = async () => {
    if (confirmText !== "RESTORE" || fileDump == null || restoring) return;
    setRestoring(true);
    const r = await mutate("/api/restore", { confirm: "RESTORE", dump: fileDump });
    setRestoring(false);
    if (r.ok) {
      toast("ok", "The Creek is restored");
      setFileDump(null);
      setFileName(null);
      setConfirmText("");
      void loadSnaps();
    }
  };

  const logout = async () => {
    try {
      await request("/api/logout", { method: "POST", silent: true });
    } catch {
      /* clear-cookie failures still fall through to the gate */
    }
    router.refresh();
  };

  return (
    <div className={styles.stack}>
      <h2 className={styles.sectionTitle}>TV remote — current: {TV_MODE_LABEL[state.tvMode]}</h2>
      <div className={styles.tvBtns}>
        {TV_BUTTONS.map((b) => (
          <button
            key={b.mode}
            type="button"
            className={`${styles.btn} ${styles.tvBtn} ${state.tvMode === b.mode ? styles.btnGold : ""}`}
            aria-pressed={state.tvMode === b.mode}
            onClick={() => void mutate("/api/tv-mode", { mode: b.mode })}
          >
            {b.icon} {b.label}
          </button>
        ))}
      </div>

      <h2 className={styles.sectionTitle}>Backups</h2>
      <div className={styles.panel}>
        <div className={styles.stack}>
          <a className={`${styles.btn}`} href="/api/export" download>
            ⤓ EXPORT FULL JSON
          </a>
          <div className={styles.row}>
            <input
              className={`${styles.input} ${styles.grow}`}
              maxLength={200}
              placeholder="Snapshot note (optional)"
              aria-label="Snapshot note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button type="button" className={`${styles.btn}`} onClick={() => void snapNow()}>
              📸 SNAP
            </button>
          </div>
        </div>
      </div>

      {snaps === null ? (
        <p className={styles.muted}>Fetching the vault…</p>
      ) : snaps.length === 0 ? (
        <p className={styles.muted}>No snapshots yet.</p>
      ) : (
        <div>
          {snaps.map((s) => (
            <div key={s.id} className={styles.snapRow}>
              <span className={styles.grow}>
                <span className={`${styles.mono}`}>{fmtDayTime(s.createdAt)}</span>
                <br />
                <span className={styles.fine}>
                  {s.note !== null && s.note !== "" ? `${s.note} · ` : ""}
                  {fmtBytes(s.bytes)}
                </span>
              </span>
              <a
                className={`${styles.btn} ${styles.btnSmall}`}
                href={`/api/snapshots/${s.id}`}
                download
              >
                ⤓
              </a>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSmall} ${styles.btnOutlineCrimson}`}
                onClick={() => setRestoreTarget(s)}
              >
                RESTORE
              </button>
            </div>
          ))}
        </div>
      )}

      <h2 className={styles.sectionTitle}>Restore from file</h2>
      <div className={styles.panel}>
        <div className={styles.stack}>
          <label className={`${styles.btn}`}>
            📂 CHOOSE EXPORT FILE
            <input
              type="file"
              accept=".json,application/json"
              className={styles.hiddenFile}
              onChange={(e) => void onFile(e)}
            />
          </label>
          {fileName !== null ? <p className={styles.muted}>{fileName}</p> : null}
          {fileErr !== null ? <p className={styles.danger}>{fileErr}</p> : null}
          {summary !== null ? (
            <>
              <div className={styles.fileSummary}>
                <span>
                  Players: <span className={styles.mono}>{summary.players}</span> · Results:{" "}
                  <span className={styles.mono}>{summary.results}</span>
                </span>
                <span>
                  Decrees: <span className={styles.mono}>{summary.decrees}</span> · Matchups:{" "}
                  <span className={styles.mono}>{summary.matchups}</span>
                </span>
                {summary.exportedAt !== null ? (
                  <span>Exported: {fmtDayTime(summary.exportedAt)}</span>
                ) : null}
              </div>
              <p className={`${styles.danger} ${styles.muted}`}>
                This wipes the live tournament and replaces it with the file. A pre-restore
                snapshot is taken first. Type RESTORE to arm.
              </p>
              <input
                className={styles.input}
                placeholder='Type "RESTORE"'
                aria-label="Type RESTORE to confirm"
                autoCapitalize="characters"
                autoComplete="off"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
              />
              <button
                type="button"
                className={`${styles.btn} ${styles.btnCrimson}`}
                disabled={confirmText !== "RESTORE" || restoring}
                onClick={() => void restoreFromFile()}
              >
                {restoring ? "RESTORING…" : "⚠ RESTORE FROM FILE"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      <h2 className={styles.sectionTitle}>Health</h2>
      <div className={styles.panel}>
        <div className={styles.healthGrid}>
          <span className={styles.healthKey}>State version</span>
          <span className={styles.mono}>v{state.version}</span>
          <span className={styles.healthKey}>Server time</span>
          <span className={styles.mono}>{fmtDayTime(state.serverTime)}</span>
          <span className={styles.healthKey}>Poll</span>
          <span className={offline ? styles.danger : styles.ok}>
            {offline ? "SIGNAL LOST — RECONNECTING" : "LIVE · every 5 s"}
          </span>
          <span className={styles.healthKey}>Live event</span>
          <span className={styles.mono}>
            {state.liveEventId != null ? `E${state.liveEventId}` : "—"}
          </span>
        </div>
      </div>

      <ArmButton
        label="LOG OUT"
        armedLabel="TAP AGAIN TO LEAVE"
        className={styles.btnOutlineCrimson}
        onFire={() => void logout()}
      />

      {restoreTarget !== null ? (
        <SnapshotRestoreSheet
          key={restoreTarget.id}
          snap={restoreTarget}
          onClose={() => setRestoreTarget(null)}
          onDone={() => void loadSnaps()}
        />
      ) : null}
    </div>
  );
}

/** Typed-confirm sheet for restoring a stored snapshot. */
function SnapshotRestoreSheet({
  snap,
  onClose,
  onDone,
}: {
  snap: SnapshotMeta;
  onClose: () => void;
  onDone: () => void;
}) {
  const { mutate, toast } = useAdmin();
  const [text, setText] = useState("");
  const [working, setWorking] = useState(false);

  const fire = async () => {
    if (text !== "RESTORE" || working) return;
    setWorking(true);
    const r = await mutate(`/api/snapshots/${snap.id}/restore`, { confirm: "RESTORE" });
    setWorking(false);
    if (r.ok) {
      toast("ok", "Snapshot restored");
      onDone();
      onClose();
    }
  };

  return (
    <Sheet open title={`Restore snapshot #${snap.id}`} onClose={onClose}>
      <div className={styles.stack}>
        <p className={styles.muted}>
          {fmtDayTime(snap.createdAt)}
          {snap.note !== null && snap.note !== "" ? ` — ${snap.note}` : ""} ({fmtBytes(snap.bytes)})
        </p>
        <p className={styles.danger}>
          This rolls the whole tournament back to that moment. A pre-restore snapshot is taken
          first. Type RESTORE to arm.
        </p>
        <input
          className={styles.input}
          placeholder='Type "RESTORE"'
          aria-label="Type RESTORE to confirm"
          autoCapitalize="characters"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className={styles.sheetActions}>
          <button type="button" className={`${styles.btn} ${styles.grow}`} onClick={onClose}>
            CANCEL
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnCrimson} ${styles.grow}`}
            disabled={text !== "RESTORE" || working}
            onClick={() => void fire()}
          >
            {working ? "RESTORING…" : "⚠ RESTORE"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function summarize(d: unknown): {
  players: number;
  results: number;
  decrees: number;
  matchups: number;
  exportedAt: string | null;
} | null {
  if (typeof d !== "object" || d === null) return null;
  const o = d as Record<string, unknown>;
  const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
  return {
    players: len(o["players"]),
    results: len(o["eventResults"]),
    decrees: len(o["decrees"]),
    matchups: len(o["bloodMatchups"]),
    exportedAt: typeof o["exportedAt"] === "string" ? o["exportedAt"] : null,
  };
}
