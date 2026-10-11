import { describe, expect, it } from "vitest";
import {
  allocate,
  batchFromItems,
  batchFromStarter,
  computePlan,
  inoculationForStarter,
} from "./calc";
import { cloneDoughs } from "./doughs";
import {
  DEFAULT_SETTINGS,
  LEAN_DOUGH_ID,
  type AdditionLine,
  type BatchResult,
  type Dough,
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
 * is frozen on this copy, not on REF_PRESETS, so preset changes (WP-B) cannot move it.
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

describe("§5.5 reference bake — starter mode", () => {
  const r = computePlan(refPlan(), REF_PRESETS);

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
    );
    expect(r.starter).toBeCloseTo(250, 1);
    expect(r.addedFlour).toBeCloseTo(1000, 0);
    expect(r.trueHydration).toBeCloseTo(0.75, 9);
    expect(r.usableDough).toBeCloseTo(1991.2, 6);
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
    );
    expect(rolls.warnings.map((w) => w.code)).toContain("high-hydration");
    const loaves = computePlan(
      refPlan({ settings: wet, items: [{ presetId: "loaf", count: 1 }] }),
      REF_PRESETS,
    );
    expect(loaves.warnings.map((w) => w.code)).not.toContain("high-hydration");
  });

  it("flags inoculation and salt outside typical ranges", () => {
    const r = computePlan(
      refPlan({ settings: { ...REF, inoculation: 0.05, salt: 0.03 } }),
      REF_PRESETS,
    );
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain("inoculation-range");
    expect(codes).toContain("salt-range");
  });

  it("stays quiet on the defaults", () => {
    const r = computePlan(refPlan({ settings: DEFAULT_SETTINGS }), REF_PRESETS);
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

// Red pins: the multi-dough maths of PLAN-doughs.md §4, written before it exists. Each case is
// expected to fail until WP-C implements §4; WP-C turns them into plain tests and extends them.
// Figures are the plan's worked examples, asserted to 0.01 g.

/** The seeded dough library, unedited. */
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

describe("red pins: §4 multi-dough maths (fail until WP-C)", () => {
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
  it.fails("A: a split dough comes out of the one base mix", () => {
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

    const jal = doughOf(r, "jalapeno-cheddar");
    expect(jal?.method).toBe("split");
    expect(jal?.mixId).toBe("base");
    near(jal?.flour, 285.714);
    near(jal?.portion, 505.714);
    near(addition(jal, "cheese")?.grams, 71.429);
    near(addition(jal, "chilli")?.grams, 22.857);
    near(jal?.additionsTotal, 94.286);
    near(jal?.mass, 600);
    const lean = doughOf(r, LEAN_DOUGH_ID);
    expect(lean?.method).toBe("base");
    near(lean?.flour, 839.286);
    near(lean?.mass, 1485.536);

    near(lineOf(r, "loaf")?.weightEach, 1000);
    near(r.spareOrShort, 485.536);
    const variant = lineOf(r, "loaf@jalapeno-cheddar");
    expect(variant?.doughId).toBe("jalapeno-cheddar");
    near(variant?.weightEach, 600);
    near(variant?.doughEach, 505.714);
    near(variant?.additionsEach, 94.286);
    near(variant?.pieceEach, 600);
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
  it.fails("A2: with the tick box off the add-ins ride on top of the planned dough", () => {
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

  /** Worked example B's plan, items mode: two plain loaves and eight 120 g rolls on `doughId`. */
  const exampleB = (doughId: string, doughs: Dough[] = DOUGHS): BatchResult =>
    computePlan(
      refPlan({
        mode: "items",
        items: [
          { presetId: "loaf", count: 2 },
          { presetId: "roll", count: 8, weightOverride: 120, doughId },
        ],
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
  it.fails("B: an enriched dough gets a mix of its own", () => {
    const r = exampleB("soft-bun");
    expect(r.mixes.map((m) => m.id)).toEqual(["base", "soft-bun"]);
    const bun = mixOf(r, "soft-bun");
    expect(bun?.doughIds).toEqual(["soft-bun"]);
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

    const lean = mixOf(r, "base");
    near(lean?.totalFlour, 677.966);
    near(lean?.addedFlour, 602.637);
    near(lean?.starter, 150.659);
    near(lean?.addedWater, 433.145);
    near(lean?.salt, 13.559);
    near(lean?.totalDough, 1200);
    near(r.starter, 266.626);
    near(r.totalFlour, 1199.819);

    const d = doughOf(r, "soft-bun");
    expect(d?.method).toBe("separate");
    expect(d?.mixId).toBe("soft-bun");
    expect(d?.bulkFactor).toBe(1);
    expect(lineOf(r, "roll@soft-bun")?.weightEach).toBe(120);
  });

  /*
   * (B2) The sugar term: example B with the rolls on sweet-bun (soft-bun + sugar 6 %).
   *   k = 1.8396 + 0.06 = 1.8996; flour 960 / 1.8996 = 505.370; sugar line 30.322 g
   *   bulk factor 1 + 0.05 · (6 − 3) = 1.15
   *   With erythritol 4 % instead: sugar-equivalent 4 × 1.5 = 6 %, factor 1.15, k = 1.8796
   *     (so flour 960 / 1.8796 = 510.747 and an erythritol line of 20.430 g)
   */
  it.fails("B2: sugar, or a bulk sweetener, slows the bulk by its sugar-equivalent", () => {
    const r = exampleB("sweet-bun", [...DOUGHS, SWEET_BUN]);
    const d = doughOf(r, "sweet-bun");
    near(d?.flour, 505.37);
    near(addition(mixOf(r, "sweet-bun"), "sugar")?.grams, 30.322);
    expect(d?.bulkFactor).toBeCloseTo(1.15, 9);

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
  it.fails("B3: a tangzhong comes out of the flour and water lines, not the totals", () => {
    const r = exampleB3({
      ...libraryDough("soft-sandwich"),
      tangzhong: { flourPct: 0.05, ratio: 5 },
    });
    const m = mixOf(r, "soft-sandwich");
    const tzFlour = addition(m, "tangzhong-flour");
    const tzLiquid = addition(m, "tangzhong-liquid");
    near(tzFlour?.grams, 21.678);
    near(tzLiquid?.grams, 108.389);
    near(m?.addedFlour, 363.706);
    near(m?.addedWater, 54.667);
    near(m?.starter, 96.346);
    near(addition(m, "milk")?.grams, 95.383);
    near(addition(m, "butter")?.grams, 52.027);
    near(m?.salt, 7.804);
    const weighed =
      (m?.addedFlour ?? 0) +
      (m?.addedWater ?? 0) +
      (m?.starter ?? 0) +
      (m?.salt ?? 0) +
      (m?.additions ?? []).reduce((sum, a) => sum + a.grams, 0);
    near(weighed, 800);
    for (const a of [tzFlour, tzLiquid]) {
      expect(a?.addAt).toBe("mix");
      expect(a?.note).toBe(COOK_NOTE);
    }
    expect(r.warnings.map((w) => w.code)).not.toContain("tangzhong-liquid-short");

    const plain = mixOf(exampleB3(libraryDough("soft-sandwich")), "soft-sandwich");
    near(plain?.totalFlour, 433.557);
    near(plain?.totalWater, 303.49);
    near(plain?.totalDough, 800);
    for (const k of ["totalFlour", "totalWater", "totalDough", "starter", "salt"] as const) {
      near(m?.[k], plain?.[k] ?? Number.NaN);
    }
  });

  /*
   * (C) Liquids beyond the target: soft-bun edited to milk 55 %, egg 12 %, butter 12 %, H 0.62;
   * 500 g flour (one loaf of 500 × 1.8336 = 916.8 g, since
   * k = 1 + 0.62 + 0.018 + 0.55·0.12 + 0.12·0.24 + 0.12·0.84 = 1.8336); 25 % inoculation.
   *   total water 310; starter water 55.556; enrichment water 297.2 → added water −42.756 → 0
   *   liquid-exceeds-hydration (warn) reports the 70.6 % the liquids alone give
   */
  it.fails("C: liquids beyond the hydration clamp the water line to 0 and warn", () => {
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
    near(doughOf(r, "soft-bun")?.flour, 500);
    expect(doughOf(r, "soft-bun")?.addedWater).toBe(0);
    expect(mixOf(r, "soft-bun")?.addedWater).toBe(0);
  });

  /*
   * (D) A dough forced to split that holds egg (decision 3) still computes, as a split in the
   * base mix, and raises split-needs-mix (warn) naming the egg.
   */
  it.fails("D: a forced split with egg in it warns that it needs its own mix", () => {
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
    expect(doughOf(r, "egg-split")?.method).toBe("split");
    expect(r.mixes.map((m) => m.id)).toEqual(["base"]);
  });

  /*
   * (E) An item whose dough is not in the library (deleted, or saved in another browser) raises
   * unknown-dough (warn) and computes as lean: the §5.5 figures, loaves at 605.625 g, one mix.
   */
  it.fails("E: an item on a missing dough computes as lean and says so", () => {
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
    near(r.addedFlour, 1000);
    near(r.addedWater, 718.75);
    near(r.starter, 250);
    near(r.salt, 22.5);
    near(r.totalDough, 1991.25);
    expect(r.mixes.map((m) => m.id)).toEqual(["base"]);
    const lean = computePlan(refPlan(), REF_PRESETS, DOUGHS);
    expect(r.allocation.map((l) => [l.presetId, l.weightEach])).toEqual(
      lean.allocation.map((l) => [l.presetId, l.weightEach]),
    );
    expect(r.allocation.find((l) => l.presetId === "loaf")?.weightEach).toBeCloseTo(605.625, 6);
  });
});
