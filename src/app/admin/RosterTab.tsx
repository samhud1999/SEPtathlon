"use client";

/**
 * Tab 3 — 👥 Roster & Jokers (PRD §4.3): add tributes, inline rename/epithet,
 * active toggle, joker placement (with the 409 → force move flow), curse
 * stepper, grand totals from the leaderboard.
 */

import { useState } from "react";
import type { PlayerInfo } from "@/lib/types";
import { CURSE_LEVELS, MAX_CURSE_LEVEL } from "@/lib/constants";
import { fmtPts } from "@/lib/format";
import styles from "./admin.module.css";
import { useAdmin, useJoker } from "./shared";
import { Avatar } from "./ui";

const JOKER_EVENTS = [1, 2, 3, 4, 5, 6] as const;

export default function RosterTab() {
  const { state, mutate, toast } = useAdmin();
  const [name, setName] = useState("");
  const [epithet, setEpithet] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const totals = new Map(state.leaderboard.map((l) => [l.playerId, l.total]));
  const active = state.players.filter((p) => p.isActive);
  const benched = state.players.filter((p) => !p.isActive);

  const add = async () => {
    const trimmed = name.trim();
    if (trimmed === "" || adding) return;
    setAdding(true);
    const body: { action: "create"; name: string; epithet?: string } = {
      action: "create",
      name: trimmed.slice(0, 50),
    };
    const e = epithet.trim();
    if (e !== "") body.epithet = e.slice(0, 100);
    const r = await mutate("/api/players", body);
    setAdding(false);
    if (r.ok) {
      setName("");
      setEpithet("");
      toast("ok", `${trimmed} joins the Creek`);
    }
  };

  return (
    <div className={styles.stack}>
      <h2 className={styles.sectionTitle}>Add a tribute</h2>
      <div className={styles.panel}>
        <div className={styles.stack}>
          <input
            className={styles.input}
            maxLength={50}
            placeholder="Name (required)"
            aria-label="New tribute name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={styles.input}
            maxLength={100}
            placeholder='Epithet, e.g. "Keeper of the Esky" (optional)'
            aria-label="New tribute epithet"
            value={epithet}
            onChange={(e) => setEpithet(e.target.value)}
          />
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGold}`}
            disabled={name.trim() === "" || adding}
            onClick={() => void add()}
          >
            {adding ? "SUMMONING…" : "＋ ADD TRIBUTE"}
          </button>
        </div>
      </div>

      <h2 className={styles.sectionTitle}>Tributes ({active.length})</h2>
      {active.map((p) => (
        <PlayerRow
          key={p.id}
          p={p}
          total={totals.get(p.id)}
          open={openId === p.id}
          onToggle={() => setOpenId(openId === p.id ? null : p.id)}
        />
      ))}
      {active.length === 0 ? <p className={styles.muted}>The Sanctum stands empty.</p> : null}

      {benched.length > 0 ? (
        <>
          <h2 className={`${styles.sectionTitle} ${styles.danger}`}>Benched ({benched.length})</h2>
          {benched.map((p) => (
            <PlayerRow
              key={p.id}
              p={p}
              total={totals.get(p.id)}
              open={openId === p.id}
              onToggle={() => setOpenId(openId === p.id ? null : p.id)}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

function PlayerRow({
  p,
  total,
  open,
  onToggle,
}: {
  p: PlayerInfo;
  total: number | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const { mutate, toast } = useAdmin();
  const joker = useJoker();
  const [nameText, setNameText] = useState(p.name);
  const [epithetText, setEpithetText] = useState(p.epithet);
  const [saving, setSaving] = useState(false);

  const namesDirty = nameText.trim() !== p.name || epithetText.trim() !== p.epithet;

  const saveNames = async () => {
    const n = nameText.trim();
    if (n === "" || saving) return;
    setSaving(true);
    const body: { action: "update"; playerId: number; name?: string; epithet?: string } = {
      action: "update",
      playerId: p.id,
    };
    if (n !== p.name) body.name = n.slice(0, 50);
    const e = epithetText.trim();
    if (e !== "" && e !== p.epithet) body.epithet = e.slice(0, 100);
    const r = await mutate("/api/players", body);
    setSaving(false);
    if (r.ok) toast("ok", "Tribute renamed");
  };

  const toggleActive = () =>
    void mutate("/api/players", { action: "update", playerId: p.id, isActive: !p.isActive });

  const setCurse = (level: number) =>
    void mutate("/api/players", {
      action: "update",
      playerId: p.id,
      rockCurseLevel: Math.min(MAX_CURSE_LEVEL, Math.max(0, level)),
    });

  const pickJoker = (eventId: number) => {
    if (p.jokerEventId === eventId) return;
    void joker.setJoker(p.id, eventId, p.jokerEventId, true);
  };

  const clearJoker = () => {
    if (p.jokerEventId == null) return;
    void joker.setJoker(p.id, p.jokerEventId, p.jokerEventId, false);
  };

  return (
    <div className={`${styles.playerCard} ${p.isActive ? "" : styles.cardDim}`}>
      <button type="button" className={styles.rowMain} onClick={onToggle} aria-expanded={open}>
        <Avatar name={p.name} size={44} />
        <span className={styles.rowInfo}>
          <span className={styles.rowName}>{p.name}</span>
          <span className={styles.rowEpithet}>{p.epithet}</span>
          <span className={styles.rowBadges}>
            {p.jokerEventId != null ? (
              <span className={styles.matchTag}>🃏 E{p.jokerEventId}</span>
            ) : null}
            {p.rockCurseLevel > 0 ? (
              <span className={styles.matchTag}>
                🪨 {CURSE_LEVELS[p.rockCurseLevel] ?? p.rockCurseLevel}
              </span>
            ) : null}
          </span>
        </span>
        <span className={styles.rowTotal}>{total !== undefined ? fmtPts(total) : "—"}</span>
      </button>

      {open ? (
        <div className={styles.editor}>
          <input
            className={styles.input}
            maxLength={50}
            aria-label={`Rename ${p.name}`}
            value={nameText}
            onChange={(e) => setNameText(e.target.value)}
          />
          <input
            className={styles.input}
            maxLength={100}
            aria-label={`${p.name} epithet`}
            value={epithetText}
            onChange={(e) => setEpithetText(e.target.value)}
          />
          <div className={styles.row}>
            <button
              type="button"
              className={`${styles.btn} ${styles.grow} ${styles.btnGold}`}
              disabled={!namesDirty || nameText.trim() === "" || saving}
              onClick={() => void saveNames()}
            >
              {saving ? "SAVING…" : "SAVE NAMES"}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.grow} ${p.isActive ? styles.btnOutlineCrimson : ""}`}
              onClick={toggleActive}
            >
              {p.isActive ? "BENCH" : "RESTORE"}
            </button>
          </div>

          <span className={styles.label}>🃏 Mortal Sin Joker</span>
          <div className={`${styles.row} ${styles.wrap}`}>
            <button
              type="button"
              className={`${styles.chip} ${p.jokerEventId == null ? styles.chipOn : ""}`}
              aria-pressed={p.jokerEventId == null}
              onClick={clearJoker}
            >
              None
            </button>
            {JOKER_EVENTS.map((eid) => (
              <button
                key={eid}
                type="button"
                className={`${styles.chip} ${p.jokerEventId === eid ? styles.chipOn : ""}`}
                aria-pressed={p.jokerEventId === eid}
                onClick={() => pickJoker(eid)}
              >
                E{eid}
              </button>
            ))}
          </div>
          {joker.conflict ? (
            <div className={styles.inlineConfirm}>
              <span className={styles.grow}>
                Joker already on E{joker.conflict.fromEventId} — move it to E
                {joker.conflict.toEventId}?
              </span>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSmall} ${styles.btnGold}`}
                onClick={() => void joker.force()}
              >
                MOVE IT
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={joker.cancel}>
                KEEP
              </button>
            </div>
          ) : null}

          <span className={styles.label}>🪨 Rock Hurl curse</span>
          <div className={styles.row}>
            <span className={`${styles.curseLabel} ${styles.grow}`}>
              <span className={p.rockCurseLevel > 0 ? styles.curseVal : undefined}>
                {CURSE_LEVELS[p.rockCurseLevel] ?? "Clean"}
              </span>
            </span>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSquare}`}
              disabled={p.rockCurseLevel <= 0}
              aria-label={`Lower ${p.name} curse`}
              onClick={() => setCurse(p.rockCurseLevel - 1)}
            >
              −
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSquare}`}
              disabled={p.rockCurseLevel >= MAX_CURSE_LEVEL}
              aria-label={`Raise ${p.name} curse`}
              onClick={() => setCurse(p.rockCurseLevel + 1)}
            >
              +
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
