"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./admin.module.css";
import { isErrorBody } from "./shared";

export default function LoginForm({ pinFromUrl }: { pinFromUrl: string | null }) {
  const [pin, setPin] = useState(pinFromUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const autoFired = useRef(false);

  const submit = async (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "") return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: trimmed }),
      });
      if (res.ok) {
        // Hard navigation: re-runs the server gate with the fresh cookie and
        // scrubs ?pin= from the address bar in one move.
        window.location.replace("/admin");
        return; // stay in the pending state while the portal loads
      }
      const body: unknown = await res.json().catch(() => null);
      setError(isErrorBody(body) ? body.error : `Login failed (${res.status})`);
      setPending(false);
    } catch {
      setError("No reply from the server — check the connection.");
      setPending(false);
    }
  };

  // Auto-submit a ?pin= from the URL exactly once on mount.
  useEffect(() => {
    if (pinFromUrl && pinFromUrl.trim() !== "" && !autoFired.current) {
      autoFired.current = true;
      void submit(pinFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className={styles.loginRoot}>
      <h1 className={styles.wordmark}>CREEKOS</h1>
      <form
        className={styles.loginForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending) void submit(pin);
        }}
      >
        <label className={styles.label} htmlFor="creekos-pin">
          Commissioner PIN
        </label>
        <input
          id="creekos-pin"
          className={`${styles.input} ${styles.pinInput}`}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          enterKeyHint="go"
          maxLength={32}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoFocus
        />
        {error !== null ? (
          <p className={styles.loginError} role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className={`${styles.btn} ${styles.btnGold} ${styles.btnBig}`}
          disabled={pending || pin.trim() === ""}
        >
          {pending ? "CHECKING…" : "ENTER"}
        </button>
      </form>
    </main>
  );
}
