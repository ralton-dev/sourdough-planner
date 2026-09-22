import { describe, expect, it } from "vitest";
import {
  allocate,
  batchFromItems,
  batchFromStarter,
  computePlan,
  inoculationForStarter,
} from "./calc";
import { DEFAULT_PRESETS } from "./presets";
import { DEFAULT_SETTINGS, type Plan, type Settings } from "./types";

const REF: Settings = {
  starterHydration: 1,
  inoculation: 0.25,
  hydration: 0.75,
  salt: 0.02,
  benchLoss: 0,
  doughTempC: 24,
};

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
  const r = computePlan(refPlan(), DEFAULT_PRESETS);

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
      DEFAULT_PRESETS,
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
      DEFAULT_PRESETS,
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
    const r = allocate(1000, [{ presetId: "roll", count: 4 }], DEFAULT_PRESETS);
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
      DEFAULT_PRESETS,
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
      DEFAULT_PRESETS,
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
      DEFAULT_PRESETS,
    );
    const loaf = r.allocation.find((l) => l.presetId === "loaf")!;
    expect(loaf.pinned).toBe(true);
    expect(loaf.weightEach).toBe(700);
    expect(r.spareOrShort).toBeCloseTo(2000 - 700 - 140, 9);
  });

  it("flags a pinned weight below the preset minimum", () => {
    const r = computePlan(
      refPlan({ items: [{ presetId: "roll", count: 1, weightOverride: 30 }] }),
      DEFAULT_PRESETS,
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
      DEFAULT_PRESETS,
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
      DEFAULT_PRESETS,
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
      DEFAULT_PRESETS,
    );
    expect(rolls.warnings.map((w) => w.code)).toContain("high-hydration");
    const loaves = computePlan(
      refPlan({ settings: wet, items: [{ presetId: "loaf", count: 1 }] }),
      DEFAULT_PRESETS,
    );
    expect(loaves.warnings.map((w) => w.code)).not.toContain("high-hydration");
  });

  it("flags inoculation and salt outside typical ranges", () => {
    const r = computePlan(
      refPlan({ settings: { ...REF, inoculation: 0.05, salt: 0.03 } }),
      DEFAULT_PRESETS,
    );
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain("inoculation-range");
    expect(codes).toContain("salt-range");
  });

  it("stays quiet on the defaults", () => {
    const r = computePlan(refPlan({ settings: DEFAULT_SETTINGS }), DEFAULT_PRESETS);
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
