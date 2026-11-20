import type { EventInfo } from "./types";

/**
 * The event the TV should tease as "next". Events can run in any order: the
 * commissioner marks one as NEXT; without that, fall back to the
 * lowest-numbered event that has not run yet.
 */
export function nextEvent(events: ReadonlyArray<EventInfo>): EventInfo | null {
  const marked = events.find((e) => e.status === "NEXT");
  if (marked) return marked;
  return [...events].filter((e) => e.status === "UPCOMING").sort((a, b) => a.id - b.id)[0] ?? null;
}
