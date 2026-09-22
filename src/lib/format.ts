import type { Ingredients } from "./types";

export const roundG = (n: number): number => Math.round(n);

export function fmtG(n: number): string {
  return `${roundG(n)} g`;
}

/** Salt to the nearest gram, or half gram if the scale can read it. */
export function roundSalt(n: number, halfGram: boolean): number {
  return halfGram ? Math.round(n * 2) / 2 : Math.round(n);
}

export function fmtSalt(n: number, halfGram: boolean): string {
  const v = roundSalt(n, halfGram);
  return `${Number.isInteger(v) ? v : v.toFixed(1)} g`;
}

export function fmtPct(frac: number, dp = 1): string {
  return `${(frac * 100).toFixed(dp)}%`;
}

export function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(d);
}

export function fmtDayTime(d: Date, ref?: Date): string {
  const sameDay =
    ref &&
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate();
  if (sameDay) return fmtTime(d);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function fmtDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

export function fmtRange(minMinutes: number, maxMinutes: number): string {
  return `${fmtDuration(minMinutes)} – ${fmtDuration(maxMinutes)}`;
}

/** §5.4 — the displayed ingredients must add up to the displayed total, ±2 g. */
export function checkRow(
  r: Ingredients,
  halfGramSalt: boolean,
): { sum: number; total: number; diff: number; ok: boolean } {
  const sum =
    roundG(r.addedFlour) +
    roundG(r.addedWater) +
    roundG(r.starter) +
    roundSalt(r.salt, halfGramSalt);
  const total = roundG(r.totalDough);
  const diff = sum - total;
  return { sum, total, diff, ok: Math.abs(diff) <= 2 };
}

/** Local datetime-input value (no timezone suffix). */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
