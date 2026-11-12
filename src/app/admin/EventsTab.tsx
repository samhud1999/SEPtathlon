"use client";

/** Tab 2 — 🏆 Event Score Input & Amendment Matrix (PRD §4.2). */

import { useState } from "react";
import type { EventStatus } from "@/lib/types";
import { EVENT_STATUSES } from "@/lib/constants";
import styles from "./admin.module.css";
import { useAdmin } from "./shared";
import { Seg } from "./ui";
import GuidedElimination from "./GuidedElimination";
import GuidedRawHigh from "./GuidedRawHigh";
import GuidedFruit from "./GuidedFruit";
import GuidedBlood from "./GuidedBlood";
import GodModeTable from "./GodModeTable";

type Mode = "guided" | "god";

export default function EventsTab() {
  const { state, mutate } = useAdmin();
  const [eventId, setEventId] = useState<number>(() => state.liveEventId ?? 1);
  const [mode, setMode] = useState<Mode>("guided");

  const event = state.events.find((e) => e.id === eventId) ?? state.events[0];
  if (!event) return <p className={styles.muted}>The events have not been seeded yet.</p>;

  const isBlood = event.scoringType === "BLOOD_MATRIX";

  const setStatus = (status: EventStatus) => {
    if (status === event.status) return;
    void mutate(`/api/events/${event.id}/status`, { status });
  };

  return (
    <div className={styles.stack}>
      <label className={styles.label} htmlFor="event-picker">
        Event
      </label>
      <select
        id="event-picker"
        className={`${styles.input} ${styles.select}`}
        value={event.id}
        onChange={(e) => setEventId(Number(e.target.value))}
      >
        {state.events.map((e) => (
          <option key={e.id} value={e.id}>
            E{e.id} · {e.name} — {e.sin}
          </option>
        ))}
      </select>

      <Seg<EventStatus>
        ariaLabel="Event status"
        options={EVENT_STATUSES.map((s) => ({ value: s, label: s }))}
        value={event.status}
        onChange={setStatus}
      />

      {!isBlood ? (
        <Seg<Mode>
          ariaLabel="Entry mode"
          options={[
            { value: "guided", label: "Guided" },
            { value: "god", label: "God-mode" },
          ]}
          value={mode}
          onChange={setMode}
        />
      ) : null}

      {isBlood ? (
        <GuidedBlood />
      ) : mode === "god" ? (
        <GodModeTable key={event.id} event={event} />
      ) : event.scoringType === "ELIMINATION" ? (
        <GuidedElimination key={event.id} event={event} />
      ) : event.scoringType === "FRUIT_SPLIT" ? (
        <GuidedFruit key={event.id} event={event} />
      ) : (
        <GuidedRawHigh key={event.id} event={event} />
      )}
    </div>
  );
}
