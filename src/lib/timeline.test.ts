import { describe, expect, it } from "vitest";
import { computePlan } from "./calc";
import { cloneDoughs } from "./doughs";
import {
  DEFAULT_BULK_TABLE,
  buildTimeline,
  bulkEstimate,
  foldCountFor,
  type Timeline,
  type TimelineStep,
} from "./timeline";
import {
  DEFAULT_SETTINGS,
  LEAN_DOUGH_ID,
  type BatchResult,
  type Dough,
  type ItemSelection,
  type Plan,
  type Preset,
  type Settings,
  type SplitAt,
} from "./types";

/**
 * The five presets as they stood at 187a90a, roll at 70 g: the same frozen copy as calc.test.ts
 * (decision 15), so preset changes (WP-B) cannot move these timelines.
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

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: "t",
  mode: "starter",
  starterWeight: 250,
  items: [
    { presetId: "roll", count: 4 },
    { presetId: "loaf", count: 2 },
    { presetId: "pizza", count: 2 },
  ],
  settings: { ...DEFAULT_SETTINGS, doughTempC: 24, inoculation: 0.25 },
  startTime: "2026-09-22T09:00:00.000Z",
  timelineOverrides: {},
  ...over,
});

const REF: Settings = {
  starterHydration: 1,
  inoculation: 0.25,
  hydration: 0.75,
  salt: 0.02,
  benchLoss: 0,
  doughTempC: 24,
};
const START = new Date("2026-09-22T09:00:00.000Z").getTime();
/** Minutes from the 09:00 start. */
const at = (d: Date | undefined) => (d ? (d.getTime() - START) / 60_000 : Number.NaN);
const run = (s: TimelineStep) => [s.id, at(s.start), s.minutes];
const trackOf = (t: Timeline, doughId: string) => t.tracks.find((tr) => tr.doughId === doughId);
const stepOf = (t: Timeline, id: string) =>
  [...t.steps, ...t.tracks.flatMap((tr) => tr.steps), ...t.lanes.flatMap((l) => l.steps)].find(
    (s) => s.id === id,
  );
/** The base dough's run as one list, as `steps` was before tracks: the prefix, then tracks[0]. */
const baseSteps = (t: Timeline) => [...t.steps, ...(t.tracks[0]?.steps ?? [])];
const laneOf = (t: Timeline, key: string) => t.lanes.find((l) => l.key === key);

/** The seeded dough library, unedited. */
const DOUGHS = cloneDoughs();
/**
 * The timeline as App builds it: from computePlan's result for the same plan, passed explicitly
 * so the parameter can become required (decision 21) without touching these tests.
 */
const build = (p: Plan, doughs: Dough[] = DOUGHS, presets: Preset[] = REF_PRESETS) =>
  buildTimeline(p, presets, DEFAULT_BULK_TABLE, doughs, computePlan(p, presets, doughs));
/** The library with one dough edited. */
const editDough = (id: string, patch: Partial<Dough>): Dough[] =>
  DOUGHS.map((d) => (d.id === id ? { ...d, ...patch } : d));

/** Test-only (§4 B2): soft-bun plus sugar 6 %. Not seeded: no default dough has sugar (decision 23). */
const SWEET_BUN: Dough = {
  ...DOUGHS.find((d) => d.id === "soft-bun")!,
  id: "sweet-bun",
  name: "Sweet bun",
  sweetness: { kind: "sugar", pct: 0.06 },
};

describe("bulk estimate", () => {
  it("reads the table at a listed temperature", () => {
    const e = bulkEstimate(24, 0.22, DEFAULT_BULK_TABLE);
    expect(e.minMinutes).toBe(270);
    expect(e.maxMinutes).toBe(330);
    expect(e.factor).toBe(1);
  });

  it("interpolates between rows and clamps outside them", () => {
    const e = bulkEstimate(23, 0.22, DEFAULT_BULK_TABLE);
    expect(e.minMinutes).toBe(300);
    expect(e.maxMinutes).toBe(360);
    expect(bulkEstimate(10, 0.22, DEFAULT_BULK_TABLE).minMinutes).toBe(420);
    expect(bulkEstimate(40, 0.22, DEFAULT_BULK_TABLE).maxMinutes).toBe(270);
  });

  it("runs about 15 % longer at 15 % inoculation", () => {
    const e = bulkEstimate(24, 0.15, DEFAULT_BULK_TABLE);
    expect(e.factor).toBeCloseTo(1.1, 9);
    expect(e.minMinutes).toBeCloseTo(297, 6);
    expect(bulkEstimate(24, 0.3, DEFAULT_BULK_TABLE).factor).toBeCloseTo(0.9, 9);
  });
});

describe("timeline", () => {
  it("chains core steps from the start time and cascades edits", () => {
    const t = build(plan());
    const steps = baseSteps(t);
    expect(steps.map((s) => s.id)).toEqual(["mix", "bulk", "divide", "bench"]);
    expect(t.steps.map((s) => s.id)).toEqual(["mix"]);
    const start = new Date("2026-09-22T09:00:00.000Z").getTime();
    expect(steps[0]?.start.getTime()).toBe(start);
    expect(steps[0]?.end.getTime()).toBe(start + 10 * 60_000);
    expect(t.tracks[0]?.bulk.usedMinutes).toBe(300);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]?.start.getTime()).toBe(steps[i - 1]?.end.getTime());
    }
    const edited = build(plan({ timelineOverrides: { bulk: 240 } }));
    expect(edited.tracks[0]?.bulk.usedMinutes).toBe(240);
    const shift = 60 * 60_000;
    expect(baseSteps(edited)[2]!.start.getTime()).toBe(steps[2]!.start.getTime() - shift);
    for (const [i, lane] of edited.lanes.entries()) {
      expect(lane.steps[0]!.start.getTime()).toBe(t.lanes[i]!.steps[0]!.start.getTime() - shift);
    }
  });

  it("adds optional feed and autolyse steps first", () => {
    const t = build(plan({ feedStarter: true, autolyse: true }));
    expect(baseSteps(t).map((s) => s.id)).toEqual([
      "feed",
      "autolyse",
      "mix",
      "bulk",
      "divide",
      "bench",
    ]);
    expect(t.steps.map((s) => s.id)).toEqual(["feed", "autolyse", "mix"]);
    expect(t.steps[0]?.minutes).toBe(360);
  });

  it("places four stretch-and-folds at 30 min intervals inside bulk", () => {
    const t = build(plan());
    const base = t.tracks[0]!;
    const bulk = base.steps.find((s) => s.id === "bulk")!;
    expect(base.folds).toHaveLength(4);
    expect(base.folds[0]!.getTime()).toBe(bulk.start.getTime() + 30 * 60_000);
    expect(base.folds[3]!.getTime()).toBe(bulk.start.getTime() + 120 * 60_000);
  });

  it("drops to one early fold with a stand mixer and changes the mix note", () => {
    const t = build(plan({ standMixer: true }));
    const base = t.tracks[0]!;
    const bulk = base.steps.find((s) => s.id === "bulk")!;
    expect(t.foldCount).toBe(1);
    expect(t.defaultFoldCount).toBe(1);
    expect(base.folds).toHaveLength(1);
    expect(base.folds[0]!.getTime()).toBe(bulk.start.getTime() + 30 * 60_000);
    expect(t.steps[0]?.label).toBe("Mix (stand mixer)");
    expect(t.steps[0]?.minutes).toBe(10);
    expect(bulk.start.getTime()).toBe(t.steps[0]?.end.getTime());
  });

  it("lets the fold count be overridden and keeps folds in the first 30 min slots", () => {
    const six = build(plan({ foldCount: 6 }));
    const bulk = six.tracks[0]!.steps.find((s) => s.id === "bulk")!;
    expect(six.tracks[0]!.folds.map((f) => (f.getTime() - bulk.start.getTime()) / 60_000)).toEqual([
      30, 60, 90, 120, 150, 180,
    ]);
    expect(six.defaultFoldCount).toBe(4);
    const mixerTwo = build(plan({ standMixer: true, foldCount: 2 }));
    expect(
      mixerTwo.tracks[0]!.folds.map((f) => (f.getTime() - bulk.start.getTime()) / 60_000),
    ).toEqual([30, 60]);
    const none = build(plan({ foldCount: 0 }));
    expect(none.tracks[0]!.folds).toEqual([]);
    expect(none.foldCount).toBe(0);
  });

  it("falls back to the method default for invalid counts and caps large ones", () => {
    expect(foldCountFor({ foldCount: -1 })).toBe(4);
    expect(foldCountFor({ foldCount: 2.5, standMixer: true })).toBe(1);
    expect(foldCountFor({ foldCount: Number.NaN })).toBe(4);
    expect(foldCountFor({ foldCount: 99 })).toBe(12);
  });

  it("never schedules a fold after bulk ends", () => {
    const t = build(plan({ foldCount: 8, timelineOverrides: { bulk: 100 } }));
    expect(t.tracks[0]!.folds).toHaveLength(3);
  });

  it("gives every selected preset one lane with a bake window", () => {
    const t = build(plan());
    expect(t.lanes.map((l) => l.presetId)).toEqual(["roll", "loaf", "pizza"]);
    const pizza = t.lanes[2]!;
    expect(pizza.proof).toBe("cold");
    const shapeEnd = pizza.steps[0]!.end.getTime();
    expect(pizza.bakeWindow.earliest.getTime()).toBe(shapeEnd + 1440 * 60_000);
    expect(pizza.bakeWindow.latest.getTime()).toBe(shapeEnd + 4320 * 60_000);
    expect(pizza.steps.map((s) => s.id)).toEqual(["shape:pizza", "proof:pizza", "bake:pizza"]);
  });

  it("keeps the base dough alone on tracks when no line uses a library dough", () => {
    const t = build(plan());
    expect(t.tracks.map((tr) => [tr.doughId, tr.method])).toEqual([[LEAN_DOUGH_ID, "base"]]);
    expect(t.tracks[0]!.bulk.doughFactor).toBe(1);
    expect(t.end).toEqual(t.lanes[2]!.steps[2]!.end);
  });

  it("warns on overlapping bakes and suggests shortest first", () => {
    // Give the loaf the same proof as the rolls so their bakes collide.
    const presets = REF_PRESETS.map((p) =>
      p.id === "loaf" ? { ...p, proofMinutes: [60, 90] as [number, number] } : p,
    );
    const t = build(
      plan({
        items: [
          { presetId: "roll", count: 4 },
          { presetId: "loaf", count: 1 },
        ],
      }),
      DOUGHS,
      presets,
    );
    expect(t.ovenWarnings).toHaveLength(1);
    expect(t.ovenWarnings[0]).toMatch(/Suggested order: Roll .*, then Loaf/);
    const clean = build(plan());
    expect(clean.ovenWarnings).toEqual([]);
  });
});

describe("§5 multi-dough timeline", () => {
  const refTimeline = (over: Partial<Plan>, doughs: Dough[] = DOUGHS) =>
    build(plan({ settings: REF, ...over }), doughs);

  /** Example A: loaf ×1 lean and loaf ×1 pinned at 600 g on jalapeno-cheddar (starter mode, 250 g). */
  const EXAMPLE_A: ItemSelection[] = [
    { presetId: "loaf", count: 1 },
    { presetId: "loaf", count: 1, weightOverride: 600, doughId: "jalapeno-cheddar" },
  ];
  /** Example B: loaf ×2 lean and roll ×8 pinned at 120 g on a separate dough (items mode). */
  const exampleB = (doughId = "soft-bun"): ItemSelection[] => [
    { presetId: "loaf", count: 2 },
    { presetId: "roll", count: 8, weightOverride: 120, doughId },
  ];
  /** Example B3: soft-sandwich with its tangzhong, 5 % of the flour at 1:5; loaf ×1 at 800 g. */
  const TZ_DOUGHS = editDough("soft-sandwich", { tangzhong: { flourPct: 0.05, ratio: 5 } });
  const EXAMPLE_B3: ItemSelection[] = [
    { presetId: "loaf", count: 1, weightOverride: 800, doughId: "soft-sandwich" },
  ];

  /*
   * (F) Worked timeline A (start 09:00, 24 °C, hand mixed, REF settings): loaf ×1 lean and
   * loaf ×1 at 600 g on jalapeno-cheddar. Base: mix 09:00–09:10, bulk 09:10–14:10,
   * divide 14:10, bench 14:25–14:50.
   *   split@jalapeno-cheddar 09:40–09:50: fold1 = base bulk start + 30 min, whatever the fold
   *     count, 0 included
   *   bulk@jalapeno-cheddar 09:50–14:10 (base bulk end − split end: factor 1),
   *     divide@jalapeno-cheddar 14:10–14:25, bench@jalapeno-cheddar 14:25–14:50
   *   its folds: the base folds after the split, 10:10 10:40 11:10
   *   two loaf lanes keyed loaf and loaf@jalapeno-cheddar, both baking 16:30–17:15 → one clash
   */
  it("F: a split dough leaves the base bulk at fold 1 and divides with it", () => {
    const items = EXAMPLE_A;
    const t = refTimeline({ items });
    expect(t.tracks.map((tr) => [tr.doughId, tr.method])).toEqual([
      [LEAN_DOUGH_ID, "base"],
      ["jalapeno-cheddar", "split"],
    ]);
    const jal = trackOf(t, "jalapeno-cheddar");
    expect(jal?.steps.map(run)).toEqual([
      ["split@jalapeno-cheddar", 40, 10],
      ["bulk@jalapeno-cheddar", 50, 260],
      ["divide@jalapeno-cheddar", 310, 15],
      ["bench@jalapeno-cheddar", 325, 25],
    ]);
    expect(jal?.folds.map(at)).toEqual([70, 100, 130]);
    expect(at(jal?.benchEnd)).toBe(350);
    const noFolds = trackOf(refTimeline({ items, foldCount: 0 }), "jalapeno-cheddar");
    expect(at(noFolds?.steps[0]?.start)).toBe(40);
    expect(noFolds?.folds).toEqual([]);

    expect(t.lanes.map((l) => [l.key, l.doughId])).toEqual([
      ["loaf", LEAN_DOUGH_ID],
      ["loaf@jalapeno-cheddar", "jalapeno-cheddar"],
    ]);
    const bakes = t.lanes.map((l) => l.steps.find((s) => s.id.startsWith("bake:")));
    expect(bakes.map((b) => [b?.id, at(b?.start), at(b?.end)])).toEqual([
      ["bake:loaf", 450, 495],
      ["bake:loaf@jalapeno-cheddar", 450, 495],
    ]);
    expect(t.ovenWarnings).toHaveLength(1);
    // Two loaves, two names: never "Loaf, Loaf".
    expect(t.ovenWarnings[0]).toMatch(
      /^Oven clash: Loaf, Loaf \(Jalapeño cheddar\) need the oven at the same time\. Suggested order: Loaf .*, then Loaf \(Jalapeño cheddar\) /,
    );
    expect(at(t.end)).toBe(495);
  });

  it("writes the split note with the grams to take and to work in (§5, decision 6)", () => {
    const on = refTimeline({ items: EXAMPLE_A });
    expect(stepOf(on, "split@jalapeno-cheddar")?.note).toBe(
      "Take 506 g of dough for Jalapeño cheddar. Work in 71 g mature cheddar, 23 g jalapeño (fresh, diced). Keep it separate from here on.",
    );
    // A2: the tick box off makes the planned 600 g plain dough, with the add-ins on top.
    const off = refTimeline({ items: EXAMPLE_A, weightsIncludeAdditions: false });
    expect(stepOf(off, "split@jalapeno-cheddar")?.note).toBe(
      "Take 600 g of dough for Jalapeño cheddar. Work in 85 g mature cheddar, 27 g jalapeño (fresh, diced). Keep it separate from here on.",
    );
    // The bake stays the preset's: jalapeño cheddar has no bake override.
    expect(laneOf(on, "loaf@jalapeno-cheddar")?.bakeTempC).toBe(250);
    expect(stepOf(on, "bake:loaf@jalapeno-cheddar")?.note).toBe("250 °C, 40–45 min");
  });

  it("ends a slower split dough after the base bulk and divides it after its own", () => {
    const t = refTimeline({ items: EXAMPLE_A }, editDough("jalapeno-cheddar", { bulkFactor: 1.2 }));
    const jal = trackOf(t, "jalapeno-cheddar")!;
    // Base bulk start + 300 × 1.2 = 370; less the 40 min to the end of the split.
    expect(jal.steps.map(run)).toEqual([
      ["split@jalapeno-cheddar", 40, 10],
      ["bulk@jalapeno-cheddar", 50, 320],
      ["divide@jalapeno-cheddar", 370, 15],
      ["bench@jalapeno-cheddar", 385, 25],
    ]);
    expect(at(stepOf(t, "bulk")?.end)).toBe(310);
    expect(jal.bulk.doughFactor).toBe(1.2);
    expect(jal.bulk.usedMinutes).toBe(320);
    expect(jal.bulk.minMinutes).toBeCloseTo(284, 9);
    expect(jal.bulk.maxMinutes).toBeCloseTo(356, 9);
    expect(jal.folds.map(at)).toEqual([70, 100, 130]);
    expect(at(laneOf(t, "loaf@jalapeno-cheddar")?.steps[0]?.start)).toBe(410);
    expect(at(laneOf(t, "loaf")?.steps[0]?.start)).toBe(350);
  });

  it("splits at the end of the mix or at fold 2 when the dough says so", () => {
    const atMix = trackOf(
      refTimeline({ items: EXAMPLE_A }, editDough("jalapeno-cheddar", { splitAt: "mix" })),
      "jalapeno-cheddar",
    )!;
    expect(atMix.steps.slice(0, 2).map(run)).toEqual([
      ["split@jalapeno-cheddar", 10, 10],
      ["bulk@jalapeno-cheddar", 20, 290],
    ]);
    expect(atMix.folds.map(at)).toEqual([40, 70, 100, 130]);
    const atFold2 = trackOf(
      refTimeline({ items: EXAMPLE_A }, editDough("jalapeno-cheddar", { splitAt: "fold2" })),
      "jalapeno-cheddar",
    )!;
    expect(atFold2.steps.slice(0, 2).map(run)).toEqual([
      ["split@jalapeno-cheddar", 70, 10],
      ["bulk@jalapeno-cheddar", 80, 230],
    ]);
    expect(atFold2.folds.map(at)).toEqual([100, 130]);
    // A split point the code does not know (a hand-edited store) reads as fold 1, never NaN.
    const unknown = trackOf(
      refTimeline(
        { items: EXAMPLE_A },
        editDough("jalapeno-cheddar", { splitAt: "fold9" as SplitAt }),
      ),
      "jalapeno-cheddar",
    )!;
    expect(at(unknown.steps[0]?.start)).toBe(40);
  });

  /*
   * (G) Worked timeline B (start 09:00, 24 °C, hand mixed, REF settings, items mode):
   * loaf ×2 lean and roll ×8 at 120 g on soft-bun.
   *   mix 09:00–09:10; mix@soft-bun 09:10–09:30 (20 min: enriched); bulk@soft-bun 09:30–14:30
   *     (300 min, factor 1) with folds 10:00 10:30 11:00 11:30 (+30/+60/+90/+120 from its own
   *     bulk start); divide@soft-bun 14:30; bench@soft-bun 14:45–15:10
   *   lane roll@soft-bun shapes at 15:10 and bakes at 190 °C without steam (the dough's bake)
   *   on sweet-bun (B2, factor 1.15) its bulk runs 345 min, 09:30–15:15
   * Worked timeline B3 (loaf ×1 at 800 g on soft-sandwich with tangzhong 5 % at 1:5). Nothing is
   * on lean or a split, so there is no main mix (the wave-2 rule; §5 still shows one at 09:45):
   *   no feed, no autolyse: tangzhong@soft-sandwich 09:00–09:45 is steps[0];
   *     mix@soft-sandwich 09:45–10:05; bulk@soft-sandwich 10:05–15:05 (300 min)
   *   the tangzhong note: "… cook 22 g flour with 108 g water …"; the mix@soft-sandwich note
   *     opens "Cooled tangzhong in with the milk and water,"
   *   feedStarter on: tangzhong@soft-sandwich 09:00–09:15, feed 09:15–15:15, mix@soft-sandwich 15:15
   */
  it("G: a separate dough runs its own mix, bulk and divide; a tangzhong opens the day", () => {
    const bunItems = exampleB;
    const t = refTimeline({ mode: "items", items: bunItems("soft-bun") });
    expect(t.tracks.map((tr) => [tr.doughId, tr.method])).toEqual([
      [LEAN_DOUGH_ID, "base"],
      ["soft-bun", "separate"],
    ]);
    const bun = trackOf(t, "soft-bun");
    expect(bun?.steps.map(run)).toEqual([
      ["mix@soft-bun", 10, 20],
      ["bulk@soft-bun", 30, 300],
      ["divide@soft-bun", 330, 15],
      ["bench@soft-bun", 345, 25],
    ]);
    expect(at(bun?.steps[0]?.start)).toBe(at(stepOf(t, "mix")?.end));
    expect(bun?.bulk.doughFactor).toBe(1);
    expect(bun?.folds.map(at)).toEqual([60, 90, 120, 150]);
    const roll = t.lanes.find((l) => l.key === "roll@soft-bun");
    expect(at(roll?.steps[0]?.start)).toBe(370);
    expect(roll?.bakeTempC).toBe(190);
    expect(roll?.steam).toBe(false);
    const bake = roll?.steps.find((s) => s.id === "bake:roll@soft-bun");
    expect(bake?.note).toContain("190 °C");
    expect(bake?.note).not.toContain(", steam"); // the suffix a steamed bake's note carries
    // The base track and its lane do not move for the separate dough beside them.
    expect(t.tracks[0]!.steps.map(run)).toEqual([
      ["bulk", 10, 300],
      ["divide", 310, 15],
      ["bench", 325, 25],
    ]);
    expect(at(laneOf(t, "loaf")?.steps[0]?.start)).toBe(350);

    const sweet = refTimeline({ mode: "items", items: bunItems("sweet-bun") }, [
      ...DOUGHS,
      SWEET_BUN,
    ]);
    const sweetBulk = stepOf(sweet, "bulk@sweet-bun");
    expect([at(sweetBulk?.start), sweetBulk?.minutes, at(sweetBulk?.end)]).toEqual([30, 345, 375]);
    expect(trackOf(sweet, "sweet-bun")?.bulk.doughFactor).toBeCloseTo(1.15, 9);
    // Decision 10: the factor is bulk only, never the preset's proof.
    expect(stepOf(sweet, "proof:roll@sweet-bun")?.minutes).toBe(60);

    const tzDoughs = TZ_DOUGHS;
    const tzItems = EXAMPLE_B3;
    const b3 = refTimeline({ mode: "items", items: tzItems }, tzDoughs);
    const tz = b3.steps[0];
    expect(tz && run(tz)).toEqual(["tangzhong@soft-sandwich", 0, 45]);
    expect(tz?.note).toContain("22 g flour");
    expect(tz?.note).toContain("108 g water");
    // No lean or split line, so no main mix: the sandwich mix follows the paste directly.
    expect(stepOf(b3, "mix")).toBeUndefined();
    const sandwichMix = stepOf(b3, "mix@soft-sandwich");
    expect(sandwichMix?.note).toMatch(/^Cooled tangzhong/);
    expect(at(sandwichMix?.start)).toBe(at(tz?.end));
    const sandwichBulk = stepOf(b3, "bulk@soft-sandwich");
    expect([at(sandwichBulk?.start), sandwichBulk?.minutes]).toEqual([65, 300]);

    const fed = refTimeline({ mode: "items", items: tzItems, feedStarter: true }, tzDoughs);
    expect(fed.steps.map(run)).toEqual([
      ["tangzhong@soft-sandwich", 0, 15],
      ["feed", 15, 360],
    ]);
    expect(at(stepOf(fed, "mix@soft-sandwich")?.start)).toBe(375);
  });

  it("writes the enriched mix routine and the dough's bake (§5, decisions 12 and 13)", () => {
    const t = refTimeline({ mode: "items", items: exampleB() });
    expect(stepOf(t, "mix@soft-bun")?.note).toBe(
      "Milk, egg and water, then the starter, flour and salt: knead to a windowpane. Butter in pieces over 5–8 min. Keep the dough under 26 °C. No sugar, so bake to 88–93 °C inside rather than to colour, and a young levain keeps it mild.",
    );
    expect(stepOf(t, "mix@soft-bun")?.label).toBe("Mix");
    expect(stepOf(t, "bake:roll@soft-bun")?.note).toBe(
      "190 °C, 18–22 min, wash: egg + a splash of milk",
    );
    // The lean lane keeps the preset's bake, steam and all.
    expect(stepOf(t, "bake:loaf")?.note).toBe("250 °C, 40–45 min");
    const mixer = refTimeline({ mode: "items", items: exampleB(), standMixer: true });
    expect(stepOf(mixer, "mix@soft-bun")?.label).toBe("Mix (stand mixer)");
    expect(stepOf(mixer, "mix@soft-bun")?.note).toContain("dough hook to a windowpane");
    expect(stepOf(mixer, "mix@soft-bun")?.note).toContain("the mixer warms it");
    // A separate dough with nothing in it but its own hydration mixes like the lean dough.
    const wet = refTimeline({ mode: "items", items: exampleB("wet") }, [
      ...DOUGHS,
      { id: "wet", name: "Wet", method: "auto", hydration: 0.85, enrichments: [], inclusions: [] },
    ]);
    expect(stepOf(wet, "mix@wet")?.minutes).toBe(10);
    expect(stepOf(wet, "mix@wet")?.note).toBe(
      "Add starter and salt. Reserve ~20 g water for the salt.",
    );
    expect(stepOf(wet, "bake:roll@wet")?.note).toBe("220 °C, 18–22 min, steam");
  });

  it("opens worked timeline B3 with the tangzhong, with and without a feed (§5)", () => {
    const b3 = refTimeline({ mode: "items", items: EXAMPLE_B3 }, TZ_DOUGHS);
    // Nothing is on lean or a split: no main mix and no base track.
    expect(b3.steps.map(run)).toEqual([["tangzhong@soft-sandwich", 0, 45]]);
    expect(b3.tracks.map((tr) => tr.doughId)).toEqual(["soft-sandwich"]);
    expect(trackOf(b3, "soft-sandwich")?.steps.map(run)).toEqual([
      ["mix@soft-sandwich", 45, 20],
      ["bulk@soft-sandwich", 65, 300],
      ["divide@soft-sandwich", 365, 15],
      ["bench@soft-sandwich", 380, 25],
    ]);
    expect(b3.steps[0]?.label).toBe("Cook tangzhong");
    expect(b3.steps[0]?.note).toBe(
      "Tangzhong for Soft sandwich dough: cook 22 g flour with 108 g water, stirring, to 65 °C, a thick paste that holds a line. Cool to room temperature before it goes in. Made the day before and kept in the fridge is fine: bring it back to room temperature. If it waits more than about two hours (it will while the starter feeds), keep it in the fridge and bring it back to room temperature before the mix.",
    );
    expect(stepOf(b3, "mix@soft-sandwich")?.note).toMatch(
      /^Cooled tangzhong in with the milk and water, then the starter, flour and salt: knead to a windowpane\. Butter in pieces over 5–8 min\./,
    );
    // The loaf proofs and bakes from its own dough's bench rest, at the dough's 190 °C.
    expect(laneOf(b3, "loaf@soft-sandwich")?.steps.map(run)).toEqual([
      ["shape:loaf@soft-sandwich", 405, 10],
      ["proof:loaf@soft-sandwich", 415, 90],
      ["bake:loaf@soft-sandwich", 505, 45],
    ]);
    expect(stepOf(b3, "bake:loaf@soft-sandwich")?.note).toBe(
      "190 °C, 40–45 min, wash: none under a lid; egg wash if open",
    );
    expect(at(b3.end)).toBe(550);

    const fed = refTimeline({ mode: "items", items: EXAMPLE_B3, feedStarter: true }, TZ_DOUGHS);
    expect(fed.steps.map(run)).toEqual([
      ["tangzhong@soft-sandwich", 0, 15],
      ["feed", 15, 360],
    ]);
    expect(at(stepOf(fed, "mix@soft-sandwich")?.start)).toBe(375);
    // With no main mix there is nothing to autolyse, so nothing to cool the paste during.
    const alone = refTimeline({ mode: "items", items: EXAMPLE_B3, autolyse: true }, TZ_DOUGHS);
    expect(alone.steps.map(run)).toEqual([["tangzhong@soft-sandwich", 0, 45]]);
    // A lean loaf brings the main mix back, and its autolyse gives the paste time to cool.
    const rested = refTimeline(
      { mode: "items", items: [...EXAMPLE_B3, { presetId: "loaf", count: 1 }], autolyse: true },
      TZ_DOUGHS,
    );
    expect(rested.steps.map(run)).toEqual([
      ["tangzhong@soft-sandwich", 0, 15],
      ["autolyse", 15, 45],
      ["mix", 60, 10],
    ]);
    expect(at(stepOf(rested, "mix@soft-sandwich")?.start)).toBe(70);
    // The step is the dough's own: an override on it moves everything after it.
    const slow = refTimeline(
      {
        mode: "items",
        items: EXAMPLE_B3,
        timelineOverrides: { "tangzhong@soft-sandwich": 60 },
      },
      TZ_DOUGHS,
    );
    expect(at(stepOf(slow, "mix@soft-sandwich")?.start)).toBe(60);
  });

  it("leaves out the main mix when nothing is on it (items mode, separate doughs only)", () => {
    const items = [{ presetId: "roll", count: 8, weightOverride: 120, doughId: "soft-bun" }];
    const t = refTimeline({ mode: "items", items });
    expect(t.steps.map((s) => s.id)).toEqual([]);
    expect(t.tracks.map((tr) => tr.doughId)).toEqual(["soft-bun"]);
    expect(trackOf(t, "soft-bun")?.steps.map(run)).toEqual([
      ["mix@soft-bun", 0, 20],
      ["bulk@soft-bun", 20, 300],
      ["divide@soft-bun", 320, 15],
      ["bench@soft-bun", 335, 25],
    ]);
    expect(at(laneOf(t, "roll@soft-bun")?.steps[0]?.start)).toBe(360);
    const fed = refTimeline({ mode: "items", items, feedStarter: true });
    expect(fed.steps.map(run)).toEqual([["feed", 0, 360]]);
    expect(at(stepOf(fed, "mix@soft-bun")?.start)).toBe(360);
    // The autolyse belongs to the main mix: with none, there is none.
    expect(refTimeline({ mode: "items", items, autolyse: true }).steps).toEqual([]);
    // Starter mode always keeps the main mix: the flour the buns leave is lean dough.
    expect(refTimeline({ items }).steps.map((s) => s.id)).toEqual(["mix"]);
    // Nothing planned at all: nothing to mix, nothing to time.
    const empty = refTimeline({ mode: "items", items: [] });
    expect([empty.steps, empty.tracks, empty.lanes, at(empty.end)]).toEqual([[], [], [], 0]);
  });

  it("quotes computePlan's grams, never its own: the split portion and the tangzhong lines", () => {
    const pA = plan({ settings: REF, items: EXAMPLE_A });
    const rA = computePlan(pA, REF_PRESETS, DOUGHS);
    const jal = rA.doughs.find((d) => d.doughId === "jalapeno-cheddar")!;
    const splitNote = (r: BatchResult) =>
      stepOf(
        buildTimeline(pA, REF_PRESETS, DEFAULT_BULK_TABLE, DOUGHS, r),
        "split@jalapeno-cheddar",
      )?.note;
    expect(splitNote(rA)).toMatch(
      new RegExp(`^Take ${Math.round(jal.portion!)} g of dough for Jalapeño cheddar\\.`),
    );
    // Whatever the result says is what the note says.
    const doctored: BatchResult = {
      ...rA,
      doughs: rA.doughs.map((d) => (d === jal ? { ...d, portion: 777.4 } : d)),
    };
    expect(splitNote(doctored)).toMatch(/^Take 777 g of dough/);

    const p3 = plan({ settings: REF, mode: "items", items: EXAMPLE_B3 });
    const r3 = computePlan(p3, REF_PRESETS, TZ_DOUGHS);
    const lines = [...r3.doughs, ...r3.mixes].flatMap((x) => x.additions);
    const flour = lines.find((a) => a.kind === "tangzhong-flour")!;
    const liquid = lines.find((a) => a.kind === "tangzhong-liquid")!;
    const note = buildTimeline(p3, REF_PRESETS, DEFAULT_BULK_TABLE, TZ_DOUGHS, r3).steps[0]?.note;
    expect(note).toContain(
      `cook ${Math.round(flour.grams)} g flour with ${Math.round(liquid.grams)} g water,`,
    );
    expect([Math.round(flour.grams), Math.round(liquid.grams)]).toEqual([22, 108]);
  });

  it("takes the tangzhong liquid from the milk when the milk covers it", () => {
    const milky = editDough("soft-sandwich", {
      enrichments: [
        { kind: "milk", pct: 0.6 },
        { kind: "butter", pct: 0.12 },
      ],
      tangzhong: { flourPct: 0.05, ratio: 2 },
    });
    const t = refTimeline({ mode: "items", items: EXAMPLE_B3 }, milky);
    expect(t.steps[0]?.note).toMatch(
      /^Tangzhong for Soft sandwich dough: cook 21 g flour with 42 g milk,/,
    );
    expect(stepOf(t, "mix@soft-sandwich")?.note).toMatch(
      /^Cooled tangzhong in with the milk and water, then/,
    );
    // A paste that wants no liquid is no tangzhong: computePlan writes no lines, so no step.
    const dry = editDough("buttered", {
      method: "separate",
      tangzhong: { flourPct: 0.05, ratio: 0 },
    });
    const noPaste = refTimeline(
      { items: [{ presetId: "loaf", count: 1, doughId: "buttered" }] },
      dry,
    );
    expect(noPaste.steps.map((s) => s.id)).toEqual(["mix"]);
    // A forced split cannot hold a tangzhong: no step for it.
    const forced = editDough("jalapeno-cheddar", { tangzhong: { flourPct: 0.05, ratio: 5 } });
    expect(refTimeline({ items: EXAMPLE_A }, forced).steps.map((s) => s.id)).toEqual(["mix"]);
  });

  it("puts a separate dough's add-ins where they go in (decision 11)", () => {
    const seededBun: Dough = {
      ...DOUGHS.find((d) => d.id === "soft-bun")!,
      id: "seeded-bun",
      name: "Seeded bun",
      tangzhong: { flourPct: 0.05, ratio: 5 },
      inclusions: [
        { kind: "seed", name: "Mixed seeds", pct: 0.05, soakerWaterPct: 0.05 },
        { kind: "nut", name: "Walnuts, toasted", pct: 0.1 },
        { kind: "chocolate", name: "Dark chocolate", pct: 0.2, addAt: "shape" },
      ],
    };
    const t = refTimeline(
      {
        mode: "items",
        items: [{ presetId: "roll", count: 6, weightOverride: 100, doughId: "seeded-bun" }],
      },
      [...DOUGHS, seededBun],
    );
    // k 2.2396, flour 267.905: the milk (93.8 g) covers the paste's 67 g.
    expect(t.steps[0]?.note).toMatch(/: cook 13 g flour with 67 g milk,/);
    expect(stepOf(t, "mix@seeded-bun")?.note).toBe(
      "Cooled tangzhong in with the milk, egg and water, then the starter, flour and salt: knead to a windowpane. Butter in pieces over 5–8 min. Keep the dough under 26 °C. At the end, work in 13 g mixed seeds soaked in 13 g water. No sugar, so bake to 88–93 °C inside rather than to colour, and a young levain keeps it mild.",
    );
    expect(stepOf(t, "bulk@seeded-bun")?.note).toBe(
      "Go by the dough, not the clock. 30 min in (fold 1), work in 27 g walnuts (toasted).",
    );
    expect(stepOf(t, "shape:roll@seeded-bun")?.note).toBe(
      "Tight pre-shape; proofs fastest; bake first. Steam for the first 8 min. Tuck 9 g dark chocolate into each piece as you shape.",
    );
  });

  it("moves an override on bulk@soft-bun through its own track only (§10)", () => {
    const busy = { mode: "items" as const, items: exampleB(), feedStarter: true, autolyse: true };
    const t = refTimeline(busy);
    const edited = refTimeline({ ...busy, timelineOverrides: { "bulk@soft-bun": 240 } });
    expect(edited.steps.map(run)).toEqual([
      ["feed", 0, 360],
      ["autolyse", 360, 45],
      ["mix", 405, 10],
    ]);
    expect(trackOf(edited, "soft-bun")?.steps.map(run)).toEqual([
      ["mix@soft-bun", 415, 20],
      ["bulk@soft-bun", 435, 240],
      ["divide@soft-bun", 675, 15],
      ["bench@soft-bun", 690, 25],
    ]);
    expect(at(laneOf(edited, "roll@soft-bun")?.steps[0]?.start)).toBe(715);
    expect(at(laneOf(t, "roll@soft-bun")?.steps[0]?.start)).toBe(775);
    // The base track and its lane stay where they were.
    expect(edited.tracks[0]!.steps.map(run)).toEqual(t.tracks[0]!.steps.map(run));
    expect(edited.tracks[0]!.folds).toEqual(t.tracks[0]!.folds);
    expect(laneOf(edited, "loaf")?.steps.map(run)).toEqual(laneOf(t, "loaf")?.steps.map(run));
  });

  it("moves a split dough with an edit to the base bulk, never a separate dough", () => {
    const items = [
      ...EXAMPLE_A,
      { presetId: "roll", count: 8, weightOverride: 120, doughId: "soft-bun" },
    ];
    const t = refTimeline({ items });
    const edited = refTimeline({ items, timelineOverrides: { bulk: 240 } });
    // Same dough as the base, so it still ends with it.
    expect(at(stepOf(edited, "bulk@jalapeno-cheddar")?.end)).toBe(250);
    expect(stepOf(edited, "bulk@jalapeno-cheddar")?.minutes).toBe(200);
    expect(trackOf(edited, "soft-bun")?.steps.map(run)).toEqual(
      trackOf(t, "soft-bun")?.steps.map(run),
    );
  });

  it("feeds once and mixes the separate doughs one after another in library order", () => {
    // Listed sandwich first: the mixes still follow the library, soft-bun before soft-sandwich.
    const items = [...EXAMPLE_B3, ...exampleB()];
    const t = refTimeline({ mode: "items", items, feedStarter: true }, TZ_DOUGHS);
    expect(t.steps.map((s) => s.id)).toEqual(["tangzhong@soft-sandwich", "feed", "mix"]);
    expect(t.tracks.map((tr) => tr.doughId)).toEqual([LEAN_DOUGH_ID, "soft-bun", "soft-sandwich"]);
    expect(t.tracks.slice(1).map((tr) => run(tr.steps[0]!))).toEqual([
      ["mix@soft-bun", 385, 20],
      ["mix@soft-sandwich", 405, 20],
    ]);
    expect(t.lanes.map((l) => l.key)).toEqual(["loaf@soft-sandwich", "loaf", "roll@soft-bun"]);
  });

  it("flexes a variant line with the rest in starter mode, so the split note matches (§4)", () => {
    // 150 g starter, 1 % bench loss, stand mixer: both loaves shrink to 489.893 g in flour terms;
    // the jalapeño loaf's dough holds 235.639 g of flour.
    const t = refTimeline({
      starterWeight: 150,
      standMixer: true,
      settings: { ...REF, benchLoss: 0.01 },
      items: [
        { presetId: "loaf", count: 1 },
        { presetId: "loaf", count: 1, doughId: "jalapeno-cheddar" },
        { presetId: "roll", count: 4 },
      ],
    });
    expect(stepOf(t, "split@jalapeno-cheddar")?.note).toBe(
      "Take 417 g of dough for Jalapeño cheddar. Work in 59 g mature cheddar, 19 g jalapeño (fresh, diced). Keep it separate from here on.",
    );
    // The one mixer fold is the moment of the split, so the split dough has none after it.
    expect(t.tracks[0]!.folds.map(at)).toEqual([40]);
    expect(trackOf(t, "jalapeno-cheddar")?.folds).toEqual([]);
  });

  it("gives loaf three times its three doughs with the tick box off (§10)", () => {
    // 250 g starter, 1 % bench loss: three loaves at 657.1 g, 375 g of flour each.
    const t = refTimeline({
      weightsIncludeAdditions: false,
      settings: { ...REF, benchLoss: 0.01 },
      items: [
        { presetId: "loaf", count: 1 },
        { presetId: "loaf", count: 1, doughId: "jalapeno-cheddar" },
        { presetId: "loaf", count: 1, doughId: "seeded" },
      ],
    });
    expect(t.tracks.map((tr) => tr.doughId)).toEqual([LEAN_DOUGH_ID, "jalapeno-cheddar", "seeded"]);
    expect(stepOf(t, "split@jalapeno-cheddar")?.note).toBe(
      "Take 664 g of dough for Jalapeño cheddar. Work in 94 g mature cheddar, 30 g jalapeño (fresh, diced). Keep it separate from here on.",
    );
    expect(stepOf(t, "split@seeded")?.note).toBe(
      "Take 664 g of dough for Seeded. Work in 56 g mixed seeds (sunflower, sesame, flax) soaked in 56 g water. Keep it separate from here on.",
    );
    expect(t.lanes.map((l) => l.key)).toEqual(["loaf", "loaf@jalapeno-cheddar", "loaf@seeded"]);
    expect(t.ovenWarnings).toHaveLength(1);
    expect(t.ovenWarnings[0]).toMatch(
      /^Oven clash: Loaf, Loaf \(Jalapeño cheddar\), Loaf \(Seeded\) need the oven/,
    );
  });

  it("keeps a line on a deleted dough on its own key, timed as lean (decision 2)", () => {
    const t = refTimeline({
      items: [
        { presetId: "loaf", count: 1 },
        { presetId: "loaf", count: 1, doughId: "gone" },
      ],
    });
    expect(t.tracks.map((tr) => tr.doughId)).toEqual([LEAN_DOUGH_ID]);
    // Its own key, so it never merges with the lean loaf; timed as lean, so it reads lean.
    expect(t.lanes.map((l) => [l.key, l.doughId, l.doughName])).toEqual([
      ["loaf", LEAN_DOUGH_ID, "Lean"],
      ["loaf@gone", LEAN_DOUGH_ID, "Lean (dough gone not found)"],
    ]);
    expect(laneOf(t, "loaf@gone")?.steps.map(run)).toEqual([
      ["shape:loaf@gone", 350, 10],
      ["proof:loaf@gone", 360, 90],
      ["bake:loaf@gone", 450, 45],
    ]);
    expect(laneOf(t, "loaf@gone")?.bakeTempC).toBe(250);
    expect(t.ovenWarnings[0]).toMatch(
      /^Oven clash: Loaf, Loaf \(dough gone not found\) need the oven/,
    );
  });

  it("never asks a split for more dough than a short batch made (§4)", () => {
    // 50 g of starter holds 225 g of flour. The two pinned jalapeño loaves alone need 571.4 g, so
    // lean gets none and the jalapeño dough has all 225 g: 398 g of base dough, not 1011 g.
    const t = refTimeline({
      starterWeight: 50,
      items: [
        { presetId: "loaf", count: 1 },
        { presetId: "loaf", count: 2, weightOverride: 600, doughId: "jalapeno-cheddar" },
      ],
    });
    expect(stepOf(t, "split@jalapeno-cheddar")?.note).toBe(
      "Take 398 g of dough for Jalapeño cheddar. Work in 56 g mature cheddar, 18 g jalapeño (fresh, diced). Keep it separate from here on.",
    );
  });

  it("labels each lane as messages name its line: lean, a dough, a missing dough", () => {
    const t = refTimeline({
      items: [
        { presetId: "loaf", count: 1 },
        { presetId: "loaf", count: 1, doughId: "jalapeno-cheddar" },
        { presetId: "loaf", count: 1, doughId: "gone" },
      ],
    });
    expect(t.lanes.map((l) => [l.key, l.label])).toEqual([
      ["loaf", "Loaf"],
      ["loaf@jalapeno-cheddar", "Loaf (Jalapeño cheddar)"],
      ["loaf@gone", "Loaf (dough gone not found)"],
    ]);
  });
});

// Pin H, the tripwire: the all-lean plan must not move a minute (§10). It passed before WP-D and
// keeps passing with the base steps split between `steps` (the prefix) and `tracks[0]`.
describe("the all-lean plan does not move (pin H)", () => {
  const baseRun = (t: Timeline) => baseSteps(t).map(run);
  const baseFolds = (t: Timeline): Date[] => t.tracks[0]?.folds ?? [];

  it("H: keeps today's step ids, times, folds and lane keys", () => {
    const t = build(plan());
    expect(baseRun(t)).toEqual([
      ["mix", 0, 10],
      ["bulk", 10, 300],
      ["divide", 310, 15],
      ["bench", 325, 25],
    ]);
    expect(baseFolds(t).map(at)).toEqual([40, 70, 100, 130]);
    expect(t.lanes.map((l) => [l.key, l.doughId, l.steps.map(run)])).toEqual([
      [
        "roll",
        LEAN_DOUGH_ID,
        [
          ["shape:roll", 350, 10],
          ["proof:roll", 360, 60],
          ["bake:roll", 420, 22],
        ],
      ],
      [
        "loaf",
        LEAN_DOUGH_ID,
        [
          ["shape:loaf", 350, 10],
          ["proof:loaf", 360, 90],
          ["bake:loaf", 450, 45],
        ],
      ],
      [
        "pizza",
        LEAN_DOUGH_ID,
        [
          ["shape:pizza", 350, 10],
          ["proof:pizza", 360, 1440],
          ["bake:pizza", 1800, 8],
        ],
      ],
    ]);
    expect(t.ovenWarnings).toEqual([]);

    // Feed, autolyse, a stand mixer and saved overrides keep their ids and cascade as today.
    const busy = build(
      plan({
        feedStarter: true,
        autolyse: true,
        standMixer: true,
        timelineOverrides: { bulk: 240, "proof:loaf": 120 },
      }),
    );
    expect(baseRun(busy)).toEqual([
      ["feed", 0, 360],
      ["autolyse", 360, 45],
      ["mix", 405, 10],
      ["bulk", 415, 240],
      ["divide", 655, 15],
      ["bench", 670, 25],
    ]);
    expect(baseFolds(busy).map(at)).toEqual([445]);
    expect(busy.lanes.find((l) => l.key === "loaf")?.steps.map(run)).toEqual([
      ["shape:loaf", 695, 10],
      ["proof:loaf", 705, 120],
      ["bake:loaf", 825, 45],
    ]);
  });
});
