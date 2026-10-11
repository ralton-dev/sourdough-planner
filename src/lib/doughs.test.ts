import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOUGHS,
  ENRICHMENTS,
  INCLUSIONS,
  SWEETENERS,
  WATER_FRACTION,
  bulkFactorFor,
  cloneDoughs,
  compositionFactor,
  defaultBulkFactor,
  doughOnlyFactor,
  effectiveMethod,
  enrichmentAddAt,
  enrichmentWater,
  findDough,
  inclusionAddAt,
  leanDough,
  lineKey,
  resolveDoughId,
  separateReasons,
  sugarEquivalent,
  usablePerFlour,
} from "./doughs";
import { LEAN_DOUGH_ID, type Dough, type Preset, type Settings, type Sweetness } from "./types";

const REF: Settings = {
  starterHydration: 1,
  inoculation: 0.25,
  hydration: 0.75,
  salt: 0.02,
  benchLoss: 0,
  doughTempC: 24,
};

const byId = (id: string): Dough => {
  const d = DEFAULT_DOUGHS.find((x) => x.id === id);
  if (!d) throw new Error(`${id} is not in DEFAULT_DOUGHS`);
  return d;
};

/** Test-only (§4 B2): soft-bun plus sugar 6 %. Nothing seeded has sugar (decision 23). */
const SWEET_BUN: Dough = {
  ...byId("soft-bun"),
  id: "sweet-bun",
  name: "Sweet bun",
  sweetness: { kind: "sugar", pct: 0.06 },
};

/** A bare dough under `auto`, for probing the rules one ingredient at a time. */
const bare = (over: Partial<Dough> = {}): Dough => ({
  id: "probe",
  name: "Probe",
  method: "auto",
  enrichments: [],
  inclusions: [],
  ...over,
});
const sweet = (sweetness: Sweetness) => bare({ sweetness });

describe("the seeded library", () => {
  it("resolves every default dough to the method §6 gives it", () => {
    expect(Object.fromEntries(DEFAULT_DOUGHS.map((d) => [d.id, effectiveMethod(d)]))).toEqual({
      "soft-bun": "separate",
      "soft-sandwich": "separate",
      buttered: "split",
      "jalapeno-cheddar": "split",
      seeded: "split",
    });
  });

  it("is sugar-free, uniquely keyed and never claims the lean id", () => {
    expect(DEFAULT_DOUGHS.filter((d) => d.sweetness)).toEqual([]);
    const ids = DEFAULT_DOUGHS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(LEAN_DOUGH_ID);
  });

  it("clones deeply, so editing a copy never edits the defaults", () => {
    const copy = cloneDoughs();
    expect(copy).toEqual(DEFAULT_DOUGHS);
    copy[0]!.enrichments[0]!.pct = 0.9;
    copy[0]!.bake!.tempC = 250;
    copy[3]!.inclusions[0]!.name = "Gruyère";
    expect(byId("soft-bun").enrichments[0]!.pct).toBe(0.35);
    expect(byId("soft-bun").bake!.tempC).toBe(190);
    expect(byId("jalapeno-cheddar").inclusions[0]!.name).toBe("Mature cheddar");
    const withSweetness = cloneDoughs([SWEET_BUN])[0]!;
    withSweetness.sweetness!.pct = 0.1;
    expect(SWEET_BUN.sweetness!.pct).toBe(0.06);
  });

  it("keys every table entry by its own kind, and leaves allulose out (decision 23)", () => {
    for (const table of [ENRICHMENTS, SWEETENERS, INCLUSIONS]) {
      for (const [k, info] of Object.entries(table)) expect(info.kind).toBe(k);
    }
    expect(Object.keys(SWEETENERS)).not.toContain("allulose");
    expect(Object.keys(WATER_FRACTION).sort()).toEqual(
      [...Object.keys(ENRICHMENTS), ...Object.keys(SWEETENERS)].sort(),
    );
  });
});

describe("effective method (decision 3)", () => {
  it("splits for inclusions, butter and oil; separates for egg, yolk and milk", () => {
    expect(effectiveMethod(bare({ enrichments: [{ kind: "butter", pct: 0.08 }] }))).toBe("split");
    expect(effectiveMethod(bare({ enrichments: [{ kind: "oil", pct: 0.05 }] }))).toBe("split");
    expect(effectiveMethod(byId("jalapeno-cheddar"))).toBe("split");
    for (const kind of ["egg", "yolk", "milk"] as const) {
      expect(effectiveMethod(bare({ enrichments: [{ kind, pct: 0.1 }] }))).toBe("separate");
    }
  });

  it("separates for a sweetness above 5 % sugar-equivalent, a tangzhong, or its own settings", () => {
    expect(effectiveMethod(sweet({ kind: "sugar", pct: 0.06 }))).toBe("separate");
    expect(effectiveMethod(sweet({ kind: "sugar", pct: 0.05 }))).toBe("split");
    expect(effectiveMethod(sweet({ kind: "honey", pct: 0.06 }))).toBe("split"); // 4.8 %
    expect(effectiveMethod(sweet({ kind: "erythritol", pct: 0.04 }))).toBe("separate"); // 6 %
    expect(effectiveMethod(sweet({ kind: "high-intensity", pct: 0.0003 }))).toBe("split");
    expect(effectiveMethod(bare({ tangzhong: { flourPct: 0.05, ratio: 5 } }))).toBe("separate");
    expect(effectiveMethod(bare({ hydration: 0.7 }))).toBe("separate");
    expect(effectiveMethod(bare({ salt: 0.018 }))).toBe("separate");
  });

  it("lets a forced method win, and still reports what a forced split cannot carry", () => {
    const eggSplit = bare({ method: "split", enrichments: [{ kind: "egg", pct: 0.1 }] });
    expect(effectiveMethod(eggSplit)).toBe("split");
    expect(separateReasons(eggSplit)).toEqual(["egg"]);
    const butterSeparate = bare({
      method: "separate",
      enrichments: [{ kind: "butter", pct: 0.1 }],
    });
    expect(effectiveMethod(butterSeparate)).toBe("separate");
    expect(separateReasons(butterSeparate)).toEqual([]);
  });

  it("names the reasons in a fixed order", () => {
    expect(separateReasons(byId("soft-bun"))).toEqual(["egg", "milk", "own hydration", "own salt"]);
    expect(separateReasons(SWEET_BUN)).toEqual([
      "egg",
      "milk",
      "sugar",
      "own hydration",
      "own salt",
    ]);
    expect(separateReasons(byId("seeded"))).toEqual([]);
  });
});

describe("bulk factor (decision 10)", () => {
  it("follows the sugar term at 0, 5, 10 and 20 %", () => {
    expect(defaultBulkFactor(bare())).toBe(1);
    expect(defaultBulkFactor(sweet({ kind: "sugar", pct: 0.05 }))).toBeCloseTo(1.1, 9);
    expect(defaultBulkFactor(sweet({ kind: "sugar", pct: 0.1 }))).toBeCloseTo(1.35, 9);
    expect(defaultBulkFactor(sweet({ kind: "sugar", pct: 0.2 }))).toBeCloseTo(1.85, 9);
    expect(defaultBulkFactor(sweet({ kind: "sugar", pct: 0.3 }))).toBe(2); // clamped
  });

  it("weighs each sweetener by its osmotic factor", () => {
    expect(sugarEquivalent(sweet({ kind: "erythritol", pct: 0.04 }))).toBeCloseTo(0.06, 12);
    expect(defaultBulkFactor(sweet({ kind: "erythritol", pct: 0.04 }))).toBeCloseTo(1.15, 9);
    expect(defaultBulkFactor(sweet({ kind: "high-intensity", pct: 0.0003 }))).toBe(1);
    expect(defaultBulkFactor(SWEET_BUN)).toBeCloseTo(1.15, 9);
  });

  it("adds 0.1 once butter and oil reach 20 %", () => {
    expect(defaultBulkFactor(bare({ enrichments: [{ kind: "butter", pct: 0.25 }] }))).toBeCloseTo(
      1.1,
      9,
    );
    expect(defaultBulkFactor(byId("soft-bun"))).toBe(1); // butter 12 %
    const butterAndOil = bare({
      enrichments: [
        { kind: "butter", pct: 0.07 },
        { kind: "oil", pct: 0.13 },
      ],
    });
    expect(defaultBulkFactor(butterAndOil)).toBeCloseTo(1.1, 9); // 20 % despite float noise
  });

  it("uses the dough's own factor when it has a usable one", () => {
    expect(bulkFactorFor({ ...SWEET_BUN, bulkFactor: 1.3 })).toBe(1.3);
    expect(bulkFactorFor({ ...SWEET_BUN, bulkFactor: 0 })).toBeCloseTo(1.15, 9);
    expect(bulkFactorFor({ ...SWEET_BUN, bulkFactor: Number.NaN })).toBeCloseTo(1.15, 9);
  });
});

describe("composition (§4)", () => {
  it("counts the water inside the enrichments and the sweetness", () => {
    // milk 0.35 × 0.88 + egg 0.12 × 0.76 + butter 0.12 × 0.16
    expect(enrichmentWater(byId("soft-bun"))).toBeCloseTo(0.4184, 12);
    expect(enrichmentWater(sweet({ kind: "honey", pct: 0.1 }))).toBeCloseTo(0.017, 12);
  });

  it("gives k for each worked-example dough", () => {
    expect(compositionFactor(byId("jalapeno-cheddar"), REF)).toBeCloseTo(2.1, 12);
    expect(compositionFactor(byId("soft-bun"), REF)).toBeCloseTo(1.8396, 12);
    expect(compositionFactor(byId("soft-sandwich"), REF)).toBeCloseTo(1.8452, 12);
    expect(compositionFactor(SWEET_BUN, REF)).toBeCloseTo(1.8996, 12);
    // A tangzhong moves flour and liquid inside the mix; it does not change k.
    const tz: Dough = { ...byId("soft-sandwich"), tangzhong: { flourPct: 0.05, ratio: 5 } };
    expect(compositionFactor(tz, REF)).toBeCloseTo(1.8452, 12);
    // Soaker water is an add-in like the seeds it soaks.
    expect(compositionFactor(byId("seeded"), REF)).toBeCloseTo(1.77 + 0.15 + 0.15, 12);
  });

  it("takes the add-ins out for k_dough", () => {
    expect(doughOnlyFactor(byId("jalapeno-cheddar"), REF)).toBeCloseTo(1.77, 12);
    expect(doughOnlyFactor(byId("soft-bun"), REF)).toBeCloseTo(1.8396, 12);
    expect(doughOnlyFactor(byId("seeded"), REF)).toBeCloseTo(1.77, 12);
  });

  it("keeps a split dough on the batch hydration and salt (decision 9)", () => {
    const wetSplit: Dough = { ...byId("buttered"), hydration: 0.9, salt: 0.03 };
    expect(compositionFactor(wetSplit, REF)).toBe(compositionFactor(byId("buttered"), REF));
    expect(compositionFactor(byId("buttered"), REF)).toBeCloseTo(1.77 + 0.08 * 0.84, 12);
  });

  it("reads the batch settings for lean", () => {
    expect(compositionFactor(leanDough(), REF)).toBeCloseTo(1.77, 12);
    expect(doughOnlyFactor(leanDough(), { ...REF, hydration: 0.8 })).toBeCloseTo(1.82, 12);
  });

  it("gives usable grams per flour gram by the tick box (decision 6)", () => {
    const jal = byId("jalapeno-cheddar");
    expect(usablePerFlour(jal, REF, {})).toBeCloseTo(2.1, 12);
    expect(usablePerFlour(jal, REF, { weightsIncludeAdditions: true })).toBeCloseTo(2.1, 12);
    expect(usablePerFlour(jal, REF, { weightsIncludeAdditions: false })).toBeCloseTo(1.77, 12);
    expect(usablePerFlour(jal, { ...REF, benchLoss: 0.01 }, {})).toBeCloseTo(2.1 * 0.99, 12);
  });
});

describe("lines and keys (decision 2)", () => {
  const preset = (doughId?: string): Preset => ({
    id: "roll",
    name: "Roll",
    defaultWeight: 70,
    minWeight: 50,
    maxWeight: 130,
    flexPriority: 0,
    proof: "room",
    proofMinutes: [60, 90],
    bake: { tempC: 220, minutes: [18, 22], steam: true },
    doughId,
  });

  it("takes the item's dough, then the preset's, then lean", () => {
    expect(resolveDoughId({ presetId: "roll", count: 1 }, preset())).toBe(LEAN_DOUGH_ID);
    expect(resolveDoughId({ presetId: "roll", count: 1 }, preset("soft-bun"))).toBe("soft-bun");
    expect(
      resolveDoughId({ presetId: "roll", count: 1, doughId: "seeded" }, preset("soft-bun")),
    ).toBe("seeded");
    expect(
      resolveDoughId({ presetId: "roll", count: 1, doughId: LEAN_DOUGH_ID }, preset("soft-bun")),
    ).toBe(LEAN_DOUGH_ID);
    expect(resolveDoughId({ presetId: "roll", count: 1, doughId: "" }, preset("soft-bun"))).toBe(
      "soft-bun",
    );
  });

  it("keys lean lines by preset alone and the rest by preset@dough", () => {
    expect(lineKey("loaf", LEAN_DOUGH_ID)).toBe("loaf");
    expect(lineKey("loaf", "jalapeno-cheddar")).toBe("loaf@jalapeno-cheddar");
  });

  it("finds lean without the library and reports a missing dough as undefined", () => {
    expect(findDough(LEAN_DOUGH_ID, [])).toEqual(leanDough());
    expect(findDough(LEAN_DOUGH_ID, [{ ...byId("seeded"), id: LEAN_DOUGH_ID }])?.name).toBe("Lean");
    expect(findDough("seeded", DEFAULT_DOUGHS)).toBe(byId("seeded"));
    expect(findDough("deleted", DEFAULT_DOUGHS)).toBeUndefined();
  });
});

describe("add-at defaults (decision 11)", () => {
  it("puts butter in after the mix only above 10 %", () => {
    expect(enrichmentAddAt({ kind: "butter", pct: 0.1 })).toBe("mix");
    expect(enrichmentAddAt({ kind: "butter", pct: 0.12 })).toBe("after-mix");
    expect(enrichmentAddAt({ kind: "butter", pct: 0.12, addAt: "mix" })).toBe("mix");
    expect(enrichmentAddAt({ kind: "egg", pct: 0.3 })).toBe("mix");
  });

  it("takes an inclusion's own add-at, else its kind's", () => {
    expect(inclusionAddAt({ kind: "cheese", name: "Cheddar", pct: 0.25 })).toBe("fold1");
    expect(inclusionAddAt({ kind: "seed", name: "Seeds", pct: 0.15 })).toBe("mix");
    expect(inclusionAddAt({ kind: "garlic", name: "Garlic", pct: 0.035 })).toBe("fold2");
    expect(inclusionAddAt({ kind: "cheese", name: "Cheddar", pct: 0.25, addAt: "shape" })).toBe(
      "shape",
    );
  });
});
