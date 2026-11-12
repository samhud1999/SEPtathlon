"use client";

/**
 * Shared admin plumbing: the AdminApp context, API call result shapes for the
 * admin-only endpoints, and small pure helpers used across the tabs.
 */

import { createContext, useContext, useState } from "react";
import type { BloodMatchupPublic, DecreeRow, Standing, StatePayload } from "@/lib/types";

/** Error carrying the HTTP status so flows like the joker 409 can branch. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type ToastKind = "ok" | "error";

export interface RequestOpts {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Suppress the automatic error toast (the caller handles the failure). */
  silent?: boolean;
  /** Skip the global busy indicator (debounced previews, background loads). */
  background?: boolean;
}

export type MutateResult = { ok: true } | { ok: false; status: number; message: string };

export interface AdminApi {
  state: StatePayload;
  busy: boolean;
  offline: boolean;
  /** Raw JSON call. Toasts errors (unless silent), 401 → back to login, throws ApiError. */
  request: <T>(path: string, opts?: RequestOpts) => Promise<T>;
  /**
   * Mutator call (POST default). The response body is a fresh StatePayload and
   * replaces local state immediately. Never throws — inspect the result.
   */
  mutate: (
    path: string,
    body?: unknown,
    opts?: { method?: "POST" | "PATCH" | "DELETE"; silent?: boolean },
  ) => Promise<MutateResult>;
  toast: (kind: ToastKind, text: string) => void;
}

export const AdminContext = createContext<AdminApi | null>(null);

export function useAdmin(): AdminApi {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used inside <AdminApp/>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Admin-only endpoint response shapes (not part of StatePayload)
// ---------------------------------------------------------------------------

export interface DecreesRes {
  decrees: DecreeRow[];
}

/** Same seats shape as StatePayload's matchups, but with REAL card values. */
export interface MatchupsRes {
  matchups: BloodMatchupPublic[];
}

export interface PreviewRes {
  standings: Standing[];
}

export interface SnapshotMeta {
  id: number;
  createdAt: string;
  note: string | null;
  bytes: number;
}

export interface SnapshotsRes {
  snapshots: SnapshotMeta[];
}

// ---------------------------------------------------------------------------
// Runtime guards
// ---------------------------------------------------------------------------

export function isStatePayload(x: unknown): x is StatePayload {
  return (
    typeof x === "object" &&
    x !== null &&
    "version" in x &&
    "leaderboard" in x &&
    "eventResults" in x
  );
}

export function isErrorBody(x: unknown): x is { error: string } {
  return (
    typeof x === "object" &&
    x !== null &&
    "error" in x &&
    typeof (x as { error: unknown }).error === "string"
  );
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "?";
  const second = parts.length > 1 ? (parts[1]?.charAt(0) ?? "") : "";
  return (first + second).toUpperCase();
}

export function playerNameOf(state: StatePayload, playerId: number): string {
  return state.players.find((p) => p.id === playerId)?.name ?? `#${playerId}`;
}

/** Ranks that occur more than once (drives "T-3rd" labels). */
export function tiedRanks(ranks: ReadonlyArray<number | null>): Set<number> {
  const seen = new Map<number, number>();
  for (const r of ranks) {
    if (r != null) seen.set(r, (seen.get(r) ?? 0) + 1);
  }
  const out = new Set<number>();
  for (const [r, n] of seen) {
    if (n > 1) out.add(r);
  }
  return out;
}

/** Parse a user-typed number. "" → null (explicit clear); invalid → undefined. */
export function parseNum(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Joker placement flow (shared by Events raw rows + Roster): handles the 409
// "joker already on another event" conflict with an inline confirm + force.
// ---------------------------------------------------------------------------

export interface JokerConflict {
  playerId: number;
  toEventId: number;
  fromEventId: number;
}

export function useJoker() {
  const { mutate, toast } = useAdmin();
  const [conflict, setConflict] = useState<JokerConflict | null>(null);

  /** Place (active:true) or clear (active:false) a joker on `eventId`. */
  const setJoker = async (
    playerId: number,
    eventId: number,
    currentEventId: number | null,
    active: boolean,
  ): Promise<boolean> => {
    const r = await mutate(`/api/events/${eventId}/joker`, { playerId, active }, { silent: true });
    if (!r.ok) {
      if (r.status === 409 && currentEventId != null) {
        setConflict({ playerId, toEventId: eventId, fromEventId: currentEventId });
      } else {
        toast("error", r.message);
      }
      return false;
    }
    return true;
  };

  /** Confirm the pending move: retry with force:true. */
  const force = async (): Promise<void> => {
    if (!conflict) return;
    const r = await mutate(
      `/api/events/${conflict.toEventId}/joker`,
      { playerId: conflict.playerId, active: true, force: true },
      { silent: true },
    );
    if (!r.ok) toast("error", r.message);
    setConflict(null);
  };

  const cancel = (): void => setConflict(null);

  return { conflict, setJoker, force, cancel };
}
