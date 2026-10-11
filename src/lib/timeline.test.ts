import { describe, expect, it } from "vitest";
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
  type Dough,
  type Plan,
  type Preset,
  type Settings,
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
    const t = buildTimeline(plan(), REF_PRESETS, DEFAULT_BULK_TABLE);
    const ids = t.steps.map((s) => s.id);
    expect(ids).toEqual(["mix", "bulk", "divide", "bench"]);
    const start = new Date("2026-09-22T09:00:00.000Z").getTime();
    expect(t.steps[0]?.start.getTime()).toBe(start);
    expect(t.steps[0]?.end.getTime()).toBe(start + 10 * 60_000);
    expect(t.bulk.usedMinutes).toBe(300);
    for (let i = 1; i < t.steps.length; i++) {
      expect(t.steps[i]?.start.getTime()).toBe(t.steps[i - 1]?.end.getTime());
    }
    const edited = buildTimeline(
      plan({ timelineOverrides: { bulk: 240 } }),
      REF_PRESETS,
      DEFAULT_BULK_TABLE,
    );
    expect(edited.bulk.usedMinutes).toBe(240);
    const shift = 60 * 60_000;
    expect(edited.steps[2]!.start.getTime()).toBe(t.steps[2]!.start.getTime() - shift);
    for (const [i, lane] of edited.lanes.entries()) {
      expect(lane.steps[0]!.start.getTime()).toBe(t.lanes[i]!.steps[0]!.start.getTime() - shift);
    }
  });

  it("adds optional feed and autolyse steps first", () => {
    const t = buildTimeline(
      plan({ feedStarter: true, autolyse: true }),
      REF_PRESETS,
      DEFAULT_BULK_TABLE,
    );
    expect(t.steps.map((s) => s.id)).toEqual([
      "feed",
      "autolyse",
      "mix",
      "bulk",
      "divide",
      "bench",
    ]);
    expect(t.steps[0]?.minutes).toBe(360);
  });

  it("places four stretch-and-folds at 30 min intervals inside bulk", () => {
    const t = buildTimeline(plan(), REF_PRESETS, DEFAULT_BULK_TABLE);
    const bulk = t.steps.find((s) => s.id === "bulk")!;
    expect(t.folds).toHaveLength(4);
    expect(t.folds[0]!.getTime()).toBe(bulk.start.getTime() + 30 * 60_000);
    expect(t.folds[3]!.getTime()).toBe(bulk.start.getTime() + 120 * 60_000);
  });

  it("drops to one early fold with a stand mixer and changes the mix note", () => {
    const t = buildTimeline(plan({ standMixer: true }), REF_PRESETS, DEFAULT_BULK_TABLE);
    const bulk = t.steps.find((s) => s.id === "bulk")!;
    expect(t.foldCount).toBe(1);
    expect(t.defaultFoldCount).toBe(1);
    expect(t.folds).toHaveLength(1);
    expect(t.folds[0]!.getTime()).toBe(bulk.start.getTime() + 30 * 60_000);
    expect(t.steps[0]?.label).toBe("Mix (stand mixer)");
    expect(t.steps[0]?.minutes).toBe(10);
    expect(t.steps[1]?.start.getTime()).toBe(t.steps[0]?.end.getTime());
  });

  it("lets the fold count be overridden and keeps folds in the first 30 min slots", () => {
    const six = buildTimeline(plan({ foldCount: 6 }), REF_PRESETS, DEFAULT_BULK_TABLE);
    const bulk = six.steps.find((s) => s.id === "bulk")!;
    expect(six.folds.map((f) => (f.getTime() - bulk.start.getTime()) / 60_000)).toEqual([
      30, 60, 90, 120, 150, 180,
    ]);
    expect(six.defaultFoldCount).toBe(4);
    const mixerTwo = buildTimeline(
      plan({ standMixer: true, foldCount: 2 }),
      REF_PRESETS,
      DEFAULT_BULK_TABLE,
    );
    expect(mixerTwo.folds.map((f) => (f.getTime() - bulk.start.getTime()) / 60_000)).toEqual([
      30, 60,
    ]);
    const none = buildTimeline(plan({ foldCount: 0 }), REF_PRESETS, DEFAULT_BULK_TABLE);
    expect(none.folds).toEqual([]);
    expect(none.foldCount).toBe(0);
  });

  it("falls back to the method default for invalid counts and caps large ones", () => {
    expect(foldCountFor({ foldCount: -1 })).toBe(4);
    expect(foldCountFor({ foldCount: 2.5, standMixer: true })).toBe(1);
    expect(foldCountFor({ foldCount: Number.NaN })).toBe(4);
    expect(foldCountFor({ foldCount: 99 })).toBe(12);
  });

  it("never schedules a fold after bulk ends", () => {
    const t = buildTimeline(
      plan({ foldCount: 8, timelineOverrides: { bulk: 100 } }),
      REF_PRESETS,
      DEFAULT_BULK_TABLE,
    );
    expect(t.folds).toHaveLength(3);
  });

  it("gives every selected preset one lane with a bake window", () => {
    const t = buildTimeline(plan(), REF_PRESETS, DEFAULT_BULK_TABLE);
    expect(t.lanes.map((l) => l.presetId)).toEqual(["roll", "loaf", "pizza"]);
    const pizza = t.lanes[2]!;
    expect(pizza.proof).toBe("cold");
    const shapeEnd = pizza.steps[0]!.end.getTime();
    expect(pizza.bakeWindow.earliest.getTime()).toBe(shapeEnd + 1440 * 60_000);
    expect(pizza.bakeWindow.latest.getTime()).toBe(shapeEnd + 4320 * 60_000);
    expect(pizza.steps.map((s) => s.id)).toEqual(["shape:pizza", "proof:pizza", "bake:pizza"]);
  });

  it("warns on overlapping bakes and suggests shortest first", () => {
    // Give the loaf the same proof as the rolls so their bakes collide.
    const presets = REF_PRESETS.map((p) =>
      p.id === "loaf" ? { ...p, proofMinutes: [60, 90] as [number, number] } : p,
    );
    const t = buildTimeline(
      plan({
        items: [
          { presetId: "roll", count: 4 },
          { presetId: "loaf", count: 1 },
        ],
      }),
      presets,
      DEFAULT_BULK_TABLE,
    );
    expect(t.ovenWarnings).toHaveLength(1);
    expect(t.ovenWarnings[0]).toMatch(/Suggested order: Roll .*, then Loaf/);
    const clean = buildTimeline(plan(), REF_PRESETS, DEFAULT_BULK_TABLE);
    expect(clean.ovenWarnings).toEqual([]);
  });
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

/** The seeded dough library, unedited. */
const DOUGHS = cloneDoughs();

/** Test-only (§4 B2): soft-bun plus sugar 6 %. Not seeded: no default dough has sugar (decision 23). */
const SWEET_BUN: Dough = {
  ...DOUGHS.find((d) => d.id === "soft-bun")!,
  id: "sweet-bun",
  name: "Sweet bun",
  sweetness: { kind: "sugar", pct: 0.06 },
};

// Red pins: the multi-dough timeline of PLAN-doughs.md §5, written before it exists. Each case
// is expected to fail until WP-D implements §5; WP-D turns them into plain tests and extends them.
describe("red pins: §5 multi-dough timeline (fail until WP-D)", () => {
  const refTimeline = (over: Partial<Plan>, doughs: Dough[] = DOUGHS) =>
    buildTimeline(plan({ settings: REF, ...over }), REF_PRESETS, DEFAULT_BULK_TABLE, doughs);

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
  it.fails("F: a split dough leaves the base bulk at fold 1 and divides with it", () => {
    const items = [
      { presetId: "loaf", count: 1 },
      { presetId: "loaf", count: 1, weightOverride: 600, doughId: "jalapeno-cheddar" },
    ];
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
  });

  /*
   * (G) Worked timeline B (start 09:00, 24 °C, hand mixed, REF settings, items mode):
   * loaf ×2 lean and roll ×8 at 120 g on soft-bun.
   *   mix 09:00–09:10; mix@soft-bun 09:10–09:30 (20 min: enriched); bulk@soft-bun 09:30–14:30
   *     (300 min, factor 1) with folds 10:00 10:30 11:00 11:30 (+30/+60/+90/+120 from its own
   *     bulk start); divide@soft-bun 14:30; bench@soft-bun 14:45–15:10
   *   lane roll@soft-bun shapes at 15:10 and bakes at 190 °C without steam (the dough's bake)
   *   on sweet-bun (B2, factor 1.15) its bulk runs 345 min, 09:30–15:15
   * Worked timeline B3 (loaf ×1 at 800 g on soft-sandwich with tangzhong 5 % at 1:5):
   *   no feed, no autolyse: tangzhong@soft-sandwich 09:00–09:45 is steps[0]; mix 09:45–09:55;
   *     mix@soft-sandwich 09:55–10:15; bulk@soft-sandwich 10:15–15:15 (300 min)
   *   the tangzhong note: "… cook 22 g flour with 108 g water …"; the mix@soft-sandwich note
   *     opens "Cooled tangzhong in with the milk and water,"
   *   feedStarter on: tangzhong@soft-sandwich 09:00–09:15, feed 09:15–15:15, mix 15:15–15:25
   */
  it.fails(
    "G: a separate dough runs its own mix, bulk and divide; a tangzhong opens the day",
    () => {
      const bunItems = (doughId: string) => [
        { presetId: "loaf", count: 2 },
        { presetId: "roll", count: 8, weightOverride: 120, doughId },
      ];
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

      const sweet = refTimeline({ mode: "items", items: bunItems("sweet-bun") }, [
        ...DOUGHS,
        SWEET_BUN,
      ]);
      const sweetBulk = stepOf(sweet, "bulk@sweet-bun");
      expect([at(sweetBulk?.start), sweetBulk?.minutes, at(sweetBulk?.end)]).toEqual([
        30, 345, 375,
      ]);

      const tzDoughs = DOUGHS.map((d) =>
        d.id === "soft-sandwich" ? { ...d, tangzhong: { flourPct: 0.05, ratio: 5 } } : d,
      );
      const tzItems = [
        { presetId: "loaf", count: 1, weightOverride: 800, doughId: "soft-sandwich" },
      ];
      const b3 = refTimeline({ mode: "items", items: tzItems }, tzDoughs);
      const tz = b3.steps[0];
      expect(tz && run(tz)).toEqual(["tangzhong@soft-sandwich", 0, 45]);
      expect(tz?.note).toContain("22 g flour");
      expect(tz?.note).toContain("108 g water");
      expect(at(stepOf(b3, "mix")?.start)).toBe(at(tz?.end));
      const sandwichMix = stepOf(b3, "mix@soft-sandwich");
      expect(sandwichMix?.note).toMatch(/^Cooled tangzhong/);
      expect(at(sandwichMix?.start)).toBe(55);
      const sandwichBulk = stepOf(b3, "bulk@soft-sandwich");
      expect([at(sandwichBulk?.start), sandwichBulk?.minutes]).toEqual([75, 300]);

      const fed = refTimeline({ mode: "items", items: tzItems, feedStarter: true }, tzDoughs);
      expect(fed.steps.slice(0, 3).map(run)).toEqual([
        ["tangzhong@soft-sandwich", 0, 15],
        ["feed", 15, 360],
        ["mix", 375, 10],
      ]);
    },
  );
});

// Pin H, the tripwire: the all-lean plan must not move a minute (§10). It passes today and has
// to keep passing through WP-D, whichever of `steps` and `tracks[0]` the base steps live in.
describe("the all-lean plan does not move (pin H)", () => {
  const baseRun = (t: Timeline) => [...t.steps, ...(t.tracks[0]?.steps ?? [])].map(run);
  /** tracks[0].folds from WP-D on; before that the alias, which WP-G deletes, hence the cast. */
  const baseFolds = (t: Timeline): Date[] =>
    t.tracks[0]?.folds ?? (t as unknown as { folds: Date[] }).folds;

  it("H: keeps today's step ids, times, folds and lane keys", () => {
    const t = buildTimeline(plan(), REF_PRESETS, DEFAULT_BULK_TABLE, DOUGHS);
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
    const busy = buildTimeline(
      plan({
        feedStarter: true,
        autolyse: true,
        standMixer: true,
        timelineOverrides: { bulk: 240, "proof:loaf": 120 },
      }),
      REF_PRESETS,
      DEFAULT_BULK_TABLE,
      DOUGHS,
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
