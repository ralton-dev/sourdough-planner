import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DOUGHS, cloneDoughs } from "./doughs";
import { DEFAULT_PRESETS, LEGACY_PRESETS, clonePresets } from "./presets";
import {
  DEFAULT_GUIDE,
  DEFAULT_SYNC,
  DEFAULT_UI,
  KEYS,
  exportBundle,
  isBundleShape,
  isDough,
  isDoughList,
  isGuideState,
  isSyncMeta,
  load,
  loadAll,
  newPlan,
  parseBundle,
  readBundle,
  save,
} from "./storage";
import { SECTIONS } from "./sync";
import { SHAPE_CASES, V2_EXPORT, V3_BUNDLE } from "./bundle.fixtures";
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
  name: "Main dough",
  method: "auto",
  enrichments: [],
  inclusions: [],
};

const bundleOf = (doughs: Dough[], presets: Preset[] = DEFAULT_PRESETS) =>
  exportBundle({ presets, doughs, bulkTable: DEFAULT_BULK_TABLE, savedPlans: [], plan: newPlan() });

describe("export / import", () => {
  it("round-trips a bundle, doughs included, as version 3", () => {
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
    expect(JSON.parse(text)).toMatchObject({ app: "sourdough-planner", version: 3 });
    const back = parseBundle(text);
    expect(back.doughs).toEqual(doughs);
    // Version 3 is taken as written: the bun deleted before the export stays deleted.
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

  it("imports a version 2 bundle with a fully set dough, and refuses one with a nameless add-in", () => {
    const good = bundleOf([...cloneDoughs(), FULL]);
    expect(parseBundle(good).doughs.at(-1)).toEqual(FULL);
    const bad = JSON.stringify({
      ...(JSON.parse(good) as object),
      doughs: [fullWith({ inclusions: [{ kind: "cheese", pct: 0.2 }] })],
    });
    expect(() => parseBundle(bad)).toThrow(/invalid doughs/);
  });

  it("rejects what it cannot read", () => {
    const good = JSON.parse(bundleOf(cloneDoughs())) as object;
    const bad = (patch: object) => () => parseBundle(JSON.stringify({ ...good, ...patch }));
    expect(bad({ presets: [{ id: 1 }] })).toThrow(/no valid presets/);
    expect(bad({ doughs: [{ id: "x", name: "X" }] })).toThrow(/invalid doughs/);
    expect(bad({ doughs: null })).toThrow(/invalid doughs/);
    expect(bad({ version: 4 })).toThrow(/version 4/);
    expect(bad({ plan: { items: [] } })).toThrow(/no valid plan/);
    expect(() => parseBundle("not json")).toThrow();
  });

  it("holds the legacy presets to the 187a90a list, byte for byte", () => {
    expect(JSON.stringify(LEGACY_PRESETS)).toBe(JSON.stringify(SHIPPED_PRESETS));
  });
});

/** A dough with every optional field set, as the editor can write it. */
const FULL: Dough = {
  id: "dough-full",
  name: "Everything",
  icon: "🥯",
  method: "separate",
  hydration: 0.68,
  salt: 0.018,
  enrichments: [
    { kind: "milk", pct: 0.3 },
    { kind: "butter", pct: 0.15, addAt: "after-mix" },
  ],
  inclusions: [
    { kind: "cheese", name: "Gruyère", pct: 0.2, addAt: "shape", note: "Cubed." },
    { kind: "seed", name: "", pct: 0.1, soakerWaterPct: 0.1 },
  ],
  sweetness: { kind: "xylitol", pct: 0.04 },
  tangzhong: { flourPct: 0.05, ratio: 5 },
  splitAt: "fold2",
  bulkFactor: 1.2,
  bake: { tempC: 190, steam: false, wash: "Egg" },
  notes: "All of it.",
};

/** FULL with one part of it replaced by `patch`. */
const fullWith = (patch: Record<string, unknown>): unknown => ({ ...FULL, ...patch });

describe("validators and the new plan", () => {
  it("accepts the default library, a fully set dough and nothing malformed", () => {
    expect(isDoughList(cloneDoughs())).toBe(true);
    expect(isDoughList([])).toBe(true);
    expect(isDough(FULL)).toBe(true);
    expect(isDoughList([{ id: "a", name: "A", enrichments: [] }])).toBe(false);
    expect(isDoughList([{ id: "a", enrichments: [], inclusions: [] }])).toBe(false);
    expect(isDoughList([null])).toBe(false);
    expect(isDoughList({})).toBe(false);
  });

  it("refuses an add-in without a name, the shape that crashed the planner", () => {
    const nameless = fullWith({ inclusions: [{ kind: "cheese", pct: 0.2 }] });
    expect(isDough(nameless)).toBe(false);
    expect(isDoughList([...cloneDoughs(), nameless])).toBe(false);
  });

  it("refuses kinds and settings this app does not know", () => {
    expect(isDough(fullWith({ enrichments: [{ kind: "cream", pct: 0.1 }] }))).toBe(false);
    expect(isDough(fullWith({ inclusions: [{ kind: "bacon", name: "Bacon", pct: 0.1 }] }))).toBe(
      false,
    );
    // Allulose is not on the list (decision 23).
    expect(isDough(fullWith({ sweetness: { kind: "allulose", pct: 0.05 } }))).toBe(false);
    expect(isDough(fullWith({ method: "maybe" }))).toBe(false);
    expect(isDough(fullWith({ splitAt: "fold3" }))).toBe(false);
    expect(isDough(fullWith({ enrichments: [{ kind: "milk", pct: 0.3, addAt: "later" }] }))).toBe(
      false,
    );
  });

  it("refuses an amount that is not a finite number, and a null where text or a number goes", () => {
    expect(isDough(fullWith({ enrichments: [{ kind: "milk", pct: "30" }] }))).toBe(false);
    expect(isDough(fullWith({ enrichments: [{ kind: "milk", pct: null }] }))).toBe(false);
    expect(isDough(fullWith({ tangzhong: { flourPct: 0.05 } }))).toBe(false);
    expect(isDough(fullWith({ sweetness: { kind: "sugar" } }))).toBe(false);
    expect(
      isDough(
        fullWith({ inclusions: [{ kind: "seed", name: "S", pct: 0.1, soakerWaterPct: "x" }] }),
      ),
    ).toBe(false);
    expect(isDough(fullWith({ bake: { tempC: "hot" } }))).toBe(false);
    expect(isDough(fullWith({ icon: null }))).toBe(false);
    expect(isDough(fullWith({ hydration: null }))).toBe(false);
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

  it("falls back to the default library when one stored dough is malformed, and leaves it stored", () => {
    const stored = [...cloneDoughs(), fullWith({ inclusions: [{ kind: "cheese", pct: 0.2 }] })];
    const s = useStorage({ [KEYS.doughs]: stored });
    expect(loadAll().doughs).toEqual(DEFAULT_DOUGHS);
    expect(s.read(KEYS.doughs)).toEqual(stored);
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

const IMPORTED_AT = "2026-10-12T10:00:00.000Z";
/** Every section stamped `at`. */
const allAt = (at: string) => Object.fromEntries(SECTIONS.map((s) => [s, at]));

describe("bundle version 3 (PLAN-accounts decision 44)", () => {
  it("still imports a version 2 export written by the code before version 3", () => {
    const back = parseBundle(V2_EXPORT, IMPORTED_AT);
    const raw = JSON.parse(V2_EXPORT) as { presets: Preset[]; doughs: Dough[]; plan: Plan };
    expect(back.presets).toEqual(raw.presets);
    expect(back.doughs).toEqual(raw.doughs);
    expect(back.plan).toEqual(raw.plan);
    expect(back.ui).toEqual(DEFAULT_UI);
    // Every section the file carried is stamped with the import; settings it lacked are not.
    expect(back.updatedAt).toEqual({
      presets: IMPORTED_AT,
      doughs: IMPORTED_AT,
      bulkTable: IMPORTED_AT,
      savedPlans: IMPORTED_AT,
      plan: IMPORTED_AT,
    });
  });

  it("stamps a version 1 export's sections with the import, but not the defaults it gains", () => {
    const back = parseBundle(v1Export(), IMPORTED_AT);
    expect(back.updatedAt).toEqual({
      presets: IMPORTED_AT,
      bulkTable: IMPORTED_AT,
      savedPlans: IMPORTED_AT,
      plan: IMPORTED_AT,
    });
    expect(back.doughs).toEqual(DEFAULT_DOUGHS);
  });

  it("stamps with now when no import moment is given", () => {
    vi.useFakeTimers({ now: new Date(IMPORTED_AT) });
    try {
      expect(parseBundle(v1Export()).updatedAt.plan).toBe(IMPORTED_AT);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes version 3 with the settings and the change times it is given, and reads them back", () => {
    const updatedAt = { ...allAt("2026-10-12T08:00:00.000Z"), plan: "2026-10-12T08:30:00.000Z" };
    const data = {
      presets: clonePresets(DEFAULT_PRESETS),
      doughs: [FULL],
      bulkTable: DEFAULT_BULK_TABLE,
      savedPlans: [],
      plan: newPlan(),
      ui: { halfGramSalt: true },
      updatedAt,
    };
    const text = exportBundle(data, "2026-10-12T09:00:00.000Z");
    const raw = JSON.parse(text) as Record<string, unknown>;
    expect(raw).toMatchObject({ version: 3, exportedAt: "2026-10-12T09:00:00.000Z", updatedAt });
    expect(isBundleShape(raw)).toBe(true);
    const back = parseBundle(text, IMPORTED_AT);
    expect(back).toMatchObject({ ...data, version: 3 });
    expect(back.updatedAt).toEqual(updatedAt);
    // Round trip: exported again, byte for byte the same.
    expect(exportBundle(back, "2026-10-12T09:00:00.000Z")).toBe(text);
  });

  it("writes every section even from a caller that passes no settings or times", () => {
    const raw = JSON.parse(bundleOf(cloneDoughs())) as Record<string, unknown>;
    expect(raw).toMatchObject({ version: 3, ui: DEFAULT_UI, updatedAt: {} });
    expect(isBundleShape(raw)).toBe(true);
    expect(parseBundle(JSON.stringify(raw), IMPORTED_AT).updatedAt).toEqual(allAt(IMPORTED_AT));
  });

  it("fills only the times a version 3 file is missing", () => {
    const text = JSON.stringify({ ...V3_BUNDLE, updatedAt: { plan: "2026-10-12T08:59:00.000Z" } });
    expect(parseBundle(text, IMPORTED_AT).updatedAt).toEqual({
      ...allAt(IMPORTED_AT),
      plan: "2026-10-12T08:59:00.000Z",
    });
    const noUi = { ...V3_BUNDLE, ui: undefined, updatedAt: undefined };
    const back = readBundle(JSON.parse(JSON.stringify(noUi)), IMPORTED_AT);
    expect(back.ui).toEqual(DEFAULT_UI);
    expect(back.updatedAt).not.toHaveProperty("ui");
  });

  it("writes version 3 when handed an older import back", () => {
    const raw = JSON.parse(exportBundle(parseBundle(V2_EXPORT, IMPORTED_AT))) as object;
    expect(raw).toMatchObject({ version: 3, updatedAt: { plan: IMPORTED_AT } });
  });

  it("reads a value already parsed, as the server's response holds it", () => {
    const back = readBundle(V3_BUNDLE, IMPORTED_AT);
    expect(back.ui).toEqual({ halfGramSalt: true });
    expect(back.updatedAt).toEqual(V3_BUNDLE.updatedAt);
  });

  it("refuses version 3 settings or change times it cannot read", () => {
    const bad = (patch: object) => () => readBundle({ ...V3_BUNDLE, ...patch }, IMPORTED_AT);
    expect(bad({ ui: { halfGramSalt: "yes" } })).toThrow(/invalid settings/);
    expect(bad({ updatedAt: { plan: 5 } })).toThrow(/invalid change times/);
    expect(bad({ updatedAt: [] })).toThrow(/invalid change times/);
  });
});

describe("isBundleShape (mirrored by the server, decision 43)", () => {
  it.each(SHAPE_CASES)("$name: $ok", ({ value, ok }) => {
    expect(isBundleShape(value)).toBe(ok);
  });

  it("accepts a real export and everything parseBundle accepts among the fixtures", () => {
    expect(isBundleShape(JSON.parse(bundleOf(cloneDoughs())))).toBe(true);
    for (const { value, ok } of SHAPE_CASES) {
      if (ok) expect(() => readBundle(value, IMPORTED_AT)).not.toThrow();
    }
  });
});

describe("sync and guide keys", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names them under sourdough.v1", () => {
    expect(KEYS.sync).toBe("sourdough.v1.sync");
    expect(KEYS.guide).toBe("sourdough.v1.guide");
  });

  it("reads a stored sync record and falls back on anything else", () => {
    const meta = { version: 4, updatedAt: { plan: "2026-10-12T08:00:00.000Z" } };
    useStorage({ [KEYS.sync]: meta });
    expect(load(KEYS.sync, DEFAULT_SYNC, isSyncMeta)).toEqual(meta);
    expect(isSyncMeta(DEFAULT_SYNC)).toBe(true);
    expect(isSyncMeta({ version: -1, updatedAt: {} })).toBe(false);
    expect(isSyncMeta({ version: 1.5, updatedAt: {} })).toBe(false);
    expect(isSyncMeta({ version: 1 })).toBe(false);
    expect(isSyncMeta({ version: 1, updatedAt: { plan: 1 } })).toBe(false);
    useStorage({ [KEYS.sync]: { version: "4" } });
    expect(load(KEYS.sync, DEFAULT_SYNC, isSyncMeta)).toBe(DEFAULT_SYNC);
  });

  it("reads a stored guide record and falls back on anything else", () => {
    const guide = { seen: true, dismissed: ["timeline.view"] };
    useStorage({ [KEYS.guide]: guide });
    expect(load(KEYS.guide, DEFAULT_GUIDE, isGuideState)).toEqual(guide);
    expect(isGuideState(DEFAULT_GUIDE)).toBe(true);
    expect(isGuideState({ seen: true })).toBe(false);
    expect(isGuideState({ seen: "yes", dismissed: [] })).toBe(false);
    expect(isGuideState({ seen: true, dismissed: [1] })).toBe(false);
  });

  it("leaves loadAll writing nothing new on a fresh browser", () => {
    const s = useStorage();
    loadAll();
    expect([...s.data.keys()]).toEqual([KEYS.seeded]);
  });
});
