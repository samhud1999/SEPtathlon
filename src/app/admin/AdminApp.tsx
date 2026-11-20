"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StatePayload } from "@/lib/types";
import styles from "./admin.module.css";
import {
  AdminContext,
  ApiError,
  isErrorBody,
  isStatePayload,
  type AdminApi,
  type MutateResult,
  type RequestOpts,
  type ToastKind,
} from "./shared";
import DecreeTab from "./DecreeTab";
import EventsTab from "./EventsTab";
import RosterTab from "./RosterTab";
import SystemTab from "./SystemTab";

type Tab = "decree" | "events" | "roster" | "system";

const TABS: ReadonlyArray<{ id: Tab; icon: string; label: string }> = [
  { id: "decree", icon: "⚡", label: "Decree" },
  { id: "events", icon: "🏆", label: "Events" },
  { id: "roster", icon: "👥", label: "Roster" },
  { id: "system", icon: "💾", label: "System" },
];

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

export default function AdminApp() {
  const router = useRouter();
  const [state, setState] = useState<StatePayload | null>(null);
  const [tab, setTab] = useState<Tab>("decree");
  const [busyCount, setBusyCount] = useState(0);
  const [offline, setOffline] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const stateRef = useRef<StatePayload | null>(null);
  const failures = useRef(0);
  const toastSeq = useRef(0);

  const applyState = useCallback((next: StatePayload) => {
    stateRef.current = next;
    setState(next);
    failures.current = 0;
    setOffline(false);
  }, []);

  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      kind === "error" ? 5000 : 2600,
    );
  }, []);

  // ---- 5 s background poll, only while the tab is visible --------------------

  const pollOnce = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(`state ${res.status}`);
      const json = (await res.json()) as StatePayload;
      failures.current = 0;
      setOffline(false);
      // Skip the re-render when the version is unchanged; never clear good state.
      if (json.version !== stateRef.current?.version) applyState(json);
    } catch {
      failures.current += 1;
      if (failures.current >= 2) setOffline(true);
    }
  }, [applyState]);

  useEffect(() => {
    void pollOnce();
    const tick = () => {
      if (document.visibilityState === "visible") void pollOnce();
    };
    const interval = setInterval(tick, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void pollOnce();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollOnce]);

  // ---- API plumbing ----------------------------------------------------------

  const request = useCallback(
    async <T,>(path: string, opts: RequestOpts = {}): Promise<T> => {
      const { body, silent, background } = opts;
      const method = opts.method ?? (body !== undefined ? "POST" : "GET");
      if (!background) setBusyCount((n) => n + 1);
      try {
        let res: Response;
        try {
          res = await fetch(path, {
            method,
            cache: "no-store",
            headers: body !== undefined ? { "content-type": "application/json" } : undefined,
            body: body !== undefined ? JSON.stringify(body) : undefined,
          });
        } catch {
          const msg = "No reply from the server — check the connection.";
          if (!silent) toast("error", msg);
          throw new ApiError(0, msg);
        }
        if (res.status === 401) {
          // Session died: drop back to the server-side login gate.
          router.refresh();
          throw new ApiError(401, "The Creek denies you — sign in again.");
        }
        let json: unknown = null;
        try {
          json = await res.json();
        } catch {
          json = null;
        }
        if (!res.ok) {
          const msg = isErrorBody(json) ? json.error : `Request failed (${res.status})`;
          if (!silent) toast("error", msg);
          throw new ApiError(res.status, msg);
        }
        return json as T;
      } finally {
        if (!background) setBusyCount((n) => n - 1);
      }
    },
    [router, toast],
  );

  const mutate = useCallback(
    async (
      path: string,
      body?: unknown,
      opts: { method?: "POST" | "PATCH" | "DELETE"; silent?: boolean } = {},
    ): Promise<MutateResult> => {
      try {
        const json = await request<unknown>(path, {
          method: opts.method ?? "POST",
          body,
          silent: opts.silent,
        });
        // Contract: every mutator returns the fresh StatePayload — apply it now.
        if (isStatePayload(json)) applyState(json);
        else void pollOnce();
        return { ok: true };
      } catch (err) {
        const e = err instanceof ApiError ? err : new ApiError(0, "Request failed");
        return { ok: false, status: e.status, message: e.message };
      }
    },
    [request, applyState, pollOnce],
  );

  const api = useMemo<AdminApi | null>(
    () =>
      state
        ? { state, busy: busyCount > 0, offline, request, mutate, toast }
        : null,
    [state, busyCount, offline, request, mutate, toast],
  );

  const switchTab = (next: Tab) => {
    setTab(next);
    window.scrollTo({ top: 0 });
  };

  // ---- render ----------------------------------------------------------------

  if (!api) {
    return (
      <main className={styles.loading}>
        <div className={styles.loadingRune} aria-hidden>
          ⚡
        </div>
        <div>LOADING…</div>
        {offline ? <div className={styles.danger}>NO SIGNAL — RETRYING</div> : null}
      </main>
    );
  }

  return (
    <AdminContext.Provider value={api}>
      <div className={`${styles.busyBar} ${api.busy ? styles.busyOn : ""}`} aria-hidden />
      <div className={styles.root}>
        <header className={styles.header}>
          <h1 className={styles.wordmark}>CREEKOS</h1>
          <div className={styles.headerPills}>
            {offline ? <span className={`${styles.pill} ${styles.pillOff}`}>SIGNAL LOST</span> : null}
            <span className={styles.pill}>v{api.state.version}</span>
          </div>
        </header>

        <main>
          <section className={styles.pane} hidden={tab !== "decree"}>
            <DecreeTab />
          </section>
          <section className={styles.pane} hidden={tab !== "events"}>
            <EventsTab />
          </section>
          <section className={styles.pane} hidden={tab !== "roster"}>
            <RosterTab />
          </section>
          <section className={styles.pane} hidden={tab !== "system"}>
            <SystemTab />
          </section>
        </main>

        <nav className={styles.nav} aria-label="Admin sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`${styles.navBtn} ${tab === t.id ? styles.navOn : ""}`}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => switchTab(t.id)}
            >
              <span className={styles.navIcon} aria-hidden>
                {t.icon}
              </span>
              <span className={styles.navLabel}>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className={styles.toasts} aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`${styles.toast} ${t.kind === "error" ? styles.toastErr : styles.toastOk}`}
              role={t.kind === "error" ? "alert" : "status"}
            >
              {t.text}
            </div>
          ))}
        </div>
      </div>
    </AdminContext.Provider>
  );
}
