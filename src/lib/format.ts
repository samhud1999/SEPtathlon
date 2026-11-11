/** "13" for integers, "13.5" for halves. */
export function fmtPts(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "+5" / "−3" (typographic minus for display). */
export function fmtSigned(n: number): string {
  if (n < 0) return `−${fmtPts(Math.abs(n))}`;
  return `+${fmtPts(n)}`;
}

/** "1st" · "2nd" · "3rd" · "11th" … */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** "3rd" or "T-3rd" when tied. */
export function rankLabel(rank: number, tied: boolean): string {
  return tied ? `T-${ordinal(rank)}` : ordinal(rank);
}

/** Local wall-clock time like "17:42". */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "Sat 17:42" for feed timestamps. */
export function fmtDayTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString([], { weekday: "short" });
  return `${day} ${fmtTime(iso)}`;
}

/** Error percentage, always 3 dp with a % ("0.240%"). */
export function fmtErrPct(n: number): string {
  return `${n.toFixed(3)}%`;
}
