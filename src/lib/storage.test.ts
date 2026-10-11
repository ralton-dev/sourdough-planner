import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DOUGHS, cloneDoughs } from "./doughs";
import { DEFAULT_PRESETS, LEGACY_PRESETS, clonePresets } from "./presets";
import { KEYS, exportBundle, isDoughList, loadAll, newPlan, parseBundle, save } from "./storage";
import { DEFAULT_BULK_TABLE } from "./timeline";
import { LEAN_DOUGH_ID, type Dough, type Plan, type Preset } from "./types";

/**
 * The five presets exactly as 187a90a seeded and exported them, copied from that commit's source
 * rather than taken from LEGACY_PRESETS, so these tests also hold the legacy list to what shipped.
 */
const SHIPPED_PRESETS: Preset[] = [
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

/** A plan as 187a90a stored and exported it, overrides and all. */
const SHIPPED_PLAN: Plan = {
  id: "plan-2b7c1d0e",
  mode: "starter",
  starterWeight: 250,
  items: [
    { presetId: "pizza", count: 2 },
    { presetId: "roll", count: 4 },
    { presetId: "loaf", count: 2, weightOverride: 700 },
  ],
  settings: {
    starterHydration: 1,
    inoculation: 0.25,
    hydration: 0.75,
    salt: 0.02,
    benchLoss: 0.01,
    doughTempC: 24,
  },
  startTime: "2026-10-03T07:30:00.000Z",
  timelineOverrides: { bulk: 300, "proof:roll": 75 },
  feedStarter: false,
  autolyse: true,
  standMixer: false,
  foldCount: 3,
};

/** An export as 187a90a wrote it: version 1, no doughs. Built by hand, not by today's code. */
const v1Export = (presets: unknown = SHIPPED_PRESETS): string =>
  JSON.stringify(
    {
      app: "sourdough-planner",
      version: 1,
      exportedAt: "2026-10-03T07:00:00.000Z",
      presets,
      bulkTable: [
        { tempC: 20, minMinutes: 420, maxMinutes: 480 },
        { tempC: 22, minMinutes: 330, maxMinutes: 390 },
        { tempC: 24, minMinutes: 270, maxMinutes: 330 },
        { tempC: 26, minMinutes: 210, maxMinutes: 270 },
      ],
      savedPlans: [
        {
          id: "saved-1",
          name: "Weekend bake",
          savedAt: "2026-09-27T09:00:00.000Z",
          plan: { ...SHIPPED_PLAN, name: "Weekend bake" },
        },
      ],
      plan: SHIPPED_PLAN,
    },
    null,
    2,
  );

const OLD_IDS = ["roll", "loaf", "pizza", "baguette", "focaccia"];
const NEW_IDS = ["dinner-roll", "burger-bun", "hot-dog-bun"];
const ids = (list: readonly { id: string }[]) => list.map((x) => x.id);
const LEAN: Dough = {
  id: LEAN_DOUGH_ID,
  name: "Lean",
  method: "auto",
  enrichments: [],
  inclusions: [],
};

const bundleOf = (doughs: Dough[], presets: Preset[] = DEFAULT_PRESETS) =>
  exportBundle({ presets, doughs, bulkTable: DEFAULT_BULK_TABLE, savedPlans: [], plan: newPlan() });

describe("export / import", () => {
  it("round-trips a bundle, doughs included, as version 2", () => {
    const plan = newPlan();
    const doughs = cloneDoughs().filter((d) => d.id !== "seeded");
    doughs[0]!.notes = "Less butter next time.";
    doughs.push({
      id: "dough-mine",
      name: "Add egg",
      method: "auto",
      enrichments: [{ kind: "egg", pct: 0.1 }],
      inclusions: [],
    });
    const presets = clonePresets(DEFAULT_PRESETS).filter((p) => p.id !== "hot-dog-bun");
    const text = exportBundle({
      presets,
      doughs,
      bulkTable: DEFAULT_BULK_TABLE,
      savedPlans: [],
      plan,
    });
    expect(JSON.parse(text)).toMatchObject({ app: "sourdough-planner", version: 2 });
    const back = parseBundle(text);
    expect(back.doughs).toEqual(doughs);
    // Version 2 is taken as written: the bun deleted before the export stays deleted.
    expect(back.presets).toEqual(presets);
    expect(back.plan).toEqual(plan);
  });

  it("keeps the lean dough out of a bundle and out of an import (decision 1)", () => {
    const text = bundleOf([LEAN, ...cloneDoughs()]);
    expect(ids((JSON.parse(text) as { doughs: Dough[] }).doughs)).toEqual(ids(DEFAULT_DOUGHS));
    const handMade = JSON.stringify({ ...(JSON.parse(text) as object), doughs: [LEAN] });
    expect(parseBundle(handMade).doughs).toEqual([]);
  });

  it("imports a 187a90a export: default doughs, presets brought up to date, plan untouched", () => {
    const back = parseBundle(v1Export());
    expect(back.doughs).toEqual(DEFAULT_DOUGHS);
    expect(back.doughs[0]).not.toBe(DEFAULT_DOUGHS[0]);
    expect(ids(back.presets)).toEqual([...OLD_IDS, ...NEW_IDS]);
    expect(back.presets[0]).toEqual(DEFAULT_PRESETS[0]);
    expect(back.presets[0]).toMatchObject({ name: "Bread roll", defaultWeight: 100 });
    expect(JSON.stringify(back.plan)).toBe(JSON.stringify(SHIPPED_PLAN));
    expect(back.savedPlans).toEqual((JSON.parse(v1Export()) as { savedPlans: unknown }).savedPlans);
    expect(back.bulkTable).toEqual(DEFAULT_BULK_TABLE);
  });

  it("keeps an edited roll from a 187a90a export, and what was deleted there stays deleted", () => {
    const presets = SHIPPED_PRESETS.filter((p) => p.id !== "focaccia").map((p) =>
      p.id === "roll" ? { ...p, defaultWeight: 85 } : p,
    );
    const back = parseBundle(v1Export(presets));
    expect(back.presets[0]).toEqual({ ...SHIPPED_PRESETS[0], defaultWeight: 85 });
    expect(ids(back.presets)).toEqual(["roll", "loaf", "pizza", "baguette", ...NEW_IDS]);
  });

  it("gives a version 2 export without doughs the default library", () => {
    const text = JSON.stringify({ ...(JSON.parse(v1Export()) as object), version: 2 });
    const back = parseBundle(text);
    expect(back.doughs).toEqual(DEFAULT_DOUGHS);
    expect(back.presets).toEqual(SHIPPED_PRESETS);
  });

  it("rejects foreign JSON", () => {
    expect(() => parseBundle('{"hello":1}')).toThrow(/Not a sourdough-planner export/);
  });

  it("rejects what it cannot read", () => {
    const good = JSON.parse(bundleOf(cloneDoughs())) as object;
    const bad = (patch: object) => () => parseBundle(JSON.stringify({ ...good, ...patch }));
    expect(bad({ presets: [{ id: 1 }] })).toThrow(/no valid presets/);
    expect(bad({ doughs: [{ id: "x", name: "X" }] })).toThrow(/invalid doughs/);
    expect(bad({ doughs: null })).toThrow(/invalid doughs/);
    expect(bad({ version: 3 })).toThrow(/version 3/);
    expect(bad({ plan: { items: [] } })).toThrow(/no valid plan/);
    expect(() => parseBundle("not json")).toThrow();
  });

  it("holds the legacy presets to the 187a90a list, byte for byte", () => {
    expect(JSON.stringify(LEGACY_PRESETS)).toBe(JSON.stringify(SHIPPED_PRESETS));
  });
});

describe("validators and the new plan", () => {
  it("accepts a dough library with ids, names and both lists, and nothing less", () => {
    expect(isDoughList(cloneDoughs())).toBe(true);
    expect(isDoughList([])).toBe(true);
    expect(isDoughList([{ id: "a", name: "A", enrichments: [] }])).toBe(false);
    expect(isDoughList([{ id: "a", enrichments: [], inclusions: [] }])).toBe(false);
    expect(isDoughList([null])).toBe(false);
    expect(isDoughList({})).toBe(false);
  });

  it("starts a new plan lean, with no add-ins setting or notes written (decision 6)", () => {
    const plan = newPlan();
    expect(plan).not.toHaveProperty("weightsIncludeAdditions");
    expect(plan).not.toHaveProperty("notes");
    expect(plan.items.every((it) => it.doughId === undefined)).toBe(true);
  });
});

/** An in-memory localStorage holding `entries`; strings are stored as given, the rest as JSON. */
function useStorage(entries: Record<string, unknown> = {}) {
  const data = new Map<string, string>(
    Object.entries(entries).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
  );
  const setItem = vi.fn((k: string, v: string) => {
    data.set(k, String(v));
  });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem,
    removeItem: (k: string) => {
      data.delete(k);
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  });
  return { data, setItem, read: (k: string): unknown => JSON.parse(data.get(k) ?? "null") };
}

describe("loadAll", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives an old presets list the bread roll and the new presets, written back once", () => {
    const s = useStorage({ [KEYS.presets]: SHIPPED_PRESETS });
    const first = loadAll();
    expect(ids(first.presets)).toEqual([...OLD_IDS, ...NEW_IDS]);
    expect(first.presets[0]).toEqual(DEFAULT_PRESETS[0]);
    expect(s.read(KEYS.presets)).toEqual(first.presets);
    expect(s.read(KEYS.seeded)).toEqual({
      presets: ids(DEFAULT_PRESETS),
      doughs: ids(DEFAULT_DOUGHS),
    });
    // A reload with nothing else changed reads the same and writes nothing.
    s.setItem.mockClear();
    expect(loadAll().presets).toEqual(first.presets);
    expect(s.setItem).not.toHaveBeenCalled();
  });

  it("keeps an edited roll and still gains the three new presets", () => {
    const edited = SHIPPED_PRESETS.map((p) =>
      p.id === "roll" ? { ...p, defaultWeight: 85, note: "Mine." } : p,
    );
    useStorage({ [KEYS.presets]: edited });
    const { presets } = loadAll();
    expect(presets[0]).toEqual(edited[0]);
    expect(ids(presets)).toEqual([...OLD_IDS, ...NEW_IDS]);
  });

  it("leaves a deleted default deleted, from before the upgrade and after it", () => {
    useStorage({ [KEYS.presets]: SHIPPED_PRESETS.filter((p) => p.id !== "focaccia") });
    const { presets } = loadAll();
    expect(ids(presets)).not.toContain("focaccia");
    // The app saves the list once the hot dog bun is deleted; the next load keeps it gone.
    save(
      KEYS.presets,
      presets.filter((p) => p.id !== "hot-dog-bun"),
    );
    expect(ids(loadAll().presets)).toEqual([
      "roll",
      "loaf",
      "pizza",
      "baguette",
      ...NEW_IDS.slice(0, 2),
    ]);
  });

  it("seeds a fresh browser with every default, in order, and writes only the record", () => {
    const s = useStorage();
    const all = loadAll();
    expect(all.presets).toEqual(DEFAULT_PRESETS);
    expect(all.presets[0]).not.toBe(DEFAULT_PRESETS[0]);
    expect(all.doughs).toEqual(DEFAULT_DOUGHS);
    expect(all.doughs[0]).not.toBe(DEFAULT_DOUGHS[0]);
    expect([...s.data.keys()]).toEqual([KEYS.seeded]);
  });

  it("returns the stored dough library as it is, deletions and edits included", () => {
    const doughs = cloneDoughs().filter((d) => d.id !== "buttered");
    doughs[0]!.notes = "Less butter next time.";
    useStorage({ [KEYS.doughs]: doughs });
    expect(loadAll().doughs).toEqual(doughs);
    useStorage({ [KEYS.doughs]: doughs, [KEYS.seeded]: { doughs: ids(DEFAULT_DOUGHS) } });
    expect(loadAll().doughs).toEqual(doughs);
  });

  it("drops a stored lean dough and leaves an unreadable stored value alone", () => {
    const s = useStorage({ [KEYS.doughs]: [LEAN, ...cloneDoughs()], [KEYS.presets]: "{not json" });
    const all = loadAll();
    expect(ids(all.doughs)).toEqual(ids(DEFAULT_DOUGHS));
    expect(all.presets).toEqual(DEFAULT_PRESETS);
    expect(s.data.get(KEYS.presets)).toBe("{not json");
  });

  it("records nothing as given when the write-back fails", () => {
    const s = useStorage({ [KEYS.presets]: SHIPPED_PRESETS });
    // The larger presets write hits the quota; the small record would still fit.
    s.setItem.mockImplementation((k: string, v: string) => {
      if (k === KEYS.presets) throw new Error("QuotaExceededError");
      s.data.set(k, v);
    });
    expect(ids(loadAll().presets)).toEqual([...OLD_IDS, ...NEW_IDS]);
    expect(s.data.has(KEYS.seeded)).toBe(false);
    // So the next load offers the new presets again rather than treating them as deleted.
    s.setItem.mockClear();
    expect(ids(loadAll().presets)).toEqual([...OLD_IDS, ...NEW_IDS]);
  });

  it("works with no storage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    const all = loadAll();
    expect(all.presets).toEqual(DEFAULT_PRESETS);
    expect(all.doughs).toEqual(DEFAULT_DOUGHS);
  });
});
