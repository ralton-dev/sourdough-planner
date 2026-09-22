import { describe, expect, it } from "vitest";
import { DEFAULT_PRESETS } from "./presets";
import { DEFAULT_BULK_TABLE, buildTimeline, bulkEstimate, foldCountFor } from "./timeline";
import { DEFAULT_SETTINGS, type Plan } from "./types";

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
    const t = buildTimeline(plan(), DEFAULT_PRESETS, DEFAULT_BULK_TABLE);
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
      DEFAULT_PRESETS,
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
      DEFAULT_PRESETS,
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
    const t = buildTimeline(plan(), DEFAULT_PRESETS, DEFAULT_BULK_TABLE);
    const bulk = t.steps.find((s) => s.id === "bulk")!;
    expect(t.folds).toHaveLength(4);
    expect(t.folds[0]!.getTime()).toBe(bulk.start.getTime() + 30 * 60_000);
    expect(t.folds[3]!.getTime()).toBe(bulk.start.getTime() + 120 * 60_000);
  });

  it("drops to one early fold with a stand mixer and changes the mix note", () => {
    const t = buildTimeline(plan({ standMixer: true }), DEFAULT_PRESETS, DEFAULT_BULK_TABLE);
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
    const six = buildTimeline(plan({ foldCount: 6 }), DEFAULT_PRESETS, DEFAULT_BULK_TABLE);
    const bulk = six.steps.find((s) => s.id === "bulk")!;
    expect(six.folds.map((f) => (f.getTime() - bulk.start.getTime()) / 60_000)).toEqual([
      30, 60, 90, 120, 150, 180,
    ]);
    expect(six.defaultFoldCount).toBe(4);
    const mixerTwo = buildTimeline(
      plan({ standMixer: true, foldCount: 2 }),
      DEFAULT_PRESETS,
      DEFAULT_BULK_TABLE,
    );
    expect(mixerTwo.folds.map((f) => (f.getTime() - bulk.start.getTime()) / 60_000)).toEqual([
      30, 60,
    ]);
    const none = buildTimeline(plan({ foldCount: 0 }), DEFAULT_PRESETS, DEFAULT_BULK_TABLE);
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
      DEFAULT_PRESETS,
      DEFAULT_BULK_TABLE,
    );
    expect(t.folds).toHaveLength(3);
  });

  it("gives every selected preset one lane with a bake window", () => {
    const t = buildTimeline(plan(), DEFAULT_PRESETS, DEFAULT_BULK_TABLE);
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
    const presets = DEFAULT_PRESETS.map((p) =>
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
    const clean = buildTimeline(plan(), DEFAULT_PRESETS, DEFAULT_BULK_TABLE);
    expect(clean.ovenWarnings).toEqual([]);
  });
});
