import { describe, expect, it } from "vitest";
import {
  allocate,
  batchFromFlour,
  batchFromItems,
  batchFromStarter,
  computePlan,
  inoculationForStarter,
  lineLabel,
} from "./calc";
import { INCLUSIONS, cloneDoughs } from "./doughs";
import { checkRow } from "./format";
import {
  DEFAULT_SETTINGS,
  LEAN_DOUGH_ID,
  type AdditionLine,
  type BatchResult,
  type Dough,
  type Ingredients,
  type Plan,
  type Preset,
  type Settings,
} from "./types";

const REF: Settings = {
  starterHydration: 1,
  inoculation: 0.25,
  hydration: 0.75,
  salt: 0.02,
  benchLoss: 0,
  doughTempC: 24,
};

/**
 * The five presets as they stood at 187a90a, roll at 70 g. Decision 15: the §5.5 reference bake
 * is frozen on this copy, not on DEFAULT_PRESETS, so preset changes (WP-B) cannot move it.
 */
const REF_PRESETS: Preset[] = [
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

const refPlan = (over: Partial<Plan> = {}): Plan => ({
  id: "t",
  mode: "starter",
  starterWeight: 250,
  items: [
    { presetId: "pizza", count: 2 },
    { presetId: "roll", count: 4 },
    { presetId: "loaf", count: 2 },
  ],
  settings: REF,
  startTime: "2026-09-22T09:00:00.000Z",
  ...over,
});

/** The seeded dough library, unedited. Passed at every computePlan call (decision 21). */
const DOUGHS = cloneDoughs();

const libraryDough = (id: string): Dough => {
  const d = DOUGHS.find((x) => x.id === id);
  if (!d) throw new Error(`${id} is not in DEFAULT_DOUGHS`);
  return d;
};

/** The library with `d` in place of the dough with its id, or added at the end. */
const libraryWith = (d: Dough): Dough[] =>
  DOUGHS.some((x) => x.id === d.id) ? DOUGHS.map((x) => (x.id === d.id ? d : x)) : [...DOUGHS, d];

/** Test-only (§4 B2): soft-bun plus sugar 6 %. Not seeded: no default dough has sugar (decision 23). */
const SWEET_BUN: Dough = {
  ...libraryDough("soft-bun"),
  id: "sweet-bun",
  name: "Sweet bun",
  sweetness: { kind: "sugar", pct: 0.06 },
};

const near = (actual: number | undefined, expected: number) =>
  expect(actual).toBeCloseTo(expected, 2);
const lineOf = (r: BatchResult, key: string) => r.allocation.find((l) => l.key === key);
const doughOf = (r: BatchResult, id: string) => r.doughs.find((d) => d.doughId === id);
const mixOf = (r: BatchResult, id: string) => r.mixes.find((m) => m.id === id);
const addition = (owner: { additions: AdditionLine[] } | undefined, kind: AdditionLine["kind"]) =>
  owner?.additions.find((a) => a.kind === kind);
const codes = (r: BatchResult) => r.warnings.map((w) => w.code);
const warning = (r: BatchResult, code: string) => r.warnings.find((w) => w.code === code);

const INGREDIENTS: (keyof Ingredients)[] = [
  "addedFlour",
  "addedWater",
  "starter",
  "starterFlour",
  "starterWater",
  "salt",
  "totalFlour",
  "totalWater",
  "totalDough",
  "usableDough",
  "trueHydration",
];

describe("§5.5 reference bake — starter mode", () => {
  const r = computePlan(refPlan(), REF_PRESETS, DOUGHS);

  it("sizes the batch", () => {
    expect(r.addedFlour).toBeCloseTo(1000, 6);
    expect(r.addedWater).toBeCloseTo(718.75, 6);
    expect(r.starter).toBe(250);
    expect(r.salt).toBeCloseTo(22.5, 6);
    expect(r.totalFlour).toBeCloseTo(1125, 6);
    expect(r.trueHydration).toBeCloseTo(0.75, 9);
    expect(r.totalDough).toBeCloseTo(1991.25, 6);
    expect(Math.round(r.totalDough)).toBe(1991);
  });

  it("splits it across the items", () => {
    const by = Object.fromEntries(r.allocation.map((l) => [l.presetId, l]));
    expect(by.pizza).toMatchObject({ count: 2, weightEach: 250, adjusted: false });
    expect(by.roll).toMatchObject({ count: 4, weightEach: 70, adjusted: false });
    expect(by.loaf?.count).toBe(2);
    expect(by.loaf?.weightEach).toBeCloseTo(605.625, 6);
    expect(Math.round(by.loaf!.weightEach)).toBe(606);
    expect(by.loaf?.adjusted).toBe(true);
    expect(r.spareOrShort).toBe(0);
    expect(r.suggestions).toEqual([]);
  });

  it("has no warnings", () => {
    expect(r.warnings).toEqual([]);
  });

  it("is one mix and one dough, each the batch to the last bit", () => {
    expect(r.mixes.map((m) => m.id)).toEqual(["base"]);
    expect(r.doughs.map((d) => d.doughId)).toEqual([LEAN_DOUGH_ID]);
    const plain = batchFromStarter(250, REF);
    for (const k of INGREDIENTS) {
      expect(r[k]).toBe(plain[k]);
      expect(r.mixes[0]?.[k]).toBe(plain[k]);
    }
    const lean = r.doughs[0]!;
    expect([lean.flour, lean.water, lean.starter, lean.salt, lean.mass, lean.usable]).toEqual([
      plain.totalFlour,
      plain.totalWater,
      plain.starter,
      plain.salt,
      plain.totalDough,
      plain.usableDough,
    ]);
    expect(lean).toMatchObject({ method: "base", mixId: "base", additions: [], bulkFactor: 1 });
    expect(r.mixes[0]).toMatchObject({
      label: "Main dough",
      doughIds: [LEAN_DOUGH_ID],
      additions: [],
    });
    expect(r.mixes[0]?.mixMinutes).toBe(10);
    // Lean lines keep their preset id as key; the piece is all dough.
    for (const l of r.allocation) {
      expect(l).toMatchObject({ key: l.presetId, doughId: LEAN_DOUGH_ID, doughName: "Lean" });
      expect([l.doughEach, l.additionsEach, l.pieceEach]).toEqual([l.weightEach, 0, l.weightEach]);
    }
  });

  it("does not move with an empty library (decision 21)", () => {
    const bare = computePlan(refPlan(), REF_PRESETS, []);
    for (const k of INGREDIENTS) expect(bare[k]).toBe(r[k]);
    expect(bare.allocation).toEqual(r.allocation);
  });
});

describe("§5.5 inverse — items mode", () => {
  it("returns the starter and flour of the reference bake", () => {
    const r = computePlan(
      refPlan({
        mode: "items",
        items: [
          { presetId: "pizza", count: 2 },
          { presetId: "roll", count: 4 },
          { presetId: "loaf", count: 2, weightOverride: 605.6 },
        ],
      }),
      REF_PRESETS,
      DOUGHS,
    );
    expect(r.starter).toBeCloseTo(250, 1);
    expect(r.addedFlour).toBeCloseTo(1000, 0);
    expect(r.trueHydration).toBeCloseTo(0.75, 9);
    expect(r.usableDough).toBeCloseTo(1991.2, 6);
  });

  it("is one mix sized exactly as batchFromItems sizes it", () => {
    const r = computePlan(
      refPlan({
        mode: "items",
        settings: { ...REF, benchLoss: 0.01 },
        items: [
          { presetId: "pizza", count: 2 },
          { presetId: "roll", count: 4 },
          { presetId: "loaf", count: 2, weightOverride: 605.6 },
        ],
      }),
      REF_PRESETS,
      DOUGHS,
    );
    const plain = batchFromItems(1991.2, { ...REF, benchLoss: 0.01 });
    expect(r.mixes).toHaveLength(1);
    expect(r.doughs).toHaveLength(1);
    for (const k of INGREDIENTS) expect(r[k]).toBe(plain[k]);
    expect(r.usableDough).toBe(1991.2);
    expect(r.doughs[0]?.usable).toBe(1991.2);
  });

  it("sizes through the flour pivot", () => {
    const pivot = batchFromFlour(1125, REF);
    const plain = batchFromStarter(250, REF);
    for (const k of INGREDIENTS) expect(pivot[k]).toBeCloseTo(plain[k], 9);
    expect(batchFromFlour(0, REF).totalDough).toBe(0);
  });

  it("round-trips exactly through both formulas", () => {
    const a = batchFromStarter(250, REF);
    const b = batchFromItems(a.totalDough, REF);
    expect(b.starter).toBeCloseTo(250, 9);
    expect(b.addedFlour).toBeCloseTo(1000, 9);
    expect(b.addedWater).toBeCloseTo(718.75, 9);
    expect(b.salt).toBeCloseTo(22.5, 9);
  });

  it("accounts for bench loss when sizing from items", () => {
    const s = { ...REF, benchLoss: 0.01 };
    const b = batchFromItems(990, s);
    expect(b.totalDough).toBeCloseTo(1000, 9);
    expect(b.usableDough).toBe(990);
    expect(b.totalDough * (1 - s.benchLoss)).toBeCloseTo(990, 9);
  });
});

describe("true hydration", () => {
  it("counts the water inside the starter", () => {
    // 800 flour + 600 water + 200 starter @100% is 77.8 %, not 75 %.
    const r = batchFromStarter(200, { ...REF, inoculation: 0.25, hydration: 0.75 });
    expect(r.addedFlour).toBe(800);
    expect(r.totalFlour).toBe(900);
    expect(r.trueHydration).toBeCloseTo(0.75, 9);
    // The naive recipe would have given 600 g added water; we give less.
    expect(r.addedWater).toBeCloseTo(575, 9);
    expect((600 + 100) / (800 + 100)).toBeCloseTo(0.7778, 3);
  });

  it("handles a stiff 80 % levain", () => {
    const r = batchFromStarter(250, { ...REF, starterHydration: 0.8 });
    expect(r.starterFlour).toBeCloseTo(250 / 1.8, 9);
    expect(r.starterWater).toBeCloseTo(250 - 250 / 1.8, 9);
    expect(r.totalFlour).toBeCloseTo(1000 + 250 / 1.8, 9);
    expect(r.trueHydration).toBeCloseTo(0.75, 9);
    // Stiffer starter carries less water, so more water is added.
    expect(r.addedWater).toBeGreaterThan(718.75);
    const inv = batchFromItems(r.totalDough, { ...REF, starterHydration: 0.8 });
    expect(inv.starter).toBeCloseTo(250, 9);
  });
});

describe("§5.3 allocation", () => {
  it("clamps flex loaves at minWeight and reports the shortfall", () => {
    // 700 g usable for 4 rolls (280) and 2 loaves (min 400 each = 800).
    const r = allocate(
      700,
      [
        { presetId: "roll", count: 4 },
        { presetId: "loaf", count: 2 },
      ],
      REF_PRESETS,
    );
    const loaf = r.allocation.find((l) => l.presetId === "loaf")!;
    expect(loaf.weightEach).toBe(400);
    expect(loaf.adjusted).toBe(true);
    expect(loaf.belowMin).toBe(false);
    expect(r.spareOrShort).toBeCloseTo(700 - 280 - 800, 9);
    expect(r.suggestions[0]).toMatch(/Short by 380 g/);
    expect(r.suggestions.join(" ")).toMatch(/items mode/);
  });

  it("reports surplus when nothing can flex and suggests another piece", () => {
    const r = allocate(1000, [{ presetId: "roll", count: 4 }], REF_PRESETS);
    expect(r.allocation[0]?.weightEach).toBe(70);
    expect(r.allocation[0]?.adjusted).toBe(false);
    expect(r.spareOrShort).toBe(720);
    expect(r.suggestions[0]).toMatch(/720 g spare/);
    expect(r.suggestions[0]).toMatch(/one more Roll/);
  });

  it("carries the remainder to the next tier once the top tier is maxed", () => {
    // 2 loaves (prio 2, max 1000) and 1 focaccia (prio 1, max 1200), 4000 g usable.
    const r = allocate(
      4000,
      [
        { presetId: "loaf", count: 2 },
        { presetId: "focaccia", count: 1 },
      ],
      REF_PRESETS,
    );
    const loaf = r.allocation.find((l) => l.presetId === "loaf")!;
    const foc = r.allocation.find((l) => l.presetId === "focaccia")!;
    expect(loaf.weightEach).toBe(1000);
    expect(foc.weightEach).toBe(1200);
    expect(r.spareOrShort).toBeCloseTo(4000 - 2000 - 1200, 9);
  });

  it("splits evenly per piece across a tier with mixed items", () => {
    // baguette + focaccia share priority 1. base 300 + 800 = 1100; 1400 usable → +150 each.
    const r = allocate(
      1400,
      [
        { presetId: "baguette", count: 1 },
        { presetId: "focaccia", count: 1 },
      ],
      REF_PRESETS,
    );
    // Baguette maxes at 350 (+50); the other 250 goes to focaccia.
    const bag = r.allocation.find((l) => l.presetId === "baguette")!;
    const foc = r.allocation.find((l) => l.presetId === "focaccia")!;
    expect(bag.weightEach).toBe(350);
    expect(foc.weightEach).toBeCloseTo(1050, 9);
    expect(r.spareOrShort).toBe(0);
  });

  it("treats a pinned weight as fixed", () => {
    const r = allocate(
      2000,
      [
        { presetId: "loaf", count: 1, weightOverride: 700 },
        { presetId: "roll", count: 2 },
      ],
      REF_PRESETS,
    );
    const loaf = r.allocation.find((l) => l.presetId === "loaf")!;
    expect(loaf.pinned).toBe(true);
    expect(loaf.weightEach).toBe(700);
    expect(r.spareOrShort).toBeCloseTo(2000 - 700 - 140, 9);
  });

  it("flags a pinned weight below the preset minimum", () => {
    const r = computePlan(
      refPlan({ items: [{ presetId: "roll", count: 1, weightOverride: 30 }] }),
      REF_PRESETS,
      DOUGHS,
    );
    expect(r.allocation[0]?.belowMin).toBe(true);
    expect(r.warnings.some((w) => w.code === "below-min")).toBe(true);
  });

  it("ignores unknown presets and zero counts", () => {
    const r = allocate(
      500,
      [
        { presetId: "nope", count: 2 },
        { presetId: "roll", count: 0 },
      ],
      REF_PRESETS,
    );
    expect(r.allocation).toEqual([]);
    expect(r.spareOrShort).toBe(500);
  });
});

describe("items mode starter availability", () => {
  it("solves the inoculation that fits the starter on hand", () => {
    const r = computePlan(
      refPlan({
        mode: "items",
        starterAvailable: 150,
        items: [
          { presetId: "pizza", count: 2 },
          { presetId: "roll", count: 4 },
          { presetId: "loaf", count: 2, weightOverride: 605.6 },
        ],
      }),
      REF_PRESETS,
      DOUGHS,
    );
    expect(r.starter).toBeCloseTo(250, 1);
    const i2 = r.inoculationForAvailable!;
    expect(i2).toBeCloseTo(inoculationForStarter(150, r.totalFlour, 1), 12);
    // Re-running at that inoculation needs exactly 150 g.
    const again = batchFromItems(r.usableDough, { ...REF, inoculation: i2 });
    expect(again.starter).toBeCloseTo(150, 9);
    const w = r.warnings.find((x) => x.code === "starter-short");
    expect(w?.message).toMatch(/needs 250 g starter but only 150 g/);
    expect(w?.message).toMatch(/lengthens bulk/);
  });
});

describe("§8 warnings", () => {
  it("warns on high hydration only with sensitive items", () => {
    const wet = { ...REF, hydration: 0.85 };
    const rolls = computePlan(
      refPlan({ settings: wet, items: [{ presetId: "roll", count: 4 }] }),
      REF_PRESETS,
      DOUGHS,
    );
    expect(rolls.warnings.map((w) => w.code)).toContain("high-hydration");
    const loaves = computePlan(
      refPlan({ settings: wet, items: [{ presetId: "loaf", count: 1 }] }),
      REF_PRESETS,
      DOUGHS,
    );
    expect(loaves.warnings.map((w) => w.code)).not.toContain("high-hydration");
  });

  it("flags inoculation and salt outside typical ranges", () => {
    const r = computePlan(
      refPlan({ settings: { ...REF, inoculation: 0.05, salt: 0.03 } }),
      REF_PRESETS,
      DOUGHS,
    );
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain("inoculation-range");
    expect(codes).toContain("salt-range");
  });

  it("stays quiet on the defaults", () => {
    const r = computePlan(refPlan({ settings: DEFAULT_SETTINGS }), REF_PRESETS, DOUGHS);
    expect(r.warnings).toEqual([]);
  });
});

describe("degenerate inputs", () => {
  it("returns zeros rather than NaN", () => {
    expect(batchFromStarter(0, REF).totalDough).toBe(0);
    expect(batchFromStarter(100, { ...REF, inoculation: 0 }).totalDough).toBe(0);
    expect(batchFromItems(0, REF).totalDough).toBe(0);
    expect(Number.isNaN(inoculationForStarter(2000, 1000, 1))).toBe(true);
  });
});

// §4 multi-dough maths. These began as WP-A's red pins and assert the plan's worked examples to
// 0.01 g; the awkward fixture of §10 extends them.

describe("§4 multi-dough maths", () => {
  /** Worked example A's plan: a plain loaf flexing beside a jalapeño-cheddar loaf pinned at 600 g. */
  const exampleA = (over: Partial<Plan> = {}): Plan =>
    refPlan({
      items: [
        { presetId: "loaf", count: 1 },
        { presetId: "loaf", count: 1, weightOverride: 600, doughId: "jalapeno-cheddar" },
      ],
      ...over,
    });

  /*
   * (A) Worked example A — split. REF settings, starter mode, 250 g starter, tick box on.
   *   T = 1125, k_base = 1.77, k_v = 2.10
   *   jalapeño-cheddar: flour 600 / 2.10 = 285.714; cheddar 71.429; jalapeño 22.857;
   *     portion 505.714 g of base dough (505.714 + 71.429 + 22.857 = 600)
   *   lean loaf: 600 / 1.77 = 338.983 flour; 500.303 flour left → +885.536 g → clamps at
   *     1000 g (564.972 flour); 274.314 flour left = 485.536 g spare base dough
   *   one mix: added flour 1000, water 718.75, starter 250, salt 22.5, total 1991.25 (= §5.5)
   *   doughs: lean flour 839.286, mass 1485.536; jalapeño-cheddar flour 285.714, mass 600
   *   division: loaf@jalapeno-cheddar 600 g = 505.714 g dough + 94.286 g add-ins
   */
  it("A: a split dough comes out of the one base mix", () => {
    const r = computePlan(exampleA(), REF_PRESETS, DOUGHS);
    expect(r.allocation.map((l) => l.key)).toEqual(["loaf", "loaf@jalapeno-cheddar"]);
    expect(r.mixes.map((m) => m.id)).toEqual(["base"]);
    const base = mixOf(r, "base");
    expect(base?.doughIds).toEqual([LEAN_DOUGH_ID, "jalapeno-cheddar"]);
    expect(base?.additions).toEqual([]);
    near(base?.addedFlour, 1000);
    near(base?.addedWater, 718.75);
    near(base?.starter, 250);
    near(base?.salt, 22.5);
    near(base?.totalDough, 1991.25);
    near(r.totalFlour, 1125);
    near(r.totalDough, 1991.25);
    // The one mix is the §5.5 batch to the last bit: the split comes out of it later.
    const plain = batchFromStarter(250, REF);
    for (const k of INGREDIENTS) expect(base?.[k]).toBe(plain[k]);

    expect(r.doughs.map((d) => d.doughId)).toEqual([LEAN_DOUGH_ID, "jalapeno-cheddar"]);
    const jal = doughOf(r, "jalapeno-cheddar");
    expect(jal?.method).toBe("split");
    expect(jal?.mixId).toBe("base");
    near(jal?.flour, 285.714);
    near(jal?.portion, 505.714);
    near(addition(jal, "cheese")?.grams, 71.429);
    near(addition(jal, "chilli")?.grams, 22.857);
    near(jal?.additionsTotal, 94.286);
    near(jal?.mass, 600);
    near(jal?.usable, 600);
    expect(jal?.trueHydration).toBeCloseTo(0.75, 9);
    expect(jal?.reason).toBe(
      "Split off at fold 1: cheese and chilli worked into a portion of the main dough.",
    );
    // Decision 11: in a split everything goes in at the split; the line names and notes carry over.
    expect(jal?.additions.map((a) => [a.kind, a.label, a.addAt, a.note])).toEqual([
      ["cheese", "Mature cheddar", "split", "Mostly grated, some chunks for pockets"],
      ["chilli", "Jalapeño, fresh, diced", "split", INCLUSIONS.chilli.note],
    ]);
    const lean = doughOf(r, LEAN_DOUGH_ID);
    expect(lean?.method).toBe("base");
    near(lean?.flour, 839.286);
    near(lean?.mass, 1485.536);

    near(lineOf(r, "loaf")?.weightEach, 1000);
    near(r.spareOrShort, 485.536);
    // Lean's usable dough is its loaf plus the spare.
    near(lean?.usable, 1000 + 485.536);
    const variant = lineOf(r, "loaf@jalapeno-cheddar");
    expect(variant?.doughId).toBe("jalapeno-cheddar");
    expect(variant?.doughName).toBe("Jalapeño cheddar");
    near(variant?.weightEach, 600);
    near(variant?.doughEach, 505.714);
    near(variant?.additionsEach, 94.286);
    near(variant?.pieceEach, 600);
    // 25 % cheddar is a salty load worth a word, nothing more.
    expect(r.warnings.map((w) => [w.code, w.level])).toEqual([["salty-inclusions", "info"]]);
    expect(warning(r, "salty-inclusions")?.message).toMatch(/25% salty add-ins \(mature cheddar\)/);
    expect(warning(r, "salty-inclusions")?.message).toMatch(/1\.6–1\.8%/);
  });

  /*
   * (A2) Example A with the tick box off (weightsIncludeAdditions: false): 600 g is plain dough.
   *   jalapeño-cheddar: flour 600 / 1.77 = 338.983; cheddar 84.746; jalapeño 27.119;
   *     portion 600; piece 711.864
   *   lean loaf: 338.983 flour; 447.034 flour left → +791.25 g → clamps at 1000 g
   *     (564.972 flour); 221.045 flour left = 391.25 g spare base dough
   *   one mix, unchanged: added flour 1000, water 718.75, starter 250, salt 22.5, total 1991.25
   *   doughs: lean flour 786.017, mass 1391.25; jalapeño-cheddar flour 338.983, mass 711.864
   *   division: loaf@jalapeno-cheddar 600 g dough + 111.864 g add-ins = 711.864 g
   */
  it("A2: with the tick box off the add-ins ride on top of the planned dough", () => {
    const r = computePlan(exampleA({ weightsIncludeAdditions: false }), REF_PRESETS, DOUGHS);
    expect(r.mixes.map((m) => m.id)).toEqual(["base"]);
    const base = mixOf(r, "base");
    near(base?.addedFlour, 1000);
    near(base?.addedWater, 718.75);
    near(base?.starter, 250);
    near(base?.salt, 22.5);
    near(base?.totalDough, 1991.25);

    const jal = doughOf(r, "jalapeno-cheddar");
    near(jal?.flour, 338.983);
    near(jal?.portion, 600);
    near(addition(jal, "cheese")?.grams, 84.746);
    near(addition(jal, "chilli")?.grams, 27.119);
    near(jal?.mass, 711.864);
    const lean = doughOf(r, LEAN_DOUGH_ID);
    near(lean?.flour, 786.017);
    near(lean?.mass, 1391.25);

    near(lineOf(r, "loaf")?.weightEach, 1000);
    near(r.spareOrShort, 391.25);
    const variant = lineOf(r, "loaf@jalapeno-cheddar");
    near(variant?.weightEach, 600);
    near(variant?.doughEach, 600);
    near(variant?.additionsEach, 111.864);
    near(variant?.pieceEach, 711.864);
  });

  /*
   * A split dough with butter: example A's plan with the 600 g loaf on buttered (butter 8 %). A split
   * cannot give the butter's water back, so k = 1 + 0.75 + 0.02 + 0.08 = 1.85 (not 1.8372).
   *   flour 600 / 1.85 = 324.324; portion 574.054; butter 25.946; mass 600 = F·k
   *   true hydration 0.75 + 0.08 × 0.16 = 0.7628
   *   the loaf costs 574.054 of the 1991.25 g of base dough; the lean loaf clamps at 1000 g and
   *   417.196 g is spare; lean flour 1125 − 324.324 = 800.676, mass 1991.25 − 574.054 = 1417.196
   */
  it("a split with butter weighs what was planned: its k counts the butter whole", () => {
    const r = computePlan(
      refPlan({
        items: [
          { presetId: "loaf", count: 1 },
          { presetId: "loaf", count: 1, weightOverride: 600, doughId: "buttered" },
        ],
      }),
      REF_PRESETS,
      DOUGHS,
    );
    expect(r.mixes.map((m) => m.id)).toEqual(["base"]);
    const plain = batchFromStarter(250, REF);
    for (const k of INGREDIENTS) expect(mixOf(r, "base")?.[k]).toBe(plain[k]);
    const d = doughOf(r, "buttered");
    expect(d?.method).toBe("split");
    near(d?.flour, 324.324);
    near(d?.portion, 574.054);
    near(addition(d, "butter")?.grams, 25.946);
    expect(addition(d, "butter")?.addAt).toBe("split");
    near(d?.mass, 600);
    expect(d?.mass).toBeCloseTo((d?.flour ?? 0) * 1.85, 9);
    near(d?.usable, 600);
    expect(d?.trueHydration).toBeCloseTo(0.7628, 9);
    expect(d?.reason).toBe("Split off at fold 1: butter worked into a portion of the main dough.");
    expect(lineOf(r, "loaf@buttered")).toMatchObject({
      weightEach: 600,
      doughEach: 600,
      additionsEach: 0,
      pieceEach: 600,
    });
    near(lineOf(r, "loaf")?.weightEach, 1000);
    near(r.spareOrShort, 417.196);
    near(doughOf(r, LEAN_DOUGH_ID)?.flour, 800.676);
    near(doughOf(r, LEAN_DOUGH_ID)?.mass, 1417.196);
    expect(r.warnings).toEqual([]);
  });

  /*
   * (A, 1 % bench loss) The awkward fixture's bench loss on example A. Usable base dough
   * 1991.25 × 0.99 = 1971.338; the pinned jalapeño loaf costs 600 × 1.77/2.10 = 505.714 of it;
   * 865.623 is left, the lean loaf clamps at 1000 g and 465.623 g is spare.
   *   jalapeño-cheddar: flour 600 / 0.99 / 2.10 = 288.600; portion 510.823; cheddar 72.150;
   *     jalapeño 23.088; mass 606.061, usable 600
   *   lean: flour 836.400; mass 1991.25 − 510.823 = 1480.427; usable 1000 + 465.623
   */
  it("A with 1 % bench loss: every dough loses it, the mix does not move", () => {
    const r = computePlan(exampleA({ settings: { ...REF, benchLoss: 0.01 } }), REF_PRESETS, DOUGHS);
    const base = mixOf(r, "base");
    for (const k of ["addedFlour", "addedWater", "starter", "salt", "totalDough"] as const) {
      near(base?.[k], batchFromStarter(250, REF)[k]);
    }
    near(base?.usableDough, 1971.338);
    near(r.spareOrShort, 465.623);
    near(lineOf(r, "loaf")?.weightEach, 1000);
    const jal = doughOf(r, "jalapeno-cheddar");
    near(jal?.flour, 288.6);
    near(jal?.portion, 510.823);
    near(addition(jal, "cheese")?.grams, 72.15);
    near(addition(jal, "chilli")?.grams, 23.088);
    near(jal?.mass, 606.061);
    near(jal?.usable, 600);
    const lean = doughOf(r, LEAN_DOUGH_ID);
    near(lean?.flour, 836.4);
    near(lean?.mass, 1480.427);
    near(lean?.usable, 1000 + 465.623);
    near(lineOf(r, "loaf@jalapeno-cheddar")?.doughEach, (600 * 1.77) / 2.1);
  });

  /*
   * The awkward fixture, starter side: loaf three times (lean and jalapeño-cheddar flexing,
   * seeded pinned at 700 g), the tick box off, 1 % bench loss, a stand mixer. With the box off
   * every loaf costs plain dough at k_dough = 1.77, so all three price alike.
   *   usable 1971.338; fixed 600 + 600 + 700 = 1900; 71.338 left → +35.669 g on each flexing
   *   loaf → 635.669 g, no spare
   *   jalapeño-cheddar: flour 635.669 / 0.99 / 1.77 = 362.763; portion 642.090; cheddar 90.691;
   *     jalapeño 29.021; piece 635.669 + 118.515 = 754.183
   *   seeded: flour 700 / 0.99 / 1.77 = 399.475; portion 707.071; seeds 59.921; soaker water
   *     59.921; piece 700 + 118.644 = 818.644
   *   lean: flour 1125 − 362.763 − 399.475 = 362.763; usable 635.669
   */
  it("three loaves on three doughs, tick box off, bench loss and a pinned variant", () => {
    const r = computePlan(
      refPlan({
        settings: { ...REF, benchLoss: 0.01 },
        standMixer: true,
        weightsIncludeAdditions: false,
        items: [
          { presetId: "loaf", count: 1 },
          { presetId: "loaf", count: 1, doughId: "jalapeno-cheddar" },
          { presetId: "loaf", count: 1, weightOverride: 700, doughId: "seeded" },
        ],
      }),
      REF_PRESETS,
      DOUGHS,
    );
    expect(r.allocation.map((l) => l.key)).toEqual([
      "loaf",
      "loaf@jalapeno-cheddar",
      "loaf@seeded",
    ]);
    expect(r.mixes.map((m) => m.id)).toEqual(["base"]);
    expect(mixOf(r, "base")?.doughIds).toEqual([LEAN_DOUGH_ID, "jalapeno-cheddar", "seeded"]);
    expect(r.doughs.map((d) => d.doughId)).toEqual([LEAN_DOUGH_ID, "jalapeno-cheddar", "seeded"]);
    expect(r.spareOrShort).toBe(0);

    const plain = lineOf(r, "loaf");
    const jalLine = lineOf(r, "loaf@jalapeno-cheddar");
    const seedLine = lineOf(r, "loaf@seeded");
    near(plain?.weightEach, 635.669);
    expect(plain?.adjusted).toBe(true);
    near(jalLine?.weightEach, 635.669);
    near(jalLine?.doughEach, 635.669);
    near(jalLine?.additionsEach, 118.515);
    near(jalLine?.pieceEach, 754.183);
    expect(seedLine).toMatchObject({ pinned: true, weightEach: 700, doughEach: 700 });
    near(seedLine?.additionsEach, 118.644);
    near(seedLine?.pieceEach, 818.644);

    const jal = doughOf(r, "jalapeno-cheddar");
    near(jal?.flour, 362.763);
    near(jal?.portion, 642.09);
    near(addition(jal, "cheese")?.grams, 90.691);
    near(addition(jal, "chilli")?.grams, 29.021);
    near(jal?.usable, 754.183);
    const seeded = doughOf(r, "seeded");
    near(seeded?.flour, 399.475);
    near(seeded?.portion, 707.071);
    near(addition(seeded, "seed")?.grams, 59.921);
    const soaker = addition(seeded, "soaker-water");
    near(soaker?.grams, 59.921);
    expect(soaker?.label).toBe("Soaker water (mixed seeds)");
    expect(soaker?.addAt).toBe("split");
    near(seeded?.usable, 818.644);
    const lean = doughOf(r, LEAN_DOUGH_ID);
    near(lean?.flour, 362.763);
    near(lean?.usable, 635.669);
    // Every dough's usable dough is its finished pieces (no spare here).
    for (const d of r.doughs) {
      const pieces = r.allocation
        .filter((l) => l.doughId === d.doughId)
        .reduce((n, l) => n + l.count * l.pieceEach, 0);
      near(d.usable, pieces);
    }
    expect(codes(r)).toEqual(["salty-inclusions"]);
  });

  /** Worked example B's plan, items mode: two plain loaves and eight 120 g rolls on `doughId`. */
  const exampleB = (doughId: string, doughs: Dough[] = DOUGHS, over: Partial<Plan> = {}) =>
    computePlan(
      refPlan({
        mode: "items",
        items: [
          { presetId: "loaf", count: 2 },
          { presetId: "roll", count: 8, weightOverride: 120, doughId },
        ],
        ...over,
      }),
      REF_PRESETS,
      doughs,
    );

  /*
   * (B) Worked example B — separate. REF settings, items mode; loaf ×2 at 600 lean, roll ×8
   * pinned at 120 on soft-bun (H 0.65, s 0.018, milk 35 %, egg 12 %, butter 12 %, no sugar).
   *   k = 1 + 0.65 + 0.018 + 0.35·0.12 + 0.12·0.24 + 0.12·0.84 = 1.8396
   *   soft-bun mix: flour 960 / 1.8396 = 521.853; added flour 463.869; starter 115.967
   *     (water 57.984); total water 339.204; enrichment water 218.343; added water 62.877;
   *     milk 182.648; egg 62.622; butter 62.622; salt 9.393; total 960
   *   bulk factor 1 (no sugar; butter 12 % is under the 20 % fat term)
   *   lean mix: flour 677.966, added flour 602.637, starter 150.659, water 433.145,
   *     salt 13.559, total 1200
   *   totals: starter 266.626, flour 1199.819
   */
  it("B: an enriched dough gets a mix of its own", () => {
    const r = exampleB("soft-bun");
    expect(r.mixes.map((m) => m.id)).toEqual(["base", "soft-bun"]);
    const bun = mixOf(r, "soft-bun");
    expect(bun?.doughIds).toEqual(["soft-bun"]);
    expect(bun?.label).toBe("Soft bun dough");
    expect(bun?.mixMinutes).toBe(20);
    near(bun?.totalFlour, 521.853);
    near(bun?.addedFlour, 463.869);
    near(bun?.starter, 115.967);
    near(bun?.starterWater, 57.984);
    near(bun?.totalWater, 339.204);
    near(bun?.addedWater, 62.877);
    near(addition(bun, "milk")?.grams, 182.648);
    near(addition(bun, "egg")?.grams, 62.622);
    near(addition(bun, "butter")?.grams, 62.622);
    near(bun?.salt, 9.393);
    near(bun?.totalDough, 960);
    // The water the milk, egg and butter carry: total − starter water − added water.
    near((bun?.totalWater ?? 0) - (bun?.starterWater ?? 0) - (bun?.addedWater ?? 0), 218.343);
    expect(bun?.trueHydration).toBeCloseTo(0.65, 9);
    // Decision 11: butter above 10 % goes in after the mix; milk and egg with it.
    expect(bun?.additions.map((a) => [a.kind, a.addAt])).toEqual([
      ["milk", "mix"],
      ["egg", "mix"],
      ["butter", "after-mix"],
    ]);

    const lean = mixOf(r, "base");
    expect(lean?.doughIds).toEqual([LEAN_DOUGH_ID]);
    expect(lean?.mixMinutes).toBe(10);
    near(lean?.totalFlour, 677.966);
    near(lean?.addedFlour, 602.637);
    near(lean?.starter, 150.659);
    near(lean?.addedWater, 433.145);
    near(lean?.salt, 13.559);
    near(lean?.totalDough, 1200);
    near(r.starter, 266.626);
    near(r.totalFlour, 1199.819);
    // The batch figures are the sums over the mixes.
    near(r.totalDough, 1200 + 960);

    const d = doughOf(r, "soft-bun");
    expect(d?.method).toBe("separate");
    expect(d?.mixId).toBe("soft-bun");
    expect(d?.bulkFactor).toBe(1);
    near(d?.mass, 960);
    near(d?.usable, 960);
    expect(d?.reason).toBe(
      "Mixed separately: egg and milk have to go in with the water; it has its own hydration and salt.",
    );
    expect(d?.notes).toBe(libraryDough("soft-bun").notes);
    expect(r.doughs.map((x) => x.doughId)).toEqual([LEAN_DOUGH_ID, "soft-bun"]);
    expect(lineOf(r, "roll@soft-bun")?.weightEach).toBe(120);
    expect(lineOf(r, "roll@soft-bun")).toMatchObject({
      doughEach: 120,
      additionsEach: 0,
      pieceEach: 120,
    });
    expect(r.warnings).toEqual([]);
  });

  /*
   * The awkward fixture, items side: example B with 100 g less starter on hand than it needs.
   * It needs 266.626 g across both mixes; 166.626 g fits at i = 166.626 / (1199.819 − 83.313)
   * = 0.149239, and at that inoculation the two mixes need exactly 166.626 g between them.
   */
  it("B with the starter on hand 100 g short: the warning and the fix span both mixes", () => {
    const r = exampleB("soft-bun", DOUGHS, { starterAvailable: 166.626 });
    expect(r.inoculationForAvailable).toBeCloseTo(0.149239, 6);
    expect(r.inoculationForAvailable).toBeCloseTo(
      inoculationForStarter(166.626, r.totalFlour, 1),
      12,
    );
    const w = warning(r, "starter-short");
    expect(w?.message).toMatch(/needs 267 g starter but only 167 g/);
    expect(w?.message).toMatch(/14\.9%/);
    const again = exampleB("soft-bun", DOUGHS, {
      settings: { ...REF, inoculation: r.inoculationForAvailable! },
    });
    near(again.starter, 166.626);
    near(
      again.mixes.reduce((n, m) => n + m.starter, 0),
      166.626,
    );
    expect(codes(again)).not.toContain("starter-short");
  });

  /*
   * (B2) The sugar term: example B with the rolls on sweet-bun (soft-bun + sugar 6 %).
   *   k = 1.8396 + 0.06 = 1.8996; flour 960 / 1.8996 = 505.370; sugar line 30.322 g
   *   bulk factor 1 + 0.05 · (6 − 3) = 1.15
   *   With erythritol 4 % instead: sugar-equivalent 4 × 1.5 = 6 %, factor 1.15, k = 1.8796
   *     (so flour 960 / 1.8796 = 510.747 and an erythritol line of 20.430 g)
   */
  it("B2: sugar, or a bulk sweetener, slows the bulk by its sugar-equivalent", () => {
    const r = exampleB("sweet-bun", [...DOUGHS, SWEET_BUN]);
    const d = doughOf(r, "sweet-bun");
    near(d?.flour, 505.37);
    near(addition(mixOf(r, "sweet-bun"), "sugar")?.grams, 30.322);
    expect(addition(mixOf(r, "sweet-bun"), "sugar")).toMatchObject({
      label: "Sugar",
      addAt: "mix",
    });
    near(mixOf(r, "sweet-bun")?.totalDough, 960);
    expect(d?.bulkFactor).toBeCloseTo(1.15, 9);
    expect(d?.reason).toMatch(
      /^Mixed separately: egg, milk and sugar have to go in with the water/,
    );

    const eryBun: Dough = {
      ...SWEET_BUN,
      id: "ery-bun",
      name: "Erythritol bun",
      sweetness: { kind: "erythritol", pct: 0.04 },
    };
    const e = exampleB("ery-bun", [...DOUGHS, eryBun]);
    near(doughOf(e, "ery-bun")?.flour, 510.747);
    near(addition(mixOf(e, "ery-bun"), "erythritol")?.grams, 20.43);
    expect(doughOf(e, "ery-bun")?.bulkFactor).toBeCloseTo(1.15, 9);
    // 4 % is the most erythritol suits, and 6 % sugar-equivalent is not yet a slow bulk.
    expect(codes(e)).toEqual([]);
  });

  /** Worked example B3's plan, items mode: one 800 g loaf on soft-sandwich as given. */
  const exampleB3 = (sandwich: Dough): BatchResult =>
    computePlan(
      refPlan({
        mode: "items",
        items: [{ presetId: "loaf", count: 1, weightOverride: 800, doughId: "soft-sandwich" }],
      }),
      REF_PRESETS,
      libraryWith(sandwich),
    );

  /** §4, verbatim: the note both tangzhong lines carry. */
  const COOK_NOTE =
    "Cook to 65 °C, stirring, to a thick paste that holds a line. Cool to room temperature before it goes in. Made the day before and kept in the fridge is fine: bring it back to room temperature.";

  const weighed = (m: { additions: AdditionLine[] } & Ingredients) =>
    m.addedFlour + m.addedWater + m.starter + m.salt + m.additions.reduce((n, a) => n + a.grams, 0);

  /*
   * (B3) Worked example B3 — tangzhong. REF settings, items mode; loaf ×1 at 800 on
   * soft-sandwich (H 0.70, s 0.018, milk 22 %, butter 12 %, no sugar) with
   * tangzhong { flourPct: 0.05, ratio: 5 }.
   *   k = 1 + 0.70 + 0.018 + 0.22·0.12 + 0.12·0.84 = 1.8452; flour 800 / 1.8452 = 433.557
   *   added flour 385.384; starter 96.346 (water 48.173); total water 303.490; enrichment
   *     water 92.261; added water 163.056; milk 95.383; butter 52.027; salt 7.804; total 800
   *   tangzhong: flour 21.678 (5 % of the flour), liquid 108.389 (×5); the milk (95.383) does
   *     not cover it, so the liquid comes off the water line
   *   as weighed: tangzhong 21.678 flour + 108.389 water (make first), then flour 363.706,
   *     water 54.667, starter 96.346, milk 95.383, butter 52.027, salt 7.804 (sum 800); the
   *     mix totals are those of the same dough without the tangzhong
   *   both tangzhong lines: addAt "mix" and the §4 cook note
   */
  it("B3: a tangzhong comes out of the flour and water lines, not the totals", () => {
    const r = exampleB3({
      ...libraryDough("soft-sandwich"),
      tangzhong: { flourPct: 0.05, ratio: 5 },
    });
    const m = mixOf(r, "soft-sandwich");
    const tzFlour = addition(m, "tangzhong-flour");
    const tzLiquid = addition(m, "tangzhong-liquid");
    near(tzFlour?.grams, 21.678);
    near(tzLiquid?.grams, 108.389);
    expect(tzLiquid?.label).toBe("Tangzhong water");
    near(m?.addedFlour, 363.706);
    near(m?.addedWater, 54.667);
    near(m?.starter, 96.346);
    near(addition(m, "milk")?.grams, 95.383);
    near(addition(m, "butter")?.grams, 52.027);
    near(m?.salt, 7.804);
    near(m ? weighed(m) : 0, 800);
    for (const a of [tzFlour, tzLiquid]) {
      expect(a?.addAt).toBe("mix");
      expect(a?.note).toBe(COOK_NOTE);
    }
    // The paste is made first, so its lines lead.
    expect(m?.additions.slice(0, 2).map((a) => a.kind)).toEqual([
      "tangzhong-flour",
      "tangzhong-liquid",
    ]);
    expect(r.warnings.map((w) => w.code)).not.toContain("tangzhong-liquid-short");
    // The dough itself is unchanged by it: its own lines carry no tangzhong.
    const d = doughOf(r, "soft-sandwich");
    near(d?.addedFlour, 385.384);
    near(d?.addedWater, 163.056);
    expect(d?.additions.map((a) => a.kind)).toEqual(["milk", "butter"]);
    expect(d?.reason).toBe(
      "Mixed separately: milk has to go in with the water; the tangzhong goes in with the liquids; it has its own hydration and salt.",
    );

    const plain = mixOf(exampleB3(libraryDough("soft-sandwich")), "soft-sandwich");
    near(plain?.totalFlour, 433.557);
    near(plain?.totalWater, 303.49);
    near(plain?.totalDough, 800);
    for (const k of ["totalFlour", "totalWater", "totalDough", "starter", "salt"] as const) {
      near(m?.[k], plain?.[k] ?? Number.NaN);
    }
    // B3 is items mode and on one dough only: no base mix, no lean dough.
    expect(r.mixes.map((x) => x.id)).toEqual(["soft-sandwich"]);
    expect(r.doughs.map((x) => x.doughId)).toEqual(["soft-sandwich"]);
  });

  /*
   * Beside B3, a tangzhong the milk does cover: soft-sandwich with milk 60 % and a 1:2 paste.
   *   k = 1 + 0.70 + 0.018 + 0.60·0.12 + 0.12·0.84 = 1.8908; flour 800 / 1.8908 = 423.101
   *   added water 296.171 − 47.011 − 231.521 = 17.639 (no clamp)
   *   tangzhong flour 21.155; liquid 42.310 from the milk (253.861 → 211.551); water stays 17.639;
   *   flour as weighed 376.090 − 21.155 = 354.935
   */
  it("a tangzhong the milk covers takes its liquid from the milk line", () => {
    const r = exampleB3({
      ...libraryDough("soft-sandwich"),
      enrichments: [
        { kind: "milk", pct: 0.6 },
        { kind: "butter", pct: 0.12 },
      ],
      tangzhong: { flourPct: 0.05, ratio: 2 },
    });
    const m = mixOf(r, "soft-sandwich");
    near(addition(m, "tangzhong-flour")?.grams, 21.155);
    near(addition(m, "tangzhong-liquid")?.grams, 42.31);
    expect(addition(m, "tangzhong-liquid")?.label).toBe("Tangzhong milk");
    near(addition(m, "milk")?.grams, 211.551);
    near(addition(m, "milk")?.pct, 211.551 / 423.101);
    near(m?.addedWater, 17.639);
    near(m?.addedFlour, 354.935);
    near(m?.totalFlour, 423.101);
    near(m?.totalDough, 800);
    near(m ? weighed(m) : 0, 800);
    // The dough's own milk line is the whole of it.
    near(addition(doughOf(r, "soft-sandwich"), "milk")?.grams, 253.861);
    expect(codes(r)).toEqual([]);
  });

  /*
   * A tangzhong the water line cannot cover: soft-sandwich (milk 22 %) with 10 % of the flour at
   * 1:5 wants 216.779 g of liquid; the milk (95.383) does not cover it and the water line holds
   * 163.056, so the paste gets 163.056 and the water line goes to 0.
   */
  it("a tangzhong the water cannot cover is clamped and warned about", () => {
    const r = exampleB3({
      ...libraryDough("soft-sandwich"),
      tangzhong: { flourPct: 0.1, ratio: 5 },
    });
    const m = mixOf(r, "soft-sandwich");
    near(addition(m, "tangzhong-flour")?.grams, 43.356);
    near(addition(m, "tangzhong-liquid")?.grams, 163.056);
    expect(m?.addedWater).toBe(0);
    near(m?.addedFlour, 342.029);
    near(m?.totalDough, 800);
    near(m ? weighed(m) : 0, 800);
    const w = warning(r, "tangzhong-liquid-short");
    expect(w?.level).toBe("warn");
    expect(w?.message).toMatch(/wants 217 g of liquid, but the water line holds only 163 g/);
  });

  /*
   * A separate dough carrying inclusions and a tangzhong: soft-bun plus 20 % gruyère, with
   * 5 % of the flour as a 1:5 tangzhong; roll ×8 pinned at 120 g, items mode.
   *   k = 1.8396 + 0.20 = 2.0396; flour 960 / 2.0396 = 470.681; added flour 418.383;
   *   added water 56.712; milk 164.738; egg 56.482; butter 56.482; gruyère 94.136; salt 8.472
   *   tangzhong flour 23.534, liquid 117.670 from the milk (164.738 → 47.068)
   *   per roll: 120 = 108.233 dough + 11.767 add-ins
   */
  it("a separate dough with inclusions and a tangzhong weighs everything in its own mix", () => {
    const cheeseBun: Dough = {
      ...libraryDough("soft-bun"),
      id: "cheese-bun",
      name: "Cheese bun",
      inclusions: [{ kind: "cheese", name: "Gruyère", pct: 0.2 }],
      tangzhong: { flourPct: 0.05, ratio: 5 },
    };
    const r = computePlan(
      refPlan({
        mode: "items",
        items: [{ presetId: "roll", count: 8, weightOverride: 120, doughId: "cheese-bun" }],
      }),
      REF_PRESETS,
      [...DOUGHS, cheeseBun],
    );
    const m = mixOf(r, "cheese-bun");
    near(m?.totalFlour, 470.681);
    near(addition(m, "tangzhong-flour")?.grams, 23.534);
    near(addition(m, "tangzhong-liquid")?.grams, 117.67);
    near(addition(m, "milk")?.grams, 47.068);
    near(addition(m, "egg")?.grams, 56.482);
    near(addition(m, "butter")?.grams, 56.482);
    near(addition(m, "cheese")?.grams, 94.136);
    expect(addition(m, "cheese")).toMatchObject({ label: "Gruyère", addAt: "fold1" });
    near(m?.addedFlour, 418.383 - 23.534);
    near(m?.addedWater, 56.712);
    near(m?.salt, 8.472);
    near(m?.totalDough, 960);
    near(m ? weighed(m) : 0, 960);
    expect(checkRow(m!, false).ok).toBe(true);
    expect(checkRow(m!, true).ok).toBe(true);
    const roll = lineOf(r, "roll@cheese-bun");
    near(roll?.doughEach, 108.233);
    near(roll?.additionsEach, 11.767);
    near(roll?.pieceEach, 120);
    expect(codes(r)).toEqual(["salty-inclusions"]);
  });

  /*
   * Starter mode with every item on a separate dough: the unallocated flour belongs to lean.
   * 250 g starter, roll ×8 pinned at 120 on soft-bun: the rolls take 521.853 g of flour, lean
   * gets 1125 − 521.853 = 603.147 (1067.571 g of spare base dough), and the starter splits
   * 115.967 / 134.033. One more roll costs 120 × 1.77 / 1.8396 = 115.460 g of base dough.
   */
  it("starter mode: the flour the items leave is spare base dough", () => {
    const r = computePlan(
      refPlan({
        items: [{ presetId: "roll", count: 8, weightOverride: 120, doughId: "soft-bun" }],
      }),
      REF_PRESETS,
      DOUGHS,
    );
    expect(r.mixes.map((m) => m.id)).toEqual(["base", "soft-bun"]);
    expect(mixOf(r, "base")?.doughIds).toEqual([LEAN_DOUGH_ID]);
    near(doughOf(r, "soft-bun")?.flour, 521.853);
    near(doughOf(r, LEAN_DOUGH_ID)?.flour, 603.147);
    near(mixOf(r, "soft-bun")?.starter, 115.967);
    near(mixOf(r, "base")?.starter, 134.033);
    near(r.starter, 250);
    near(r.totalFlour, 1125);
    near(r.spareOrShort, 1067.571);
    near(doughOf(r, LEAN_DOUGH_ID)?.usable, 1067.571);
    expect(r.suggestions).toEqual([
      "1068 g spare. Add one more Roll (Soft bun dough) at 120 g and 952 g is left over.",
    ]);
  });

  /*
   * The base mix is absent when its total flour is 0. From the items, eight 120 g rolls on soft-bun
   * and nothing else leave nothing on it: one mix, one dough, and the batch is that mix.
   */
  it("items mode with every line on a separate dough has no base mix and no lean dough", () => {
    const r = computePlan(
      refPlan({
        mode: "items",
        items: [{ presetId: "roll", count: 8, weightOverride: 120, doughId: "soft-bun" }],
      }),
      REF_PRESETS,
      DOUGHS,
    );
    expect(r.mixes.map((m) => m.id)).toEqual(["soft-bun"]);
    expect(r.doughs.map((d) => d.doughId)).toEqual(["soft-bun"]);
    const bun = r.mixes[0]!;
    for (const k of INGREDIENTS) expect(r[k]).toBe(bun[k]);
    near(r.totalDough, 960);
    expect(checkRow(bun, false).ok).toBe(true);
    expect(checkRow(bun, true).ok).toBe(true);
    // Soft-bun has its own salt and nothing reads the batch's, so nothing to say about either.
    expect(r.warnings).toEqual([]);
  });

  it("a plan with no flour has no mix; from the starter, all of it is spare base dough", () => {
    const none = computePlan(refPlan({ mode: "items", items: [] }), REF_PRESETS, DOUGHS);
    expect(none.mixes).toEqual([]);
    expect(none.doughs).toEqual([]);
    for (const k of INGREDIENTS) expect(none[k]).toBe(0);
    expect(none.warnings).toEqual([]);

    const spare = computePlan(refPlan({ items: [] }), REF_PRESETS, DOUGHS);
    expect(spare.mixes.map((m) => m.id)).toEqual(["base"]);
    expect(spare.doughs.map((d) => d.doughId)).toEqual([LEAN_DOUGH_ID]);
    near(spare.doughs[0]?.usable, 1991.25);
    near(spare.spareOrShort, 1991.25);
  });

  /*
   * Starter mode where the separate dough alone needs more than the batch: 100 g starter makes
   * 450 g of flour, eight 120 g soft-bun rolls need 521.853. The roll dough gets the whole batch
   * (no lean dough, no base mix) and the plan is short by 960 × 1.77/1.8396 − 450 × 1.77 = 127.179
   * base-dough grams.
   */
  it("starter mode: doughs that need more than the batch share what there is", () => {
    const r = computePlan(
      refPlan({
        starterWeight: 100,
        items: [{ presetId: "roll", count: 8, weightOverride: 120, doughId: "soft-bun" }],
      }),
      REF_PRESETS,
      DOUGHS,
    );
    expect(r.mixes.map((m) => m.id)).toEqual(["soft-bun"]);
    expect(r.doughs.map((d) => d.doughId)).toEqual(["soft-bun"]);
    near(r.starter, 100);
    near(r.totalFlour, 450);
    near(r.totalDough, 450 * 1.8396);
    near(r.spareOrShort, -127.179);
    expect(warning(r, "short")?.message).toMatch(/short by 127 g/);
    expect(r.suggestions[0]).toBe("Short by 127 g.");
    expect(r.suggestions[1]).toBe("Drop one Roll (Soft bun dough) to free 115 g.");
  });

  it("checkRow is ok for every mix of examples A, B and B3 at both salt roundings", () => {
    const results = [
      computePlan(exampleA(), REF_PRESETS, DOUGHS),
      exampleB("soft-bun"),
      exampleB3({ ...libraryDough("soft-sandwich"), tangzhong: { flourPct: 0.05, ratio: 5 } }),
    ];
    for (const r of results) {
      for (const m of r.mixes) {
        for (const half of [false, true]) {
          const chk = checkRow(m, half);
          expect(chk.ok, `${m.id} ${half} off by ${chk.diff}`).toBe(true);
        }
      }
    }
  });

  /*
   * (C) Liquids beyond the target: soft-bun edited to milk 55 %, egg 12 %, butter 12 %, H 0.62;
   * 500 g flour (one loaf of 500 × 1.8336 = 916.8 g, since
   * k = 1 + 0.62 + 0.018 + 0.55·0.12 + 0.12·0.24 + 0.12·0.84 = 1.8336); 25 % inoculation.
   *   total water 310; starter water 55.556; enrichment water 297.2 → added water −42.756 → 0
   *   liquid-exceeds-hydration (warn) reports the 70.6 % the liquids alone give
   *   mass is the sum of the lines as weighed: 916.8 + 42.756 = 959.556 g
   */
  it("C: liquids beyond the hydration clamp the water line to 0 and warn", () => {
    const wet: Dough = {
      ...libraryDough("soft-bun"),
      hydration: 0.62,
      enrichments: [
        { kind: "milk", pct: 0.55 },
        { kind: "egg", pct: 0.12 },
        { kind: "butter", pct: 0.12 },
      ],
    };
    const r = computePlan(
      refPlan({
        mode: "items",
        items: [{ presetId: "loaf", count: 1, weightOverride: 500 * 1.8336, doughId: "soft-bun" }],
      }),
      REF_PRESETS,
      libraryWith(wet),
    );
    const w = r.warnings.find((x) => x.code === "liquid-exceeds-hydration");
    expect(w?.level).toBe("warn");
    expect(w?.message).toMatch(/70\.6 ?%/);
    expect(w?.message).toMatch(/43 g heavier than planned/);
    expect(w?.message).toMatch(/use less milk/);
    near(doughOf(r, "soft-bun")?.flour, 500);
    expect(doughOf(r, "soft-bun")?.addedWater).toBe(0);
    expect(mixOf(r, "soft-bun")?.addedWater).toBe(0);
    near(doughOf(r, "soft-bun")?.mass, 959.556);
    near(doughOf(r, "soft-bun")?.trueHydration, 0.7055);
    near(mixOf(r, "soft-bun")?.totalDough, 959.556);
    near(mixOf(r, "soft-bun")?.totalWater, 352.756);
    expect(checkRow(mixOf(r, "soft-bun")!, false).ok).toBe(true);
  });

  /*
   * (D) A dough forced to split that holds egg (decision 3) still computes, as a split in the
   * base mix, and raises split-needs-mix (warn) naming the egg.
   */
  it("D: a forced split with egg in it warns that it needs its own mix", () => {
    const eggSplit: Dough = {
      id: "egg-split",
      name: "Golden loaf",
      method: "split",
      enrichments: [{ kind: "egg", pct: 0.1 }],
      inclusions: [],
      splitAt: "fold1",
    };
    const r = computePlan(
      refPlan({
        items: [
          { presetId: "loaf", count: 1 },
          { presetId: "loaf", count: 1, weightOverride: 600, doughId: "egg-split" },
        ],
      }),
      REF_PRESETS,
      [...DOUGHS, eggSplit],
    );
    const w = r.warnings.find((x) => x.code === "split-needs-mix");
    expect(w?.level).toBe("warn");
    expect(w?.message).toMatch(/\begg\b/i);
    expect(w?.message).toBe(
      "Golden loaf is set to split off the main dough, but egg has to go in with the water at the mix. Set its method to auto or separate to give it a mix of its own.",
    );
    expect(doughOf(r, "egg-split")?.method).toBe("split");
    expect(r.mixes.map((m) => m.id)).toEqual(["base"]);
    expect(addition(doughOf(r, "egg-split"), "egg")?.addAt).toBe("split");
    // k = 1.77 + 0.10: the egg counts whole, so the loaf is the 600 g planned (F 320.856).
    near(doughOf(r, "egg-split")?.flour, 320.856);
    near(doughOf(r, "egg-split")?.mass, 600);
  });

  it("D, again: a forced split names its own hydration, salt and tangzhong too", () => {
    const stubborn: Dough = {
      id: "stubborn",
      name: "Stubborn",
      method: "split",
      hydration: 0.9,
      salt: 0.03,
      enrichments: [],
      inclusions: [],
      tangzhong: { flourPct: 0.05, ratio: 5 },
    };
    const r = computePlan(
      refPlan({ items: [{ presetId: "loaf", count: 1, doughId: "stubborn" }] }),
      REF_PRESETS,
      [...DOUGHS, stubborn],
    );
    expect(warning(r, "split-needs-mix")?.message).toMatch(
      /but a tangzhong goes in with the liquids at the mix, and its own hydration and salt need a mix of its own/,
    );
    // Decision 9: as a split it keeps the batch's hydration and salt, and no tangzhong lines.
    expect(doughOf(r, "stubborn")?.trueHydration).toBeCloseTo(0.75, 9);
    expect(doughOf(r, "stubborn")?.additions).toEqual([]);
  });

  /*
   * (E) An item whose dough is not in the library (deleted, or saved in another browser) raises
   * unknown-dough (warn) and computes as lean: the §5.5 figures, loaves at 605.625 g, one mix. It
   * keeps its own key, so it never collides with a lean loaf line.
   */
  it("E: an item on a missing dough computes as lean and says so", () => {
    const r = computePlan(
      refPlan({
        items: [
          { presetId: "pizza", count: 2 },
          { presetId: "roll", count: 4 },
          { presetId: "loaf", count: 2, doughId: "deleted-dough" },
        ],
      }),
      REF_PRESETS,
      DOUGHS,
    );
    expect(r.warnings.map((w) => [w.code, w.level])).toEqual([["unknown-dough", "warn"]]);
    expect(r.warnings[0]?.message).toMatch(/"deleted-dough"/);
    expect(r.warnings[0]?.message).toMatch(/Loaf is planned on the main dough/);
    near(r.addedFlour, 1000);
    near(r.addedWater, 718.75);
    near(r.starter, 250);
    near(r.salt, 22.5);
    near(r.totalDough, 1991.25);
    expect(r.mixes.map((m) => m.id)).toEqual(["base"]);
    expect(r.doughs.map((d) => d.doughId)).toEqual([LEAN_DOUGH_ID]);
    const lean = computePlan(refPlan(), REF_PRESETS, DOUGHS);
    expect(r.allocation.map((l) => [l.presetId, l.weightEach])).toEqual(
      lean.allocation.map((l) => [l.presetId, l.weightEach]),
    );
    expect(r.allocation.find((l) => l.presetId === "loaf")?.weightEach).toBeCloseTo(605.625, 6);
    expect(r.allocation.find((l) => l.presetId === "loaf")).toMatchObject({
      key: "loaf@deleted-dough",
      doughId: LEAN_DOUGH_ID,
      doughName: "Lean (dough deleted-dough not found)",
    });
  });
});

describe("the line naming rule (decision 2)", () => {
  it("names a lane the way it names a line, imported from calc as the timeline does", () => {
    const lane = {
      key: "loaf@jalapeno-cheddar",
      presetId: "loaf",
      name: "Loaf",
      doughId: "jalapeno-cheddar",
      doughName: "Jalapeño cheddar",
      proof: "either",
      steps: [],
    };
    expect(lineLabel(lane)).toBe("Loaf (Jalapeño cheddar)");
    expect(lineLabel({ ...lane, key: "loaf", doughId: LEAN_DOUGH_ID, doughName: "Lean" })).toBe(
      "Loaf",
    );
    expect(
      lineLabel({
        ...lane,
        key: "loaf@x",
        doughId: LEAN_DOUGH_ID,
        doughName: "Lean (dough x not found)",
      }),
    ).toBe("Loaf (dough x not found)");
    const r = computePlan(
      refPlan({ items: [{ presetId: "loaf", count: 1, doughId: "x" }] }),
      REF_PRESETS,
      DOUGHS,
    );
    expect(lineLabel(r.allocation[0]!)).toBe("Loaf (dough x not found)");
  });
});

describe("§4 warnings, dough by dough", () => {
  const plain = (d: Partial<Dough> & Pick<Dough, "id">): Dough => ({
    name: d.id,
    method: "auto",
    enrichments: [],
    inclusions: [],
    ...d,
  });
  /** One 600 g loaf on `dough`, items mode. */
  const loafOn = (dough: Dough, over: Partial<Plan> = {}) =>
    computePlan(
      refPlan({
        mode: "items",
        items: [{ presetId: "loaf", count: 1, weightOverride: 600, doughId: dough.id }],
        ...over,
      }),
      REF_PRESETS,
      [...DOUGHS, dough],
    );

  it("judges high hydration on the dough each sensitive item is made from", () => {
    const wet = { ...REF, hydration: 0.85 };
    const onBuns = computePlan(
      refPlan({
        mode: "items",
        settings: wet,
        items: [
          { presetId: "loaf", count: 1 },
          { presetId: "roll", count: 8, weightOverride: 120, doughId: "soft-bun" },
        ],
      }),
      REF_PRESETS,
      DOUGHS,
    );
    // The rolls are on a 65 % dough; the 85 % loaf is not hydration-sensitive.
    expect(codes(onBuns)).not.toContain("high-hydration");
    const wetBun = { ...libraryDough("soft-bun"), hydration: 0.85 };
    const r = computePlan(
      refPlan({
        mode: "items",
        items: [{ presetId: "roll", count: 8, weightOverride: 120, doughId: "soft-bun" }],
      }),
      REF_PRESETS,
      libraryWith(wetBun),
    );
    expect(warning(r, "high-hydration")?.message).toBe(
      "High hydration in Soft bun dough (85%) — roll will be slack to shape.",
    );
  });

  it("checks each separate dough's own salt, and the batch salt only where it is used", () => {
    const r = loafOn(plain({ id: "low-salt", name: "Low salt", salt: 0.012 }));
    expect(r.warnings.map((w) => [w.code, w.message])).toEqual([
      ["salt-range", "Salt 1.2% in Low salt is outside the usual 1.8–2.5%."],
    ]);
    const salty = { ...REF, salt: 0.03 };
    const own = loafOn(plain({ id: "own-salt", name: "Own salt", salt: 0.02 }), {
      settings: salty,
    });
    expect(codes(own)).not.toContain("salt-range");
    const split = loafOn(plain({ id: "plain-split", method: "split" }), { settings: salty });
    expect(warning(split, "salt-range")?.message).toBe("Salt 3% is outside the usual 1.8–2.5%.");
  });

  it("names the line below its minimum by preset and dough", () => {
    const r = computePlan(
      refPlan({
        items: [{ presetId: "loaf", count: 1, weightOverride: 300, doughId: "jalapeno-cheddar" }],
      }),
      REF_PRESETS,
      DOUGHS,
    );
    expect(warning(r, "below-min")?.message).toMatch(
      /^Loaf \(Jalapeño cheddar\) at 300 g is below its 400 g minimum\./,
    );
  });

  it("notes a heavy add-in load, a high sugar-equivalent and the sweeteners' catches", () => {
    const heavy = loafOn(
      plain({
        id: "heavy",
        name: "Heavy",
        inclusions: [
          { kind: "nut", name: "Walnuts", pct: 0.2 },
          { kind: "dried-fruit", name: "Raisins", pct: 0.2 },
        ],
      }),
    );
    expect(warning(heavy, "inclusion-load")?.message).toMatch(/^Heavy carries 40% add-ins\./);
    expect(codes(heavy)).not.toContain("salty-inclusions");

    const sweet = loafOn(
      plain({ id: "sweet", name: "Sweet", sweetness: { kind: "sugar", pct: 0.15 } }),
    );
    expect(warning(sweet, "sugar-high")?.message).toBe(
      "Sweet: 15% sugar-equivalent. Expect a slow bulk; a sweet or stiff levain helps.",
    );
    const twelve = loafOn(
      plain({ id: "twelve", name: "Twelve", sweetness: { kind: "erythritol", pct: 0.08 } }),
    );
    expect(codes(twelve)).not.toContain("sugar-high"); // exactly 12 %, despite float noise
    expect(warning(twelve, "erythritol-fit")?.message).toMatch(
      /pale and drier; no browning or softness from erythritol/,
    );

    const xylitol = loafOn(
      plain({ id: "xy", name: "Xy", sweetness: { kind: "xylitol", pct: 0.04 } }),
    );
    expect(xylitol.warnings.map((w) => [w.code, w.level])).toEqual([["xylitol-dogs", "info"]]);
    const stevia = loafOn(
      plain({ id: "stevia", name: "Stevia", sweetness: { kind: "high-intensity", pct: 0.0003 } }),
    );
    expect(warning(stevia, "sweetener-label")?.message).toMatch(/check the bulking agent/);
  });

  it("notes a lot of butter worked in by hand, not with a stand mixer", () => {
    const rich = plain({ id: "rich", name: "Rich", enrichments: [{ kind: "butter", pct: 0.35 }] });
    expect(warning(loafOn(rich), "butter-by-hand")?.message).toMatch(/^Rich: 35% butter/);
    expect(codes(loafOn(rich, { standMixer: true }))).not.toContain("butter-by-hand");
    const thirty = plain({ id: "thirty", enrichments: [{ kind: "butter", pct: 0.3 }] });
    expect(codes(loafOn(thirty))).not.toContain("butter-by-hand");
  });

  it("warns once per missing dough, naming every preset on it", () => {
    const r = computePlan(
      refPlan({
        items: [
          { presetId: "loaf", count: 1, doughId: "gone" },
          { presetId: "roll", count: 2, doughId: "gone" },
          { presetId: "pizza", count: 1, doughId: "also-gone" },
        ],
      }),
      REF_PRESETS,
      DOUGHS,
    );
    expect(r.warnings.filter((w) => w.code === "unknown-dough").map((w) => w.message)).toEqual([
      'Dough "gone" is not in the dough library (deleted, or saved in another browser), so Loaf and Roll are planned on the main dough. Pick a dough for them in Items, or add it back on the Presets page.',
      'Dough "also-gone" is not in the dough library (deleted, or saved in another browser), so Pizza base is planned on the main dough. Pick a dough for it in Items, or add it back on the Presets page.',
    ]);
  });
});
