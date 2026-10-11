import { LEAN_DOUGH_ID, type AdditionLine, type AllocationLine, type Ingredients } from "./types";

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

/**
 * A typical range as an editor hint shows it, from fractions of flour: "5–20%", "up to 5%"
 * (a lower bound of 0), "0.02–0.03%". Up to two decimals, trailing zeros dropped. `unit` swaps
 * the "%" for, say, " g per 100 g flour", which is the same number.
 */
export function fmtPctRange(range: readonly [number, number], unit = "%"): string {
  const [lo, hi] = range;
  const n = (frac: number) => String(Number((frac * 100).toFixed(2)));
  if (!(lo > 0)) return `up to ${n(hi)}${unit}`;
  if (n(lo) === n(hi)) return `${n(lo)}${unit}`;
  return `${n(lo)}–${n(hi)}${unit}`;
}

/** "egg", "egg and milk", "egg, milk and butter". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * How messages name a line (decision 2): "Loaf" on the main dough, "Loaf (Jalapeño cheddar)" on
 * any other, and "Loaf (dough <id> not found)" when its dough is missing from the library.
 * Lanes carry the same fields, so a lane can be named the same way.
 */
export function lineLabel(
  l: Pick<AllocationLine, "name" | "presetId" | "key" | "doughId" | "doughName">,
): string {
  if (l.doughId !== LEAN_DOUGH_ID) return `${l.name} (${l.doughName})`;
  if (l.key === l.presetId) return l.name;
  return `${l.name} (dough ${l.key.slice(l.presetId.length + 1)} not found)`;
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

/**
 * Whole minutes, as hours and minutes from an hour up. The nudge keeps a half that floating point
 * lands a hair short of (330 × 1.15 = 379.49999999999994) rounding up, as it would on paper.
 */
export function fmtDuration(minutes: number): string {
  const m = Math.round(minutes + 1e-6);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

export function fmtRange(minMinutes: number, maxMinutes: number): string {
  return `${fmtDuration(minMinutes)} – ${fmtDuration(maxMinutes)}`;
}

/**
 * §5.4 — the displayed lines of one mix must add up to its displayed total. Each line counts as it
 * is shown: flour, water and starter to the gram, salt to the gram or half gram, and every addition
 * line (a mix's enrichments, add-ins and tangzhong) to the gram. The four plain lines may be ±2 g
 * out from rounding alone; each addition line can add half a gram more. A batch or a plain mix has
 * no `additions`, so it checks exactly as before.
 */
export function checkRow(
  r: Ingredients & { additions?: readonly AdditionLine[] },
  halfGramSalt: boolean,
): { sum: number; total: number; diff: number; ok: boolean } {
  const additions = r.additions ?? [];
  const sum =
    roundG(r.addedFlour) +
    roundG(r.addedWater) +
    roundG(r.starter) +
    roundSalt(r.salt, halfGramSalt) +
    additions.reduce((n, a) => n + roundG(a.grams), 0);
  const total = roundG(r.totalDough);
  const diff = sum - total;
  return { sum, total, diff, ok: Math.abs(diff) <= 2 + 0.5 * additions.length };
}

/** Local datetime-input value (no timezone suffix). */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
