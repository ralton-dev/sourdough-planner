import {
  ENRICHMENTS,
  INCLUSIONS,
  SWEETENERS,
  bulkFactorFor,
  compositionFactor,
  doughHydration,
  doughOnlyFactor,
  doughSalt,
  effectiveMethod,
  enrichmentAddAt,
  enrichmentWater,
  findDough,
  inclusionAddAt,
  leanDough,
  lineKey,
  resolveDoughId,
  splitAtFor,
  usablePerFlour,
} from "./doughs";
import type {
  Dough,
  EffectiveMethod,
  EnrichmentKind,
  Inclusion,
  InclusionAddAt,
  Plan,
  Preset,
  ProofType,
  Settings,
  SplitAt,
  SweetKind,
} from "./types";

export interface BulkRow {
  tempC: number;
  minMinutes: number;
  maxMinutes: number;
}

/** Guide values at 20–25 % inoculation. User-editable; a heuristic, not a clock. */
export const DEFAULT_BULK_TABLE: BulkRow[] = [
  { tempC: 20, minMinutes: 420, maxMinutes: 480 },
  { tempC: 22, minMinutes: 330, maxMinutes: 390 },
  { tempC: 24, minMinutes: 270, maxMinutes: 330 },
  { tempC: 26, minMinutes: 210, maxMinutes: 270 },
];

export interface BulkEstimate {
  minMinutes: number;
  maxMinutes: number;
  /** Multiplier applied for inoculation outside 20–25 %. 1 inside the band. */
  factor: number;
}

/**
 * Linear interpolation on temperature, clamped to the table's ends, then scaled
 * ~2 % per percentage point of inoculation outside 20–25 % (≈15 % longer at 15 %).
 */
export function bulkEstimate(tempC: number, inoculation: number, table: BulkRow[]): BulkEstimate {
  const rows = [...table].filter((r) => Number.isFinite(r.tempC)).sort((a, b) => a.tempC - b.tempC);
  if (rows.length === 0) return { minMinutes: 0, maxMinutes: 0, factor: 1 };
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  let min: number;
  let max: number;
  if (tempC <= first.tempC) {
    min = first.minMinutes;
    max = first.maxMinutes;
  } else if (tempC >= last.tempC) {
    min = last.minMinutes;
    max = last.maxMinutes;
  } else {
    let lo = first;
    let hi = last;
    for (let i = 0; i < rows.length - 1; i++) {
      if (tempC >= rows[i]!.tempC && tempC <= rows[i + 1]!.tempC) {
        lo = rows[i]!;
        hi = rows[i + 1]!;
        break;
      }
    }
    const t = hi.tempC === lo.tempC ? 0 : (tempC - lo.tempC) / (hi.tempC - lo.tempC);
    min = lo.minMinutes + t * (hi.minMinutes - lo.minMinutes);
    max = lo.maxMinutes + t * (hi.maxMinutes - lo.maxMinutes);
  }
  let factor = 1;
  if (inoculation < 0.2) factor = 1 + (0.2 - inoculation) * 100 * 0.02;
  else if (inoculation > 0.25) factor = 1 - (inoculation - 0.25) * 100 * 0.02;
  factor = Math.min(2, Math.max(0.5, factor));
  return { minMinutes: min * factor, maxMinutes: max * factor, factor };
}

export interface TimelineStep {
  id: string;
  label: string;
  start: Date;
  end: Date;
  minutes: number;
  defaultMinutes: number;
  note?: string;
}

export interface Lane {
  /** `presetId` for lean, `presetId@doughId` otherwise (decision 2); lane step ids use it. */
  key: string;
  presetId: string;
  /** The preset's name. `laneLabel` adds the dough wherever the lane is named on its own. */
  name: string;
  icon?: string;
  /**
   * The dough the lane is timed on: lean or a library dough. A line on an id the library no
   * longer has is timed as lean, so it reads lean here; its key keeps the id (decision 2).
   */
  doughId: string;
  /** The dough's name; "Lean (dough <id> not found)" for an id the library no longer has. */
  doughName: string;
  proof: ProofType;
  steps: TimelineStep[];
  /** Earliest and latest sensible bake start given the preset's proof range. */
  bakeWindow: { earliest: Date; latest: Date };
  /** The dough's bake override when it has one (decision 12), else the preset's. */
  bakeTempC: number;
  steam: boolean;
}

/** One dough's run from its mix or split to the end of its bench rest (§5). */
export interface DoughTrack {
  doughId: string;
  name: string;
  icon?: string;
  method: EffectiveMethod;
  /** base: bulk, divide, bench. separate: mix@, bulk@, divide@, bench@. split: split@, bulk@, divide@, bench@. */
  steps: TimelineStep[];
  /** Base and separate: their own sets from their own bulk start. Split: the base folds after it. */
  folds: Date[];
  /**
   * This track's bulk: the guide range with the inoculation factor (`factor`) and the dough factor
   * applied (for a split, what is left of it once the split is done) and the minutes in use.
   */
  bulk: BulkEstimate & { usedMinutes: number; doughFactor: number };
  benchEnd: Date;
}

export interface Timeline {
  /** The common prefix: tangzhong@<id>…, feed?, autolyse?, mix. */
  steps: TimelineStep[];
  /** Base first, then the separate and split doughs in use, in library order. */
  tracks: DoughTrack[];
  /** Sets asked for (default or override) and the default for the mixing method. */
  foldCount: number;
  defaultFoldCount: number;
  lanes: Lane[];
  ovenWarnings: string[];
  end: Date;
  /** @deprecated alias of tracks[0].folds; WP-G deletes it with the UI that reads it. */
  folds: Date[];
  /** @deprecated alias of tracks[0].bulk; WP-G deletes it with the UI that reads it. */
  bulk: BulkEstimate & { usedMinutes: number };
}

/**
 * Hand-mixed dough relies on folds for strength: four sets, 30 min apart, is the
 * common recipe default. A stand mixer develops the gluten up front, so one early
 * set is plenty and many bakers skip folds entirely. Either way the folds stay in
 * the first 30-minute slots of bulk, since handling belongs early, not late.
 */
export const HAND_FOLD_COUNT = 4;
export const MIXER_FOLD_COUNT = 1;
export const MAX_FOLD_COUNT = 12;
export const FOLD_INTERVAL_MIN = 30;

export function defaultFoldCount(plan: Pick<Plan, "standMixer">): number {
  return plan.standMixer ? MIXER_FOLD_COUNT : HAND_FOLD_COUNT;
}

/** The fold count in force: a valid override, else the method default. */
export function foldCountFor(plan: Pick<Plan, "standMixer" | "foldCount">): number {
  const v = plan.foldCount;
  if (v !== undefined && Number.isInteger(v) && v >= 0) return Math.min(v, MAX_FOLD_COUNT);
  return defaultFoldCount(plan);
}

/** Decision 11: minutes into bulk of each add-at point, whatever the fold count, 0 included. */
const INTO_BULK_MIN: Record<SplitAt, number> = {
  mix: 0,
  fold1: FOLD_INTERVAL_MIN,
  fold2: 2 * FOLD_INTERVAL_MIN,
};

const HAND_MIX_NOTE = "Add starter and salt. Reserve ~20 g water for the salt.";
const MIXER_MIX_NOTE =
  "Dough hook, low speed 2–3 min to combine, then speed 2 for 4–6 min until smooth and elastic. Reserve ~20 g water for the salt. Watch the dough temperature; the mixer warms it.";
const BULK_NOTE = "Target a 50–75 % rise, domed and jiggly. The clock is a guide.";
const DIVIDE_NOTE = "Weigh each piece from the division card.";

const EPS = 1e-9;
const LEAN = leanDough();
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const later = (a: Date, b: Date) => (b.getTime() > a.getTime() ? b : a);

type Durations = (id: string, def: number) => number;

interface Ctx {
  plan: Plan;
  est: BulkEstimate;
  foldCount: number;
  dur: Durations;
}

/**
 * §5 — the whole schedule from the start time: the common prefix, one track per dough in use
 * (base first, then the library's doughs in library order) and one lane per (preset, dough) line.
 * Pure; overrides cascade naturally. `doughs` is the dough library.
 */
export function buildTimeline(
  plan: Plan,
  presets: Preset[],
  table: BulkRow[],
  doughs: Dough[] = [],
): Timeline {
  const ov = plan.timelineOverrides ?? {};
  const dur: Durations = (id, def) => {
    const v = ov[id];
    return v !== undefined && Number.isFinite(v) && v >= 0 ? v : def;
  };
  const est = bulkEstimate(plan.settings.doughTempC, plan.settings.inoculation, table);
  const foldCount = foldCountFor(plan);
  const ctx: Ctx = { plan, est, foldCount, dur };

  const lines = resolveLines(plan, presets, doughs);
  const batchFlour = allocateWeights(plan, lines);
  const used = new Set(lines.map((l) => l.dough));
  const needs = doughs.filter((d) => used.has(d)).map((d) => ({ d, flour: flourOn(d, lines) }));
  // §4 gives unallocated flour to lean. Should the library doughs alone need more than the batch
  // holds, lean has none and they shrink in proportion, as computePlan shares the flour, so a
  // split never asks for more dough than the mix made.
  const asked = needs.reduce((sum, x) => sum + x.flour, 0);
  const scale =
    batchFlour !== undefined && asked > batchFlour ? Math.max(0, batchFlour) / asked : 1;
  const inUse = needs.map(({ d, flour }) => ({
    dough: d,
    grams: doughGrams(d, flour * scale, plan.settings),
  }));

  let start = new Date(plan.startTime);
  if (Number.isNaN(start.getTime())) start = new Date();

  // The common prefix (decision 20): every tangzhong first, cooling while whatever follows
  // runs, then feed, autolyse and the main mix exactly as before.
  const prefix = chain(start, dur);
  const cooling = plan.feedStarter || plan.autolyse;
  for (const { dough, grams } of inUse) {
    if (!grams.tangzhong) continue;
    prefix.push(
      `tangzhong@${dough.id}`,
      "Cook tangzhong",
      cooling ? 15 : 45,
      tangzhongNote(dough, grams.tangzhong),
    );
  }
  if (plan.feedStarter) prefix.push("feed", "Feed starter", 360, "4–8 h until it peaks, then mix.");
  if (plan.autolyse) prefix.push("autolyse", "Autolyse", 45, "Flour plus most of the water. Rest.");
  if (plan.standMixer) prefix.push("mix", "Mix (stand mixer)", 10, MIXER_MIX_NOTE);
  else prefix.push("mix", "Mix", 10, HAND_MIX_NOTE);

  // The base dough keeps today's ids and defaults (§10).
  const baseRun = chain(prefix.end(), dur);
  const bulk = baseRun.push("bulk", "Bulk ferment", midpoint(est), BULK_NOTE);
  baseRun.push("divide", "Divide & pre-shape", 15, DIVIDE_NOTE);
  const bench = baseRun.push("bench", "Bench rest", 25);
  const base: DoughTrack = {
    doughId: LEAN.id,
    name: LEAN.name,
    method: "base",
    steps: baseRun.steps,
    folds: foldsDuring(bulk, foldCount),
    bulk: { ...est, usedMinutes: bulk.minutes, doughFactor: 1 },
    benchEnd: bench.end,
  };

  // Separate doughs mix one after another from the end of the main mix, in library order;
  // split doughs leave the base bulk at their split point (§5).
  const tracks: DoughTrack[] = [base];
  const trackOf = new Map<Dough, DoughTrack>();
  let mixFrom = prefix.end();
  for (const { dough, grams } of inUse) {
    let track: DoughTrack;
    if (effectiveMethod(dough) === "separate") {
      track = separateTrack(dough, grams, mixFrom, ctx);
      mixFrom = track.steps[0]?.end ?? mixFrom;
    } else {
      track = splitTrack(dough, grams, bulk, base.folds, ctx);
    }
    tracks.push(track);
    trackOf.set(dough, track);
  }

  // One lane per (preset, dough) line, from its own track's bench rest (decision 2).
  const lanes: Lane[] = [];
  let end = tracks.reduce((latest, t) => later(latest, t.benchEnd), base.benchEnd);
  for (const line of lines) {
    if (lanes.some((l) => l.key === line.key)) continue;
    const p = line.preset;
    const run = chain((trackOf.get(line.dough) ?? base).benchEnd, dur);
    const shape = run.push(`shape:${line.key}`, "Shape", 10, shapeNote(line, plan));
    run.push(`proof:${line.key}`, proofLabel(p.proof), p.proofMinutes[0]);
    const bake = bakeFor(p, line.dough);
    run.push(`bake:${line.key}`, "Bake", p.bake.minutes[1], bake.note);
    lanes.push({
      key: line.key,
      presetId: p.id,
      name: p.name,
      icon: p.icon,
      doughId: line.dough.id,
      doughName: line.doughName,
      proof: p.proof,
      steps: run.steps,
      bakeWindow: {
        earliest: addMin(shape.end, p.proofMinutes[0]),
        latest: addMin(shape.end, p.proofMinutes[1]),
      },
      bakeTempC: bake.tempC,
      steam: bake.steam,
    });
    end = later(end, run.end());
  }

  return {
    steps: prefix.steps,
    tracks,
    foldCount,
    defaultFoldCount: defaultFoldCount(plan),
    lanes,
    ovenWarnings: ovenConflicts(lanes),
    end,
    folds: base.folds,
    bulk: base.bulk,
  };
}

/** A separate dough (§5): its own mix after the previous one, its own bulk, divide and bench. */
function separateTrack(d: Dough, g: DoughGrams, mixStart: Date, ctx: Ctx): DoughTrack {
  const { plan, est, foldCount, dur } = ctx;
  const run = chain(mixStart, dur);
  // Decision 13: 20 min for an enriched mix (butter in pieces), 10 as for the lean mix otherwise.
  const enriched = d.enrichments.some((e) => positive(e.pct) > 0);
  run.push(
    `mix@${d.id}`,
    plan.standMixer ? "Mix (stand mixer)" : "Mix",
    enriched ? 20 : 10,
    separateMixNote(d, g, plan, enriched),
  );
  const factor = bulkFactorFor(d);
  const guide = {
    ...est,
    minMinutes: est.minMinutes * factor,
    maxMinutes: est.maxMinutes * factor,
  };
  const bulk = run.push(`bulk@${d.id}`, "Bulk ferment", midpoint(guide), separateBulkNote(d, g));
  run.push(`divide@${d.id}`, "Divide & pre-shape", 15, DIVIDE_NOTE);
  const bench = run.push(`bench@${d.id}`, "Bench rest", 25);
  return {
    doughId: d.id,
    name: d.name,
    icon: d.icon,
    method: "separate",
    steps: run.steps,
    folds: foldsDuring(bulk, foldCount),
    bulk: { ...guide, usedMinutes: bulk.minutes, doughFactor: factor },
    benchEnd: bench.end,
  };
}

/**
 * A split dough (§5): taken out of the base bulk at its split point, then on its own. Its bulk
 * ends with the base bulk, or at base bulk start + the base bulk in use × its factor when that
 * differs from 1, so an edit to the base bulk moves it too: it is the same dough.
 */
function splitTrack(
  d: Dough,
  g: DoughGrams,
  baseBulk: TimelineStep,
  baseFolds: Date[],
  ctx: Ctx,
): DoughTrack {
  const { est, dur } = ctx;
  const into = INTO_BULK_MIN[splitAtFor(d)] ?? INTO_BULK_MIN.fold1;
  const run = chain(addMin(baseBulk.start, into), dur);
  const split = run.push(`split@${d.id}`, "Split off", 10, splitNote(d, g));
  const factor = bulkFactorFor(d);
  const gone = (split.end.getTime() - baseBulk.start.getTime()) / 60_000;
  const left = (minutes: number) => Math.max(0, minutes * factor - gone);
  const bulk = run.push(
    `bulk@${d.id}`,
    "Bulk ferment",
    Math.round(left(baseBulk.minutes)),
    BULK_NOTE,
  );
  run.push(`divide@${d.id}`, "Divide & pre-shape", 15, DIVIDE_NOTE);
  const bench = run.push(`bench@${d.id}`, "Bench rest", 25);
  return {
    doughId: d.id,
    name: d.name,
    icon: d.icon,
    method: "split",
    steps: run.steps,
    folds: baseFolds.filter((t) => t >= split.end && t <= bulk.end),
    bulk: {
      ...est,
      minMinutes: left(est.minMinutes),
      maxMinutes: left(est.maxMinutes),
      usedMinutes: bulk.minutes,
      doughFactor: factor,
    },
    benchEnd: bench.end,
  };
}

/** An item line as the timeline reads it (decision 2, §4). */
interface Line {
  preset: Preset;
  /** `presetId@<id>` keeps an id the library no longer has (decision 2). */
  key: string;
  /** The library dough; lean for lean lines and for an id the library no longer has. */
  dough: Dough;
  doughName: string;
  count: number;
  /** The planned weight: the override or the preset default, flexed in starter mode (§4). */
  weightEach: number;
  flex: number;
  /** Usable grams per gram of flour on this line's dough (§4, decision 6). */
  perFlour: number;
}

function resolveLines(plan: Plan, presets: Preset[], doughs: Dough[]): Line[] {
  const lines: Line[] = [];
  for (const sel of plan.items) {
    const preset = presets.find((p) => p.id === sel.presetId);
    if (!preset || !(sel.count > 0)) continue;
    const doughId = resolveDoughId(sel, preset);
    const found = findDough(doughId, doughs);
    const dough = found ?? LEAN;
    const override = sel.weightOverride;
    const pinned = override !== undefined && override > 0;
    lines.push({
      preset,
      key: lineKey(preset.id, doughId),
      dough,
      doughName: found ? found.name : `Lean (dough ${doughId} not found)`,
      count: Math.floor(sel.count),
      weightEach: pinned ? override : preset.defaultWeight,
      flex: pinned ? 0 : preset.flexPriority,
      perFlour: usablePerFlour(dough, plan.settings, plan),
    });
  }
  return lines;
}

/**
 * §4, decision 8: the weight each line is planned at, which the split and tangzhong grams need,
 * and the flour the batch holds in starter mode (undefined in items mode: the lines size it).
 * Items mode takes the planned weights as they stand. Starter mode water-fills the starter's
 * flour across the flex tiers in flour grams, as §4 has computePlan allocate it, so the notes
 * quote the grams the ingredients and division cards show while both follow §4.
 */
function allocateWeights(plan: Plan, lines: Line[]): number | undefined {
  if (plan.mode !== "starter") return undefined;
  const s = plan.settings;
  const S = plan.starterWeight ?? 0;
  const totalFlour =
    S > 0 && s.inoculation > 0 ? S / s.inoculation + S / (1 + s.starterHydration) : 0;
  let remaining = totalFlour - lines.reduce((sum, l) => sum + flourFor(l, l.weightEach), 0);
  const tiers = [...new Set(lines.filter((l) => l.flex > 0).map((l) => l.flex))].sort(
    (a, b) => b - a,
  );
  for (const tier of tiers) {
    if (Math.abs(remaining) < EPS) break;
    const members = lines.filter((l) => l.flex === tier && l.perFlour > 0);
    const clamped = new Set<Line>();
    // Water-fill: the same increment on every piece, clamp, and re-share what the clamped
    // pieces could not take among the rest until nobody clamps.
    for (let guard = 0; guard < members.length + 1; guard++) {
      const active = members.filter((m) => !clamped.has(m));
      if (active.length === 0 || Math.abs(remaining) < EPS) break;
      const share = remaining / active.reduce((n, m) => n + m.count / m.perFlour, 0);
      let anyClamped = false;
      for (const m of active) {
        const target = m.weightEach + share;
        const next = Math.min(m.preset.maxWeight, Math.max(m.preset.minWeight, target));
        remaining -= flourFor(m, next) - flourFor(m, m.weightEach);
        m.weightEach = next;
        if (Math.abs(next - target) > EPS) {
          clamped.add(m);
          anyClamped = true;
        }
      }
      if (!anyClamped) break;
    }
  }
  return totalFlour;
}

const flourFor = (l: Line, weight: number) =>
  l.perFlour > 0 ? (l.count * weight) / l.perFlour : 0;

/** F_d (§4): the flour the lines on this dough need. */
const flourOn = (d: Dough, lines: Line[]) =>
  lines.reduce((sum, l) => (l.dough === d ? sum + flourFor(l, l.weightEach) : sum), 0);

/** What a dough's step notes quote, in grams (§4). */
interface DoughGrams {
  /** The dough's total flour, starter flour included. */
  flour: number;
  /** Split: the base dough to take out, F × (1 + H + s). */
  portion: number;
  /** Separate: the added water and the milk left for the mix once a tangzhong has its liquid. */
  waterAtMix: number;
  milkAtMix: number;
  tangzhong?: Tangzhong;
}

interface Tangzhong {
  flour: number;
  liquid: number;
  kind: "milk" | "water";
}

function doughGrams(d: Dough, flour: number, s: Settings): DoughGrams {
  const hydration = doughHydration(d, s);
  const salt = doughSalt(d, s);
  // Starter water per gram of the dough's flour: starter = i × added flour and
  // added flour = flour ÷ (1 + i/(1 + h_s)), whatever the mode (§4, decision 7).
  const i = positive(s.inoculation);
  const hs = positive(s.starterHydration);
  const starterWater = (i * hs) / (1 + hs + i);
  const water = Math.max(0, flour * (hydration - starterWater - enrichmentWater(d)));
  const milk =
    flour *
    d.enrichments.filter((e) => e.kind === "milk").reduce((sum, e) => sum + positive(e.pct), 0);
  let tangzhong: Tangzhong | undefined;
  const tz = d.tangzhong;
  if (effectiveMethod(d) === "separate" && tz && positive(tz.flourPct) > 0) {
    const tzFlour = flour * tz.flourPct;
    const liquid = tzFlour * positive(tz.ratio);
    // One liquid, never a blend: the milk when it covers it, else the water, which is
    // clamped to what there is (§4; calc warns tangzhong-liquid-short).
    tangzhong =
      milk > 0 && milk >= liquid
        ? { flour: tzFlour, liquid, kind: "milk" }
        : { flour: tzFlour, liquid: Math.min(liquid, water), kind: "water" };
  }
  return {
    flour,
    portion: flour * (1 + hydration + salt),
    waterAtMix: water - (tangzhong?.kind === "water" ? tangzhong.liquid : 0),
    milkAtMix: milk - (tangzhong?.kind === "milk" ? tangzhong.liquid : 0),
    tangzhong,
  };
}

/** §5, decision 20: the make-it-first step, with its grams and the method. */
function tangzhongNote(d: Dough, tz: Tangzhong): string {
  return `Tangzhong for ${d.name}: cook ${grams(tz.flour)} flour with ${grams(tz.liquid)} ${tz.kind}, stirring, to 65 °C, a thick paste that holds a line. Cool to room temperature before it goes in. Made the day before and kept in the fridge is fine: bring it back to room temperature.`;
}

/** §5, decision 11: how much base dough to take, and everything that goes into it now. */
function splitNote(d: Dough, g: DoughGrams): string {
  const work = [
    ...d.enrichments
      .filter((e) => positive(e.pct) > 0)
      .map((e) => `${grams(e.pct * g.flour)} ${enrichmentName(e.kind)}`),
    ...(d.sweetness && positive(d.sweetness.pct) > 0
      ? [`${grams(d.sweetness.pct * g.flour)} ${sweetName(d.sweetness.kind)}`]
      : []),
    ...addIns(d, (at) => at !== "shape").map((x) => inclusionPhrase(x, g.flour)),
  ];
  const workIn = work.length > 0 ? ` Work in ${work.join(", ")}.` : "";
  return `Take ${grams(g.portion)} of dough for ${d.name}.${workIn} Keep it separate from here on.`;
}

/**
 * §5, decisions 11 and 13: the separate mix. Liquids, oil and any sweetness go in first (with the
 * cooled tangzhong when there is one); butter over 10 % goes in pieces once the gluten is built.
 */
function separateMixNote(d: Dough, g: DoughGrams, plan: Plan, enriched: boolean): string {
  const mixer = plan.standMixer === true;
  const atMix = (kind: EnrichmentKind) =>
    d.enrichments.some(
      (e) => e.kind === kind && positive(e.pct) > 0 && enrichmentAddAt(e) === "mix",
    );
  const sweet =
    d.sweetness && positive(d.sweetness.pct) > 0 ? sweetName(d.sweetness.kind) : undefined;
  const first = [
    ...(atMix("milk") && g.milkAtMix >= 0.5 ? ["milk"] : []),
    ...(atMix("egg") ? ["egg"] : []),
    ...(atMix("yolk") ? ["egg yolk"] : []),
    ...(g.waterAtMix >= 0.5 ? ["water"] : []),
    ...(atMix("oil") ? ["oil"] : []),
    ...(sweet ? [sweet] : []),
  ];
  const out: string[] = [];
  if (enriched) {
    const dry = atMix("butter")
      ? "the starter, flour, salt and softened butter"
      : "the starter, flour and salt";
    let lead: string;
    if (g.tangzhong) {
      lead =
        first.length > 0
          ? `Cooled tangzhong in with the ${listOf(first)}, then ${dry}`
          : `Cooled tangzhong, then ${dry}`;
    } else {
      lead = first.length > 0 ? `${capFirst(listOf(first))}, then ${dry}` : capFirst(dry);
    }
    out.push(`${lead}: ${mixer ? "dough hook" : "knead"} to a windowpane.`);
    const late = new Set(
      d.enrichments
        .filter((e) => positive(e.pct) > 0 && enrichmentAddAt(e) === "after-mix")
        .map((e) => e.kind),
    );
    for (const kind of late) {
      out.push(
        kind === "butter"
          ? "Butter in pieces over 5–8 min."
          : `${capFirst(enrichmentName(kind))} in a little at a time.`,
      );
    }
    out.push(
      mixer ? "Keep the dough under 26 °C; the mixer warms it." : "Keep the dough under 26 °C.",
    );
  } else {
    if (g.tangzhong) {
      out.push(
        first.length > 0
          ? `Cooled tangzhong in with the ${listOf(first)}.`
          : "Cooled tangzhong in first.",
      );
    } else if (sweet) {
      out.push(`${capFirst(sweet)} in with the water.`);
    }
    out.push(mixer ? MIXER_MIX_NOTE : HAND_MIX_NOTE);
  }
  const early = addIns(d, (at) => at === "mix");
  if (early.length > 0) {
    out.push(`At the end, work in ${early.map((x) => inclusionPhrase(x, g.flour)).join(", ")}.`);
  }
  if (enriched) out.push(bakeAdvice(d));
  return out.join(" ");
}

/** §5 and decision 23: an enriched dough is baked to its inside temperature, not to colour. */
function bakeAdvice(d: Dough): string {
  const sw = d.sweetness && positive(d.sweetness.pct) > 0 ? d.sweetness : undefined;
  if (!sw) {
    return "No sugar, so bake to 88–93 °C inside rather than to colour, and a young levain keeps it mild.";
  }
  return SWEETENERS[sw.kind]?.browns === "no"
    ? `${capFirst(sweetName(sw.kind))} does not brown, so bake to 88–93 °C inside rather than to colour.`
    : "It browns early, so bake to 88–93 °C inside rather than to colour.";
}

/** Decision 11: a separate dough's own add-ins go in 30 min (fold 1) or 60 min (fold 2) into bulk. */
function separateBulkNote(d: Dough, g: DoughGrams): string {
  const enriched = d.enrichments.some((e) => positive(e.pct) > 0);
  const out = [enriched ? "Go by the dough, not the clock." : BULK_NOTE];
  const at = (when: InclusionAddAt) =>
    addIns(d, (a) => a === when)
      .map((x) => inclusionPhrase(x, g.flour))
      .join(", ");
  const laminate = at("lamination");
  const fold1 = at("fold1");
  const fold2 = at("fold2");
  if (laminate) out.push(`${INTO_BULK_MIN.fold1} min in, laminate in ${laminate}.`);
  if (fold1) out.push(`${INTO_BULK_MIN.fold1} min in (fold 1), work in ${fold1}.`);
  if (fold2) out.push(`${INTO_BULK_MIN.fold2} min in (fold 2), work in ${fold2}.`);
  return out.join(" ");
}

/**
 * Decision 11: a `shape` add-in becomes a note on the lane's shape step. Per piece it is
 * weight × pct ÷ k, with k counting the add-ins or not by the plan's tick box (§4, decision 6).
 */
function shapeNote(line: Line, plan: Plan): string | undefined {
  const note = line.preset.note;
  const tucks = addIns(line.dough, (at) => at === "shape");
  if (tucks.length === 0) return note;
  const k =
    plan.weightsIncludeAdditions === false
      ? doughOnlyFactor(line.dough, plan.settings)
      : compositionFactor(line.dough, plan.settings);
  const perPiece = k > 0 ? line.weightEach / k : 0;
  const tuck = `Tuck ${tucks.map((x) => inclusionPhrase(x, perPiece)).join(", ")} into each piece as you shape.`;
  return note ? `${note} ${tuck}` : tuck;
}

/** Decision 12: the dough's bake override wins over the preset's; the durations stay the preset's. */
function bakeFor(p: Preset, d: Dough): { tempC: number; steam: boolean; note: string } {
  const own = d.bake;
  const t = own?.tempC;
  const tempC = t !== undefined && Number.isFinite(t) && t > 0 ? t : p.bake.tempC;
  const steam = own?.steam ?? p.bake.steam;
  const wash = own?.wash?.trim();
  const [shortest, longest] = p.bake.minutes;
  const note = `${tempC} °C, ${shortest}–${longest} min${steam ? ", steam" : ""}${wash ? `, wash: ${midSentence(wash)}` : ""}`;
  return { tempC, steam, note };
}

const proofLabel = (proof: ProofType) =>
  proof === "cold" ? "Cold retard" : proof === "either" ? "Proof (room or fridge)" : "Proof";

/** The inclusions with an amount whose add-at passes `when`. */
const addIns = (d: Dough, when: (at: InclusionAddAt) => boolean) =>
  d.inclusions.filter((x) => positive(x.pct) > 0 && when(inclusionAddAt(x)));

/** "71 g mature cheddar", "43 g mixed seeds (…) soaked in 43 g water": per gram of `flour`. */
function inclusionPhrase(x: Inclusion, flour: number): string {
  const soak = positive(x.soakerWaterPct) * flour;
  return `${grams(x.pct * flour)} ${inclusionName(x)}${soak > 0 ? ` soaked in ${grams(soak)} water` : ""}`;
}

/** "Jalapeño, fresh, diced" reads "jalapeño (fresh, diced)" in a list; a bracketed name stays. */
function inclusionName(x: Inclusion): string {
  const name = (x.name || "").trim() || INCLUSIONS[x.kind]?.label || x.kind;
  const comma = name.indexOf(", ");
  return midSentence(
    comma > 0 && !name.includes("(") ? `${name.slice(0, comma)} (${name.slice(comma + 2)})` : name,
  );
}

const enrichmentName = (kind: EnrichmentKind) => (ENRICHMENTS[kind]?.label ?? kind).toLowerCase();
const sweetName = (kind: SweetKind) => (SWEETENERS[kind]?.label ?? kind).toLowerCase();

/** Whole grams; two decimals under a gram (a high-intensity sweetener). */
const grams = (n: number) => (n >= 1 ? `${Math.round(n)} g` : `${n.toFixed(2)} g`);

/** A usable amount: finite and positive, else 0. */
const positive = (n: number | undefined) =>
  n !== undefined && Number.isFinite(n) && n > 0 ? n : 0;

/** "a", "a and b", "a, b and c". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Lower-case the first letter for use mid-sentence, unless it opens an acronym ("XO sauce"). */
function midSentence(s: string): string {
  const upper = (c: string) => c !== c.toLowerCase();
  return upper(s.charAt(0)) && upper(s.charAt(1)) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

const midpoint = (e: BulkEstimate) => Math.round((e.minMinutes + e.maxMinutes) / 2);

function foldsDuring(bulk: TimelineStep, count: number): Date[] {
  const folds: Date[] = [];
  for (let i = 1; i <= count; i++) {
    const t = addMin(bulk.start, i * FOLD_INTERVAL_MIN);
    if (t <= bulk.end) folds.push(t);
  }
  return folds;
}

/** Back-to-back steps from `start`: each push begins where the previous one ended. */
function chain(start: Date, dur: Durations) {
  const steps: TimelineStep[] = [];
  let cursor = start;
  const push = (id: string, label: string, def: number, note?: string): TimelineStep => {
    const minutes = dur(id, def);
    const step: TimelineStep = {
      id,
      label,
      start: cursor,
      end: addMin(cursor, minutes),
      minutes,
      defaultMinutes: def,
      note,
    };
    steps.push(step);
    cursor = step.end;
    return step;
  };
  return { steps, push, end: () => cursor };
}

/**
 * A lane as a warning names it: "Loaf" for the lean line, "Loaf (Jalapeño cheddar)" for any other,
 * a line on a missing dough included, so two loaves never read "Loaf, Loaf".
 */
export function laneLabel(lane: Pick<Lane, "key" | "presetId" | "name" | "doughName">): string {
  return lane.key === lane.presetId ? lane.name : `${lane.name} (${lane.doughName})`;
}

function bakeStep(l: Lane): TimelineStep | undefined {
  return l.steps.find((s) => s.id.startsWith("bake:"));
}

/** Overlapping bake slots. Suggests shortest bake first; cold-retarded items last. */
export function ovenConflicts(lanes: Lane[]): string[] {
  const out: string[] = [];
  const withBake = lanes.filter((l) => bakeStep(l));
  const clashing = new Set<Lane>();
  for (let i = 0; i < withBake.length; i++) {
    for (let j = i + 1; j < withBake.length; j++) {
      const a = bakeStep(withBake[i]!)!;
      const b = bakeStep(withBake[j]!)!;
      if (a.start < b.end && b.start < a.end) {
        clashing.add(withBake[i]!);
        clashing.add(withBake[j]!);
      }
    }
  }
  if (clashing.size === 0) return out;
  const order = [...clashing].sort((a, b) => {
    const coldA = a.proof === "cold" ? 1 : 0;
    const coldB = b.proof === "cold" ? 1 : 0;
    if (coldA !== coldB) return coldA - coldB;
    return bakeStep(a)!.minutes - bakeStep(b)!.minutes;
  });
  const first = order[0]!;
  let t = bakeStep(first)!.start;
  const seq = order.map((l) => {
    const s = bakeStep(l)!;
    const start = t;
    t = addMin(t, s.minutes);
    return `${laneLabel(l)} ${fmtHM(start)}–${fmtHM(t)}`;
  });
  out.push(
    `Oven clash: ${order.map(laneLabel).join(", ")} need the oven at the same time. Suggested order: ${seq.join(", then ")}.`,
  );
  return out;
}

function fmtHM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
