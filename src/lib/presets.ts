import type { Preset } from "./types";

/**
 * Seeded on first run, in this order (§6, R1). Fully editable; "reset to defaults" restores
 * exactly this list. Rolls and buns are fixed pieces: the bread roll is on the batch dough, the
 * buns on the enriched `soft-bun` dough.
 */
export const DEFAULT_PRESETS: Preset[] = [
  {
    id: "roll",
    name: "Bread roll",
    icon: "🥐",
    defaultWeight: 100,
    minWeight: 70,
    maxWeight: 140,
    flexPriority: 0,
    proof: "room",
    proofMinutes: [60, 90],
    bake: { tempC: 220, minutes: [18, 22], steam: true },
    note: "Bap size. Tight pre-shape; proofs fastest; bake first. Steam 8 min.",
    hydrationSensitive: true,
  },
  {
    id: "dinner-roll",
    name: "Dinner roll",
    defaultWeight: 70,
    minWeight: 50,
    maxWeight: 90,
    flexPriority: 0,
    proof: "room",
    proofMinutes: [120, 240],
    bake: { tempC: 190, minutes: [20, 24], steam: false },
    note: "Pan, touching. Egg wash. 88–93 °C inside.",
    hydrationSensitive: true,
    doughId: "soft-bun",
  },
  {
    id: "burger-bun",
    name: "Burger bun",
    icon: "🍔",
    defaultWeight: 120,
    minWeight: 90,
    maxWeight: 150,
    flexPriority: 0,
    proof: "room",
    proofMinutes: [120, 240],
    bake: { tempC: 190, minutes: [18, 22], steam: false },
    note: "Flatten after shaping. Egg wash, sesame. 88–93 °C inside.",
    hydrationSensitive: true,
    doughId: "soft-bun",
  },
  {
    id: "hot-dog-bun",
    name: "Hot dog bun",
    icon: "🌭",
    defaultWeight: 90,
    minWeight: 70,
    maxWeight: 110,
    flexPriority: 0,
    proof: "room",
    proofMinutes: [120, 240],
    bake: { tempC: 190, minutes: [18, 20], steam: false },
    note: "15 cm logs, almost touching. Egg wash.",
    hydrationSensitive: true,
    doughId: "soft-bun",
  },
  {
    id: "loaf",
    name: "Loaf",
    icon: "🍞",
    defaultWeight: 600,
    minWeight: 400,
    maxWeight: 1000,
    flexPriority: 2,
    proof: "either",
    proofMinutes: [90, 180],
    bake: { tempC: 250, minutes: [40, 45], steam: false },
    note: "Boule or batard. Bench rest 20–30 min, shape, banneton. 250 °C lidded 20 min, then 230 °C uncovered 20–25 min.",
  },
  {
    id: "pizza",
    name: "Pizza base",
    icon: "🍕",
    defaultWeight: 250,
    minWeight: 200,
    maxWeight: 320,
    flexPriority: 0,
    proof: "cold",
    proofMinutes: [1440, 4320],
    bake: { tempC: 280, minutes: [5, 8], steam: false },
    note: "Ball after bulk, oiled container, fridge 24–72 h. Hottest oven available, on steel or stone.",
    hydrationSensitive: true,
  },
  {
    id: "baguette",
    name: "Baguette",
    icon: "🥖",
    defaultWeight: 300,
    minWeight: 250,
    maxWeight: 350,
    flexPriority: 1,
    proof: "room",
    proofMinutes: [45, 75],
    bake: { tempC: 240, minutes: [22, 25], steam: true },
    note: "Pre-shape log, rest, final shape, couche.",
  },
  {
    id: "focaccia",
    name: "Focaccia (per tray)",
    icon: "🫓",
    defaultWeight: 800,
    minWeight: 500,
    maxWeight: 1200,
    flexPriority: 1,
    proof: "room",
    proofMinutes: [120, 240],
    bake: { tempC: 220, minutes: [22, 28], steam: false },
    note: "Oiled tray, dimple, proof 2–4 h.",
  },
];

/**
 * Every default preset as it shipped before, byte for byte, so `reconcileDefaults` can tell a
 * preset nobody edited from one somebody did (decision 14). Today that is the whole list of
 * cfe4625 to 187a90a, roll at 70 g. It is also what every browser from before the seeded-ids
 * record (`KEYS.seeded`) was given, so a default deleted back then stays deleted. When a default
 * changes, append the version it replaces; never edit an entry here.
 */
export const LEGACY_PRESETS: readonly Preset[] = [
  {
    id: "roll",
    name: "Roll",
    icon: "🥐",
    defaultWeight: 70,
    minWeight: 50,
    maxWeight: 130,
    flexPriority: 0,
    proof: "room",
    proofMinutes: [60, 90],
    bake: { tempC: 220, minutes: [18, 22], steam: true },
    note: "Tight pre-shape; proofs fastest; bake first. Steam for the first 8 min.",
    hydrationSensitive: true,
  },
  {
    id: "loaf",
    name: "Loaf",
    icon: "🍞",
    defaultWeight: 600,
    minWeight: 400,
    maxWeight: 1000,
    flexPriority: 2,
    proof: "either",
    proofMinutes: [90, 180],
    bake: { tempC: 250, minutes: [40, 45], steam: false },
    note: "Boule or batard. Bench rest 20–30 min, shape, banneton. 250 °C lidded 20 min, then 230 °C uncovered 20–25 min.",
  },
  {
    id: "pizza",
    name: "Pizza base",
    icon: "🍕",
    defaultWeight: 250,
    minWeight: 200,
    maxWeight: 320,
    flexPriority: 0,
    proof: "cold",
    proofMinutes: [1440, 4320],
    bake: { tempC: 280, minutes: [5, 8], steam: false },
    note: "Ball after bulk, oiled container, fridge 24–72 h. Hottest oven available, on steel or stone.",
    hydrationSensitive: true,
  },
  {
    id: "baguette",
    name: "Baguette",
    icon: "🥖",
    defaultWeight: 300,
    minWeight: 250,
    maxWeight: 350,
    flexPriority: 1,
    proof: "room",
    proofMinutes: [45, 75],
    bake: { tempC: 240, minutes: [22, 25], steam: true },
    note: "Pre-shape log, rest, final shape, couche.",
  },
  {
    id: "focaccia",
    name: "Focaccia (per tray)",
    icon: "🫓",
    defaultWeight: 800,
    minWeight: 500,
    maxWeight: 1200,
    flexPriority: 1,
    proof: "room",
    proofMinutes: [120, 240],
    bake: { tempC: 220, minutes: [22, 28], steam: false },
    note: "Oiled tray, dimple, proof 2–4 h.",
  },
];

export function clonePresets(list: Preset[] = DEFAULT_PRESETS): Preset[] {
  return list.map((p) => ({
    ...p,
    proofMinutes: [...p.proofMinutes] as [number, number],
    bake: { ...p.bake, minutes: [...p.bake.minutes] as [number, number] },
  }));
}

/**
 * Brings a stored library (presets or doughs) up to date with its shipped defaults without undoing
 * anything the user did (decision 14). `previous` is every default the stored list has already
 * been given, in each version it was given; an id may appear more than once.
 *
 * - A stored entry deep-equal to a `previous` entry with its id was never edited: it becomes the
 *   current default for that id, in place. If the defaults no longer have that id, it stays.
 * - A default whose id is in neither `stored` nor `previous` is new: it is appended, in defaults
 *   order. A `previous` id missing from `stored` was deleted by the user and stays deleted.
 * - Everything else (edited entries, user-added entries, the order) comes back as stored, as the
 *   same objects.
 *
 * Entries taken from `defaults` are returned as given, so pass clones.
 */
export function reconcileDefaults<T extends { id: string }>(
  stored: readonly T[],
  defaults: readonly T[],
  previous: readonly T[],
): T[] {
  const current = new Map(defaults.map((d) => [d.id, d]));
  const out = stored.map((s) => {
    const d = current.get(s.id);
    if (!d || jsonEqual(s, d)) return s;
    return previous.some((p) => p.id === s.id && jsonEqual(s, p)) ? d : s;
  });
  const known = new Set([...stored, ...previous].map((e) => e.id));
  for (const d of defaults) {
    if (known.has(d.id)) continue;
    known.add(d.id);
    out.push(d);
  }
  return out;
}

/** Deep equality as JSON sees it: key order is ignored and a key holding `undefined` is absent. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => jsonEqual(x, b[i]))
    );
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => k in rb && jsonEqual(ra[k], rb[k]));
}
