"use client";

/** Tab 1 — ⚡ Quick Decree ("The Dumbledore Wand"), PRD §4.1. */

import { useCallback, useEffect, useState } from "react";
import type { DecreeRow } from "@/lib/types";
import { SIN_TAGS } from "@/lib/constants";
import { fmtDayTime, fmtSigned } from "@/lib/format";
import styles from "./admin.module.css";
import { useAdmin, type DecreesRes } from "./shared";
import { Avatar, Sheet } from "./ui";

const QUICK_DELTAS: readonly number[] = [-10, -5, -3, -2, -1, 1, 2, 3, 5, 10];

export default function DecreeTab() {
  const { state, mutate, request, toast } = useAdmin();
  const activePlayers = state.players.filter((p) => p.isActive);

  // ---- form state ----
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [quick, setQuick] = useState<number | null>(null);
  const [customText, setCustomText] = useState("");
  const [sinChip, setSinChip] = useState<string | null>(null);
  const [sinCustom, setSinCustom] = useState("");
  const [reason, setReason] = useState("");
  const [casting, setCasting] = useState(false);

  const typed = customText.trim();
  let delta: number | null = quick;
  if (typed !== "") {
    const n = Number(typed.replace(",", "."));
    delta = Number.isFinite(n) && n !== 0 ? n : null;
  }
  const sin = sinCustom.trim() !== "" ? sinCustom.trim() : sinChip;
  const canCast =
    selected.size > 0 && delta !== null && sin !== null && reason.trim() !== "" && !casting;

  const togglePlayer = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cast = async () => {
    if (!canCast || delta === null || sin === null) return;
    setCasting(true);
    const r = await mutate("/api/decrees", {
      playerIds: Array.from(selected),
      pointsDelta: delta,
      sinTag: sin.slice(0, 30),
      reason: reason.trim(),
    });
    setCasting(false);
    if (r.ok) {
      toast("ok", "⚡ JUDGMENT CAST");
      setSelected(new Set());
      setQuick(null);
      setCustomText("");
      setSinChip(null);
      setSinCustom("");
      setReason("");
      void loadHistory();
    }
  };

  // ---- full history (authed GET, newest first) ----
  const [history, setHistory] = useState<DecreeRow[] | null>(null);
  const loadHistory = useCallback(async () => {
    try {
      const res = await request<DecreesRes>("/api/decrees", { silent: true, background: true });
      setHistory(res.decrees);
    } catch {
      /* offline badge / login gate cover this */
    }
  }, [request]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, state.version]);

  const [editing, setEditing] = useState<DecreeRow | null>(null);

  const toggleVoid = async (row: DecreeRow) => {
    const r = await mutate(`/api/decrees/${row.id}`, { isVoided: !row.isVoided }, { method: "PATCH" });
    if (r.ok) toast("ok", row.isVoided ? "Decree restored" : "Decree voided");
  };

  return (
    <div className={styles.stack}>
      <h2 className={styles.sectionTitle}>The accused ({selected.size} chosen)</h2>
      <div className={styles.avatarGrid}>
        {activePlayers.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`${styles.avatarBtn} ${selected.has(p.id) ? styles.avatarSel : ""}`}
            aria-pressed={selected.has(p.id)}
            onClick={() => togglePlayer(p.id)}
          >
            <Avatar name={p.name} />
            <span className={styles.avatarName}>{p.name}</span>
          </button>
        ))}
        {activePlayers.length === 0 ? (
          <p className={styles.muted}>No active tributes — add them in Roster.</p>
        ) : null}
      </div>

      <h2 className={styles.sectionTitle}>The judgment</h2>
      <div
        className={`${styles.deltaDisplay} ${
          delta === null ? styles.deltaNone : delta > 0 ? styles.deltaPos : styles.deltaNeg
        }`}
      >
        {delta === null ? "±0" : fmtSigned(delta)}
      </div>
      <div className={styles.stepperRow}>
        {QUICK_DELTAS.map((d) => (
          <button
            key={d}
            type="button"
            className={`${styles.btn} ${styles.stepBtn} ${d < 0 ? styles.stepNeg : styles.stepPos} ${
              typed === "" && quick === d ? styles.stepSel : ""
            }`}
            onClick={() => {
              setQuick(d);
              setCustomText("");
            }}
          >
            {fmtSigned(d)}
          </button>
        ))}
      </div>
      <input
        className={`${styles.input} ${styles.numInput}`}
        inputMode="decimal"
        placeholder="Custom points (use - to deduct)"
        value={customText}
        onChange={(e) => setCustomText(e.target.value)}
        aria-label="Custom points delta"
      />

      <h2 className={styles.sectionTitle}>The sin</h2>
      <div className={styles.chipRow}>
        {SIN_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            className={`${styles.chip} ${sinCustom.trim() === "" && sinChip === tag ? styles.chipOn : ""}`}
            aria-pressed={sinCustom.trim() === "" && sinChip === tag}
            onClick={() => {
              setSinChip(tag);
              setSinCustom("");
            }}
          >
            {tag}
          </button>
        ))}
      </div>
      <input
        className={styles.input}
        maxLength={30}
        placeholder="Custom sin (overrides the chips)"
        value={sinCustom}
        onChange={(e) => setSinCustom(e.target.value)}
        aria-label="Custom sin tag"
      />

      <h2 className={styles.sectionTitle}>The reason</h2>
      <textarea
        className={`${styles.input} ${styles.textarea}`}
        maxLength={300}
        placeholder='e.g. "Dropped a stubby on the deck"'
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-label="Decree reason"
      />

      <button
        type="button"
        className={`${styles.btn} ${styles.btnGold} ${styles.castBtn}`}
        disabled={!canCast}
        onClick={() => void cast()}
      >
        ⚡ CAST DECREE
      </button>

      <h2 className={styles.sectionTitle}>Scroll of Judgment — full history</h2>
      {history === null ? (
        <p className={styles.muted}>Unrolling the scroll…</p>
      ) : history.length === 0 ? (
        <p className={styles.muted}>No judgments yet. The Creek watches.</p>
      ) : (
        <div>
          {history.map((row) => (
            <div key={row.id} className={`${styles.histRow} ${row.isVoided ? styles.histVoided : ""}`}>
              <div className={styles.histTop}>
                <span
                  className={`${styles.histDelta} ${row.pointsDelta > 0 ? styles.deltaPos : styles.deltaNeg}`}
                >
                  {fmtSigned(row.pointsDelta)}
                </span>
                <span className={styles.histName}>{row.playerName}</span>
                <span className={styles.histSin}>{row.sinTag}</span>
                {row.isVoided ? <span className={styles.voidTag}>VOIDED</span> : null}
              </div>
              <div className={styles.histReason}>{row.reason}</div>
              <div className={styles.histMeta}>{fmtDayTime(row.createdAt)}</div>
              <div className={styles.histActions}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSmall} ${styles.grow}`}
                  onClick={() => setEditing(row)}
                >
                  EDIT
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSmall} ${styles.grow} ${
                    row.isVoided ? "" : styles.btnOutlineCrimson
                  }`}
                  onClick={() => void toggleVoid(row)}
                >
                  {row.isVoided ? "UNVOID" : "VOID"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing !== null ? (
        <DecreeEditSheet key={editing.id} row={editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

/** Bottom-sheet editor for one decree (change player, points, sin, reason). */
function DecreeEditSheet({ row, onClose }: { row: DecreeRow; onClose: () => void }) {
  const { state, mutate, toast } = useAdmin();
  const [playerId, setPlayerId] = useState(row.playerId);
  const [deltaText, setDeltaText] = useState(String(row.pointsDelta));
  const [sin, setSin] = useState(row.sinTag);
  const [reason, setReason] = useState(row.reason);
  const [saving, setSaving] = useState(false);

  const n = Number(deltaText.trim().replace(",", "."));
  const valid =
    Number.isFinite(n) && n !== 0 && sin.trim() !== "" && reason.trim() !== "" && !saving;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const r = await mutate(
      `/api/decrees/${row.id}`,
      { playerId, pointsDelta: n, sinTag: sin.trim().slice(0, 30), reason: reason.trim() },
      { method: "PATCH" },
    );
    setSaving(false);
    if (r.ok) {
      toast("ok", "Decree amended");
      onClose();
    }
  };

  return (
    <Sheet open title={`Amend decree #${row.id}`} onClose={onClose}>
      <div className={styles.stack}>
        <label className={styles.label} htmlFor="decree-edit-player">
          Tribute
        </label>
        <select
          id="decree-edit-player"
          className={`${styles.input} ${styles.select}`}
          value={playerId}
          onChange={(e) => setPlayerId(Number(e.target.value))}
        >
          {state.players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <label className={styles.label} htmlFor="decree-edit-delta">
          Points delta
        </label>
        <input
          id="decree-edit-delta"
          className={`${styles.input} ${styles.numInput}`}
          inputMode="decimal"
          value={deltaText}
          onChange={(e) => setDeltaText(e.target.value)}
        />

        <label className={styles.label} htmlFor="decree-edit-sin">
          Sin
        </label>
        <div className={styles.chipRow}>
          {SIN_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`${styles.chip} ${sin === tag ? styles.chipOn : ""}`}
              onClick={() => setSin(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
        <input
          id="decree-edit-sin"
          className={styles.input}
          maxLength={30}
          value={sin}
          onChange={(e) => setSin(e.target.value)}
        />

        <label className={styles.label} htmlFor="decree-edit-reason">
          Reason
        </label>
        <textarea
          id="decree-edit-reason"
          className={`${styles.input} ${styles.textarea}`}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        <div className={styles.sheetActions}>
          <button type="button" className={`${styles.btn} ${styles.grow}`} onClick={onClose}>
            CANCEL
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGold} ${styles.grow}`}
            disabled={!valid}
            onClick={() => void save()}
          >
            {saving ? "AMENDING…" : "SAVE"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
