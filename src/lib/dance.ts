/**
 * Dance on the Creek helpers (event 7). A duo is a `blood_matchups` row; its
 * 0–10 score lives in every seat's delta and `isRevealed` means "scored".
 */

import type { BloodMatchupPublic, TvMode } from "./types";

/** The duo's score once locked in (seat A's delta), null while awaiting. */
export function duoScore(m: BloodMatchupPublic): number | null {
  return m.isRevealed ? (m.players[0]?.delta ?? 0) : null;
}

/** "Davo & Gazza" · "Davo, Gazza & Spud". */
export function duoNames(m: BloodMatchupPublic): string {
  const names = m.players.map((p) => p.name);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** User-facing names for the persisted TV modes (the enum values are frozen). */
export const TV_MODE_LABEL: Readonly<Record<TvMode, string>> = {
  LEADERBOARD: "Leaderboard",
  LIVE_EVENT: "Live event",
  BLOOD_STAGE: "Dance stage",
};
