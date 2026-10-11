import { describe, expect, it } from "vitest";
import { computePlan } from "../lib/calc";
import { DEFAULT_DOUGHS } from "../lib/doughs";
import { DEFAULT_PRESETS } from "../lib/presets";
import { newPlan } from "../lib/storage";
import { DEFAULT_BULK_TABLE, buildTimeline, type Timeline } from "../lib/timeline";
import type { Dough, Plan, Preset, Settings } from "../lib/types";
import { doughColours, timelineRows, type TimelineRow } from "./timelineRows";

/*
 * The In order contract (PLAN-redesign §3), pinned by R1 against a stub, where they failed on
 * content, and flipped to plain `it` by R4 with timelineRows in place. Every figure below was
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
const build = (plan: Plan, presets: Preset[], doughs: Dough[] = DEFAULT_DOUGHS): Timeline =>
  buildTimeline(plan, presets, DEFAULT_BULK_TABLE, doughs, computePlan(plan, presets, doughs));

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
  it("P1: Ben's case reads as one list, the jalapeño rows tagged, the main bulk fixed", () => {
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
    for (const r of withLanes) expect([r.id, tagsOf(r)]).toEqual([r.id, expectedTags(r, colours)]);
    for (const r of withLanes) expect([r.id, r.overlaps]).toEqual([r.id, []]);
    expectStepsFromTimeline(withLanes, t, true);
  });

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
  it("P2: the busy plan interleaves four doughs, merges shared moments, marks the clash", () => {
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
  });

  /*
   * P3, the default lean plan (newPlan: starter mode, 250 g, pizza ×2, roll ×4, loaf ×2, the
   * default presets and settings), start 09:00: one base track, so not multi. The same steps as
   * the lean card's list, its four folds rows of their own (the card keeps them beside the bulk).
   *   09:00–09:10 mix · 09:10–14:10 bulk · 09:40 fold:1@lean · 10:10 fold:2@lean ·
   *   10:40 fold:3@lean · 11:10 fold:4@lean · 14:10–14:25 divide · 14:25–14:50 bench
   * Every row on the main dough (colour 0), none with overlaps.
   */
  it("P3: the default lean plan is one list on the main dough, not multi", () => {
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

/** The library with one dough edited (timeline.test.ts's helper). */
const editDough = (id: string, patch: Partial<Dough>): Dough[] =>
  DEFAULT_DOUGHS.map((d) => (d.id === id ? { ...d, ...patch } : d));
const stepOf = (t: Timeline, id: string) =>
  [...t.steps, ...t.tracks.flatMap((tr) => tr.steps), ...t.lanes.flatMap((l) => l.steps)].find(
    (s) => s.id === id,
  );
const rowOf = (rows: TimelineRow[], id: string) => rows.find((r) => r.id === id);
const indexOf = (rows: TimelineRow[], id: string) => rows.findIndex((r) => r.id === id);
/** Example A's shape in items mode: a lean loaf and a 600 g loaf on jalapeno-cheddar. */
const LEAN_AND_JALAPENO = [
  { presetId: "loaf", count: 1 },
  { presetId: "loaf", count: 1, weightOverride: 600, doughId: "jalapeno-cheddar" },
];

/*
 * Beyond the pins (R4): the plans the pins do not cover. Times and notes are read off the
 * timeline buildTimeline returns for the same plan, so a lib change that moves a step moves the
 * expectation with it; what is asserted is the In order rules (order, merges, tags, overlaps).
 */
describe("timelineRows: the In order rules on other plans (§3, R4)", () => {
  it("gives a stand mixer plan one fold row per dough, numbered 1", () => {
    const t = build(
      itemsPlan("2026-10-17T09:00:00.000Z", {
        items: [
          { presetId: "loaf", count: 2 },
          { presetId: "roll", count: 8, weightOverride: 120, doughId: "soft-bun" },
        ],
        standMixer: true,
      }),
      REF_PRESETS,
    );
    expect(t.foldCount).toBe(1);
    const { multi, rows } = timelineRows(t);
    expect(multi).toBe(true);
    const folds = rows.filter((r) => r.kind === "fold");
    const expected = t.tracks
      .map((tr) => [`fold:1@${tr.doughId}`, tr.folds[0]] as const)
      .sort((a, b) => a[1]!.getTime() - b[1]!.getTime());
    expect(folds.map((r) => [r.id, r.start])).toEqual(expected);
    expect(folds.map((r) => r.label)).toEqual(["Fold 1", "Fold 1"]);
    for (const r of rows) expect([r.id, r.overlaps]).toEqual([r.id, []]);
    expectKindsAndFoldLabels(rows);
    expectStepsFromTimeline(rows, t);
  });

  it("reads B3, a plan with no main mix, as its one dough from the tangzhong on", () => {
    // Example B3: soft-sandwich with its tangzhong (5 % at 1:5), one 800 g loaf, nothing lean.
    const t = build(
      itemsPlan("2026-10-17T09:00:00.000Z", {
        items: [{ presetId: "loaf", count: 1, weightOverride: 800, doughId: "soft-sandwich" }],
      }),
      REF_PRESETS,
      editDough("soft-sandwich", { tangzhong: { flourPct: 0.05, ratio: 5 } }),
    );
    const { multi, rows } = timelineRows(t);
    // No base track, so the card offers both views (decision 24).
    expect(multi).toBe(true);
    expect(rows.map((r) => r.id)).toEqual([
      "tangzhong@soft-sandwich",
      "mix@soft-sandwich",
      "bulk@soft-sandwich",
      "fold:1@soft-sandwich",
      "fold:2@soft-sandwich",
      "fold:3@soft-sandwich",
      "fold:4@soft-sandwich",
      "divide@soft-sandwich",
      "bench@soft-sandwich",
    ]);
    // The tangzhong is the sandwich dough's, so it carries its tag: colour 1, the first dough
    // that is not the main dough.
    for (const r of rows) expect([r.id, tagsOf(r)]).toEqual([r.id, [["soft-sandwich", 1]]]);
    const track = t.tracks[0]!;
    expect(rows.filter((r) => r.kind === "fold").map((r) => r.start)).toEqual(track.folds);
    // The cook and the mix follow one another: hands-on, but never at once.
    for (const r of rows) expect([r.id, r.overlaps]).toEqual([r.id, []]);
    expectKindsAndFoldLabels(rows);
    expectStepsFromTimeline(rows, t);
  });

  it("divides a slower split (bulkFactor 1.2) after the main dough, folds still shared", () => {
    const t = build(
      itemsPlan("2026-10-17T09:00:00.000Z", { items: LEAN_AND_JALAPENO }),
      REF_PRESETS,
      editDough("jalapeno-cheddar", { bulkFactor: 1.2 }),
    );
    const { rows } = timelineRows(t);
    const jalBulk = stepOf(t, "bulk@jalapeno-cheddar")!;
    expect(jalBulk.end.getTime()).toBeGreaterThan(stepOf(t, "bulk")!.end.getTime());
    // Its divide waits for its own bulk, so the two divides and bench rests do not merge.
    expect(rowOf(rows, "divide@jalapeno-cheddar")?.start).toEqual(jalBulk.end);
    expect(indexOf(rows, "divide")).toBeLessThan(indexOf(rows, "divide@jalapeno-cheddar"));
    expect(indexOf(rows, "bench")).toBeLessThan(indexOf(rows, "divide@jalapeno-cheddar"));
    expect(rows.filter((r) => r.id.includes("+") && r.kind === "step")).toEqual([]);
    // While the main dough divides, the split's bulk is still running: its rail, not the main's.
    expect(rowOf(rows, "divide")?.rails).toEqual(["jalapeno-cheddar"]);
    // The folds are the batch's: numbered from the main bulk's start and done together.
    expect(rows.filter((r) => r.kind === "fold").map((r) => r.id)).toEqual([
      "fold:1@lean",
      "fold:2@lean+fold:2@jalapeno-cheddar",
      "fold:3@lean+fold:3@jalapeno-cheddar",
      "fold:4@lean+fold:4@jalapeno-cheddar",
    ]);
    expectKindsAndFoldLabels(rows);
    expectStepsFromTimeline(rows, t);
  });

  it("merges three doughs onto one row, and keeps each split's own note", () => {
    // A lean loaf and two split loaves, both split off at fold 1: everything after the mix is
    // done to the three together, the two splits at once.
    const t = build(
      itemsPlan("2026-10-17T09:00:00.000Z", {
        items: [
          { presetId: "loaf", count: 1 },
          { presetId: "loaf", count: 1, doughId: "jalapeno-cheddar" },
          { presetId: "loaf", count: 1, doughId: "seeded" },
        ],
      }),
      REF_PRESETS,
    );
    const { rows } = timelineRows(t);
    const three = rows.filter((r) => r.doughs.length === 3);
    expect(three.map((r) => r.id)).toEqual([
      "fold:2@lean+fold:2@jalapeno-cheddar+fold:2@seeded",
      "fold:3@lean+fold:3@jalapeno-cheddar+fold:3@seeded",
      "fold:4@lean+fold:4@jalapeno-cheddar+fold:4@seeded",
      "divide+divide@jalapeno-cheddar+divide@seeded",
      "bench+bench@jalapeno-cheddar+bench@seeded",
    ]);
    const colours = { lean: 0, "jalapeno-cheddar": 1, seeded: 2 };
    for (const r of rows) expect([r.id, tagsOf(r)]).toEqual([r.id, expectedTags(r, colours)]);
    const divide = rowOf(rows, "divide+divide@jalapeno-cheddar+divide@seeded")!;
    expect([divide.minutes, divide.defaultMinutes]).toEqual([15, 15]);
    expect(divide.note).toBe(stepOf(t, "divide")?.note);

    // The two splits are one row, one job; each note is kept, led by the dough it is for.
    const split = rowOf(rows, "split@jalapeno-cheddar+split@seeded")!;
    expect(split.overlaps).toEqual([]);
    expect(split.note?.split("\n")).toEqual([
      `Jalapeño cheddar: ${stepOf(t, "split@jalapeno-cheddar")?.note}`,
      `Seeded: ${stepOf(t, "split@seeded")?.note}`,
    ]);
    expectKindsAndFoldLabels(rows);
    expectStepsFromTimeline(rows, t);
  });

  it("merges two lanes shaping at the same minute into one Shape row with two tags", () => {
    const t = build(
      itemsPlan("2026-10-17T09:00:00.000Z", { items: LEAN_AND_JALAPENO }),
      REF_PRESETS,
    );
    expect(timelineRows(t).rows.filter((r) => r.label === "Shape")).toEqual([]);
    const { rows } = timelineRows(t, { lanes: true });
    const shapes = rows.filter((r) => r.label === "Shape");
    expect(shapes.map((r) => r.id)).toEqual(["shape:loaf+shape:loaf@jalapeno-cheddar"]);
    const [shape] = shapes;
    // Tagged by item (lane.label) on its dough's colour, so the two loaves read apart.
    expect(shape!.doughs.map((d) => [d.doughId, d.name, d.colour])).toEqual(
      t.lanes.map((l) => [l.doughId, l.label, l.doughId === "lean" ? 0 : 1]),
    );
    expect(shape!.doughs.map((d) => d.name)).toEqual(["Loaf", "Loaf (Jalapeño cheddar)"]);
    // The same preset says the same thing about shaping: one note, as written.
    expect(shape!.note).toBe(stepOf(t, "shape:loaf")?.note);
    expect(shape!.start).toEqual(stepOf(t, "shape:loaf@jalapeno-cheddar")?.start);
    expectStepsFromTimeline(rows, t, true);
  });

  it("parts a merged row when one dough's length is edited, and shows the clash", () => {
    const plan = itemsPlan("2026-10-17T09:00:00.000Z", { items: LEAN_AND_JALAPENO });
    const together = timelineRows(build(plan, REF_PRESETS)).rows;
    expect(rowOf(together, "divide+divide@jalapeno-cheddar")).toBeDefined();
    // An override on one divide (the By dough view's edit) moves that dough only.
    const t = build({ ...plan, timelineOverrides: { "divide@jalapeno-cheddar": 20 } }, REF_PRESETS);
    const { rows } = timelineRows(t);
    const lean = rowOf(rows, "divide")!;
    const jal = rowOf(rows, "divide@jalapeno-cheddar")!;
    expect([lean.minutes, jal.minutes, jal.defaultMinutes]).toEqual([15, 20, 15]);
    expect([lean.overlaps, jal.overlaps]).toEqual([["divide@jalapeno-cheddar"], ["divide"]]);
    // The same length on both merges them again, at the edited length.
    const both = timelineRows(
      build(
        { ...plan, timelineOverrides: { divide: 20, "divide@jalapeno-cheddar": 20 } },
        REF_PRESETS,
      ),
    ).rows;
    const merged = rowOf(both, "divide+divide@jalapeno-cheddar")!;
    expect([merged.minutes, merged.defaultMinutes, merged.overlaps]).toEqual([20, 15, []]);
  });

  it("shows the busy plan's kitchen clash: the sandwich divide while the loaves are shaped", () => {
    // P2's plan with the lanes in, as kitchen mode reads it (§4: "one collision stays unseen").
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
    const { rows } = timelineRows(t, { lanes: true });
    const shape = rowOf(rows, "shape:loaf+shape:loaf@jalapeno-cheddar")!;
    expect(shape.start).toEqual(stepOf(t, "divide@soft-sandwich")?.start);
    expect(shape.overlaps).toEqual(["divide@soft-sandwich"]);
    expect(rowOf(rows, "divide@soft-sandwich")?.overlaps).toEqual([shape.id]);
    // Proofs and bakes are not hands-on: they neither carry nor cause an overlap.
    for (const r of rows.filter((x) => /^(proof|bake|bench|feed|autolyse|bulk)/.test(x.id))) {
      expect([r.id, r.overlaps]).toEqual([r.id, []]);
    }
    for (const r of rows)
      for (const id of r.overlaps) expect(rowOf(rows, id)?.overlaps).toContain(r.id);
    expectStepsFromTimeline(rows, t, true);
  });

  it("colours doughs by their place among the doughs in use, wrapping after five", () => {
    // Six doughs besides the main one: the library's five and a sixth separate dough after them.
    const extra: Dough = { ...DEFAULT_DOUGHS[0]!, id: "rye-bun", name: "Rye bun" };
    const doughs = [...DEFAULT_DOUGHS, extra];
    const plan = itemsPlan("2026-10-17T09:00:00.000Z", {
      items: doughs.map((d) => ({ presetId: "loaf", count: 1, doughId: d.id })),
    });
    const t = build(plan, REF_PRESETS, doughs);
    // Decision 26 counts computePlan's doughs that are not the main dough, in their order.
    const inUse = computePlan(plan, REF_PRESETS, doughs)
      .doughs.filter((d) => d.method !== "base")
      .map((d) => d.doughId);
    expect(inUse).toHaveLength(6);
    const colours = doughColours(t);
    expect(inUse.map((id) => colours.get(id))).toEqual([1, 2, 3, 4, 5, 1]);
    expect(colours.get("lean")).toBe(0);
    for (const r of timelineRows(t).rows) {
      for (const d of r.doughs) {
        expect([r.id, d.doughId, d.colour]).toEqual([r.id, d.doughId, colours.get(d.doughId)]);
      }
    }
  });
});
