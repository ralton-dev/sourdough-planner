import { describe, expect, it } from "vitest";
import { computePlan } from "../lib/calc";
import { DEFAULT_DOUGHS } from "../lib/doughs";
import { DEFAULT_PRESETS } from "../lib/presets";
import { newPlan } from "../lib/storage";
import { DEFAULT_BULK_TABLE, buildTimeline, type Timeline } from "../lib/timeline";
import type { Plan, Preset, Settings } from "../lib/types";
import { timelineRows, type TimelineRow } from "./timelineRows";

/*
 * The In order contract (PLAN-redesign §3), pinned by R1 against a stub and expected to fail
 * until R4 implements timelineRows and flips these three to plain `it`. Every figure below was
 * computed from computePlan and buildTimeline on these fixtures (a reference model of the §3
 * rules run over the lib at 27a2009), not typed by hand. They assert ids, order, merges, dough
 * tags, `fixed` and overlaps, never note or label text, which the lib may reword (fold labels are
 * timelineRows' own). Clock times are UTC: each fixture starts on the hour in UTC.
 */

/** The plan's REF settings (calc.test.ts): 24 °C, 25 % inoculation, no bench loss. */
const REF: Settings = {
  starterHydration: 1,
  inoculation: 0.25,
  hydration: 0.75,
  salt: 0.02,
  benchLoss: 0,
  doughTempC: 24,
};

/** The roll and the loaf of the frozen REF_PRESETS (calc.test.ts, timeline.test.ts; decision 15). */
const ROLL: Preset = {
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
};
const LOAF: Preset = {
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
};
const REF_PRESETS: Preset[] = [ROLL, LOAF];

/** Items mode, hand mixed, REF settings, the seeded dough library. */
const itemsPlan = (startTime: string, over: Partial<Plan>): Plan => ({
  id: "pin",
  mode: "items",
  items: [],
  settings: { ...REF },
  startTime,
  timelineOverrides: {},
  feedStarter: false,
  autolyse: false,
  standMixer: false,
  ...over,
});

/** The timeline as App builds it, from computePlan's result for the same plan. */
const build = (plan: Plan, presets: Preset[]): Timeline =>
  buildTimeline(
    plan,
    presets,
    DEFAULT_BULK_TABLE,
    DEFAULT_DOUGHS,
    computePlan(plan, presets, DEFAULT_DOUGHS),
  );

const hm = (d: Date) => d.toISOString().slice(11, 16);
/** The list as the baker reads it: each row's id (merges included) and its start. */
const clock = (rows: TimelineRow[]) => rows.map((r) => [r.id, hm(r.start)]);
/** The dough an id is on: the part after "@", the main dough when there is none. */
const doughOf = (id: string) => id.split("@")[1] ?? "lean";
/** Decision 26: a row's tags are the doughs its ids name, in track order, with their colours. */
const tagsOf = (r: TimelineRow) => r.doughs.map((d) => [d.doughId, d.colour]);
const expectedTags = (r: TimelineRow, colours: Record<string, number>) =>
  r.id.split("+").map((id) => [doughOf(id), colours[doughOf(id)]]);

/** Rows come from the timeline: a step row carries its step's span and length (§3). */
function expectStepsFromTimeline(rows: TimelineRow[], t: Timeline, lanes = false) {
  const steps = [
    ...t.steps,
    ...t.tracks.flatMap((tr) => tr.steps),
    ...(lanes ? t.lanes.flatMap((l) => l.steps) : []),
  ];
  for (const r of rows.filter((x) => x.kind === "step")) {
    for (const id of r.id.split("+")) {
      const s = steps.find((x) => x.id === id);
      expect([id, r.start, r.end, r.minutes]).toEqual([id, s?.start, s?.end, s?.minutes]);
    }
  }
}

/** A fold row is a fold, labelled "Fold n" by the number in its id; every other row is a step. */
function expectKindsAndFoldLabels(rows: TimelineRow[]) {
  for (const r of rows) {
    const fold = /^fold:(\d+)@/.exec(r.id);
    expect([r.id, r.kind]).toEqual([r.id, fold ? "fold" : "step"]);
    if (fold) expect([r.id, r.label]).toEqual([r.id, `Fold ${fold[1]}`]);
  }
}

describe("timelineRows: the In order pins (§3, R1)", () => {
  /*
   * P1, Ben's case: loaf ×2 at 600 g on jalapeno-cheddar, tick box off; items mode, REF
   * settings, start 09:00, hand mixed, 24 °C. The split takes the whole main dough, so the main
   * dough's bulk only rests until it (fixed) and its fold 1 (09:40) falls inside the split.
   *   09:00–09:10  mix                       [main 0]
   *   09:10–09:50  bulk                      [main 0]  fixed
   *   09:40–09:50  split@jalapeno-cheddar    [jalapeño 1]  "Work in the add-ins"
   *   09:50–14:10  bulk@jalapeno-cheddar     [jalapeño 1]
   *   10:10        fold:2@jalapeno-cheddar   [jalapeño 1]  numbered from the main bulk's start
   *   10:40        fold:3@jalapeno-cheddar   [jalapeño 1]
   *   11:10        fold:4@jalapeno-cheddar   [jalapeño 1]
   *   14:10–14:25  divide@jalapeno-cheddar   [jalapeño 1]
   *   14:25–14:50  bench@jalapeno-cheddar    [jalapeño 1]
   * With lanes: shape:loaf@jalapeno-cheddar 14:50–15:00, proof:… 15:00–16:30, bake:… 16:30–17:15,
   * on the jalapeño dough. multi; no row has overlaps (the main bulk spans the split, but a bulk
   * is not hands-on).
   */
  it.fails(
    "P1: Ben's case reads as one list, the jalapeño rows tagged, the main bulk fixed",
    () => {
      const t = build(
        itemsPlan("2026-10-17T09:00:00.000Z", {
          items: [{ presetId: "loaf", count: 2, doughId: "jalapeno-cheddar" }],
          weightsIncludeAdditions: false,
        }),
        REF_PRESETS,
      );
      const { multi, rows } = timelineRows(t);
      expect(clock(rows)).toEqual([
        ["mix", "09:00"],
        ["bulk", "09:10"],
        ["split@jalapeno-cheddar", "09:40"],
        ["bulk@jalapeno-cheddar", "09:50"],
        ["fold:2@jalapeno-cheddar", "10:10"],
        ["fold:3@jalapeno-cheddar", "10:40"],
        ["fold:4@jalapeno-cheddar", "11:10"],
        ["divide@jalapeno-cheddar", "14:10"],
        ["bench@jalapeno-cheddar", "14:25"],
      ]);
      expect(multi).toBe(true);
      const colours = { lean: 0, "jalapeno-cheddar": 1 };
      for (const r of rows) expect([r.id, tagsOf(r)]).toEqual([r.id, expectedTags(r, colours)]);
      expect(rows.filter((r) => r.fixed).map((r) => r.id)).toEqual(["bulk"]);
      for (const r of rows) expect([r.id, r.overlaps]).toEqual([r.id, []]);
      expectKindsAndFoldLabels(rows);
      expectStepsFromTimeline(rows, t);

      const withLanes = timelineRows(t, { lanes: true }).rows;
      expect(clock(withLanes)).toEqual([
        ...clock(rows),
        ["shape:loaf@jalapeno-cheddar", "14:50"],
        ["proof:loaf@jalapeno-cheddar", "15:00"],
        ["bake:loaf@jalapeno-cheddar", "16:30"],
      ]);
      for (const r of withLanes)
        expect([r.id, tagsOf(r)]).toEqual([r.id, expectedTags(r, colours)]);
      for (const r of withLanes) expect([r.id, r.overlaps]).toEqual([r.id, []]);
      expectStepsFromTimeline(withLanes, t, true);
    },
  );

  /*
   * P2, the busy plan: loaf ×1 lean, loaf ×1 on jalapeno-cheddar, roll ×6 at 120 g on soft-bun,
   * loaf ×1 at 800 g on soft-sandwich; items mode, REF settings, start 06:00, feed and autolyse
   * on, hand mixed. Colours in library order among the doughs in use that are not the main dough:
   * soft-bun 1, soft-sandwich 2, jalapeño 3.
   *   06:00–12:00  feed            12:00–12:45  autolyse (their tags are R4's call)
   *   12:45–12:55  mix                       [main 0]
   *   12:55–17:55  bulk                      [main 0]
   *   12:55–13:15  mix@soft-bun              [1]  during the main bulk only: no overlaps
   *   13:15–18:15  bulk@soft-bun             [1]
   *   13:15–13:35  mix@soft-sandwich         [2]  overlaps split@jalapeno-cheddar
   *   13:25–13:35  split@jalapeno-cheddar    [3]  overlaps mix@soft-sandwich
   *   13:25        fold:1@lean               [0]  after the split: a fold sorts after a step
   *                                               starting the same minute
   *   13:35–18:35  bulk@soft-sandwich        [2]  before the jalapeño bulk: track order
   *   13:35–17:55  bulk@jalapeno-cheddar     [3]
   *   13:45        fold:1@soft-bun           [1]
   *   13:55        fold:2@lean+fold:2@jalapeno-cheddar   [0, 3]  one row, two doughs
   *   14:05        fold:1@soft-sandwich      [2]
   *   14:15        fold:2@soft-bun           [1]
   *   14:25        fold:3@lean+fold:3@jalapeno-cheddar   [0, 3]
   *   14:35        fold:2@soft-sandwich      [2]
   *   14:45        fold:3@soft-bun           [1]
   *   14:55        fold:4@lean+fold:4@jalapeno-cheddar   [0, 3]
   *   15:05        fold:3@soft-sandwich      [2]
   *   15:15        fold:4@soft-bun           [1]
   *   15:35        fold:4@soft-sandwich      [2]
   *   17:55–18:10  divide+divide@jalapeno-cheddar        [0, 3]  one row, two doughs
   *   18:10–18:35  bench+bench@jalapeno-cheddar          [0, 3]
   *   18:15–18:30  divide@soft-bun           [1]
   *   18:30–18:55  bench@soft-bun            [1]
   *   18:35–18:50  divide@soft-sandwich      [2]
   *   18:50–19:15  bench@soft-sandwich       [2]
   */
  it.fails(
    "P2: the busy plan interleaves four doughs, merges shared moments, marks the clash",
    () => {
      const t = build(
        itemsPlan("2026-10-17T06:00:00.000Z", {
          items: [
            { presetId: "loaf", count: 1 },
            { presetId: "loaf", count: 1, doughId: "jalapeno-cheddar" },
            { presetId: "roll", count: 6, weightOverride: 120, doughId: "soft-bun" },
            { presetId: "loaf", count: 1, weightOverride: 800, doughId: "soft-sandwich" },
          ],
          feedStarter: true,
          autolyse: true,
        }),
        REF_PRESETS,
      );
      const { multi, rows } = timelineRows(t);
      expect(clock(rows)).toEqual([
        ["feed", "06:00"],
        ["autolyse", "12:00"],
        ["mix", "12:45"],
        ["bulk", "12:55"],
        ["mix@soft-bun", "12:55"],
        ["bulk@soft-bun", "13:15"],
        ["mix@soft-sandwich", "13:15"],
        ["split@jalapeno-cheddar", "13:25"],
        ["fold:1@lean", "13:25"],
        ["bulk@soft-sandwich", "13:35"],
        ["bulk@jalapeno-cheddar", "13:35"],
        ["fold:1@soft-bun", "13:45"],
        ["fold:2@lean+fold:2@jalapeno-cheddar", "13:55"],
        ["fold:1@soft-sandwich", "14:05"],
        ["fold:2@soft-bun", "14:15"],
        ["fold:3@lean+fold:3@jalapeno-cheddar", "14:25"],
        ["fold:2@soft-sandwich", "14:35"],
        ["fold:3@soft-bun", "14:45"],
        ["fold:4@lean+fold:4@jalapeno-cheddar", "14:55"],
        ["fold:3@soft-sandwich", "15:05"],
        ["fold:4@soft-bun", "15:15"],
        ["fold:4@soft-sandwich", "15:35"],
        ["divide+divide@jalapeno-cheddar", "17:55"],
        ["bench+bench@jalapeno-cheddar", "18:10"],
        ["divide@soft-bun", "18:15"],
        ["bench@soft-bun", "18:30"],
        ["divide@soft-sandwich", "18:35"],
        ["bench@soft-sandwich", "18:50"],
      ]);
      expect(multi).toBe(true);
      const colours = { lean: 0, "soft-bun": 1, "soft-sandwich": 2, "jalapeno-cheddar": 3 };
      for (const r of rows.filter((x) => x.id !== "feed" && x.id !== "autolyse")) {
        expect([r.id, tagsOf(r)]).toEqual([r.id, expectedTags(r, colours)]);
      }
      const row = (id: string) => rows.find((r) => r.id === id);
      expect(row("fold:2@lean+fold:2@jalapeno-cheddar")?.doughs).toHaveLength(2);
      expect(row("divide+divide@jalapeno-cheddar")?.doughs).toHaveLength(2);
      expect(rows.filter((r) => r.fixed).map((r) => r.id)).toEqual([]);

      // Hands-on collisions only: the sandwich mix runs into the jalapeño split; a mix during
      // another dough's bulk is not one, and a bulk is never hands-on.
      expect(row("mix@soft-sandwich")?.overlaps).toContain("split@jalapeno-cheddar");
      expect(row("split@jalapeno-cheddar")?.overlaps).toContain("mix@soft-sandwich");
      expect(row("mix@soft-bun")?.overlaps).toEqual([]);
      for (const r of rows.filter((x) => x.id.startsWith("bulk"))) {
        expect([r.id, r.overlaps]).toEqual([r.id, []]);
      }
      for (const r of rows) {
        for (const id of r.overlaps) {
          expect([r.id, id, rows.some((o) => o.id === id)]).toEqual([r.id, id, true]);
          expect([r.id, id.startsWith("bulk")]).toEqual([r.id, false]);
        }
      }
      expectKindsAndFoldLabels(rows);
      expectStepsFromTimeline(rows, t);
    },
  );

  /*
   * P3, the default lean plan (newPlan: starter mode, 250 g, pizza ×2, roll ×4, loaf ×2, the
   * default presets and settings), start 09:00: one base track, so not multi. The same steps as
   * the lean card's list, its four folds rows of their own (the card keeps them beside the bulk).
   *   09:00–09:10 mix · 09:10–14:10 bulk · 09:40 fold:1@lean · 10:10 fold:2@lean ·
   *   10:40 fold:3@lean · 11:10 fold:4@lean · 14:10–14:25 divide · 14:25–14:50 bench
   * Every row on the main dough (colour 0), none with overlaps.
   */
  it.fails("P3: the default lean plan is one list on the main dough, not multi", () => {
    const t = build(newPlan({ id: "pin", startTime: "2026-10-17T09:00:00.000Z" }), DEFAULT_PRESETS);
    const { multi, rows } = timelineRows(t);
    expect(clock(rows)).toEqual([
      ["mix", "09:00"],
      ["bulk", "09:10"],
      ["fold:1@lean", "09:40"],
      ["fold:2@lean", "10:10"],
      ["fold:3@lean", "10:40"],
      ["fold:4@lean", "11:10"],
      ["divide", "14:10"],
      ["bench", "14:25"],
    ]);
    expect(multi).toBe(false);
    for (const r of rows) expect([r.id, tagsOf(r)]).toEqual([r.id, [["lean", 0]]]);
    expect(rows.filter((r) => r.fixed).map((r) => r.id)).toEqual([]);
    for (const r of rows) expect([r.id, r.overlaps]).toEqual([r.id, []]);
    expectKindsAndFoldLabels(rows);
    expectStepsFromTimeline(rows, t);
  });
});
