"use client";

/** Small shared widgets: two-tap arm button, bottom sheet, segmented control, avatar. */

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./admin.module.css";
import { initials } from "./shared";

/**
 * Two-tap arm/fire button: the first tap arms it (auto-disarms after 3 s),
 * the second tap fires. Used for every destructive single action.
 */
export function ArmButton({
  label,
  armedLabel = "TAP AGAIN TO CONFIRM",
  onFire,
  disabled,
  className = "",
}: {
  label: ReactNode;
  armedLabel?: ReactNode;
  onFire: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => () => clear(), []);
  useEffect(() => {
    if (disabled) {
      clear();
      setArmed(false);
    }
  }, [disabled]);

  const onClick = () => {
    if (armed) {
      clear();
      setArmed(false);
      onFire();
    } else {
      clear();
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 3000);
    }
  };

  return (
    <button
      type="button"
      className={`${styles.btn} ${className} ${armed ? styles.armed : ""}`}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={armed}
    >
      {armed ? armedLabel : label}
    </button>
  );
}

/** Bottom-sheet modal (the only modal style in the portal; no browser dialogs). */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.sheetGrip} aria-hidden />
        <h2 className={styles.sheetTitle}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Segmented control. */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className={styles.seg} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`${styles.segBtn} ${o.value === value ? styles.segOn : ""}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Initials circle. */
export function Avatar({ name, size = 52 }: { name: string; size?: number }) {
  return (
    <span
      className={styles.avatarCircle}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.33) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
