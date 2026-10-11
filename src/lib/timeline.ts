import { ENRICHMENTS, INCLUSIONS, SWEETENERS, findDough, leanDough, splitAtFor } from "./doughs";
import { lineLabel } from "./format";
import {
  LEAN_DOUGH_ID,
  type AdditionLine,
  type AllocationLine,
  type BatchResult,
  type Dough,
  type DoughResult,
  type EffectiveMethod,
  type MixResult,
  type Plan,
  type Preset,
  type ProofType,
  type SplitAt,
  type SweetKind,
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
  /**
   * Its length follows other steps, so it has none of its own to edit: the main dough's bulk
   * when it only rests until its last split (no lean pieces).
   */
  fixed?: boolean;
}

export interface Lane {
  /** `presetId` for lean, `presetId@doughId` otherwise (decision 2); lane step ids use it. */
  key: string;
  presetId: string;
  /** The preset's name. */
  name: string;
  /**
   * The lane named on its own, as every message names its line (`lineLabel`): "Loaf",
   * "Loaf (Jalapeño cheddar)", "Loaf (dough x not found)".
   */
  label: string;
  icon?: string;
  /** The dough the lane is timed on, as computePlan resolved it: lean for an id the library lacks. */
  doughId: string;
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
  /** Why it is mixed the way it is, from computePlan: "Mixed separately: …", "Split off at …". */
  reason: string;
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
  /**
   * The common prefix: tangzhong@<id>…, feed?, then autolyse? and mix when there is a base mix
   * (none when it holds no flour: items mode with no lean or split line).
   */
  steps: TimelineStep[];
  /** The base dough first when there is a base mix, then the separate and split doughs in library order. */
  tracks: DoughTrack[];
  /** Sets asked for (default or override) and the default for the mixing method. */
  foldCount: number;
  defaultFoldCount: number;
  lanes: Lane[];
  ovenWarnings: string[];
  end: Date;
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

/** Holding water back for the salt needs a water line with that much in it (as the ingredients card). */
const RESERVE_WATER_G = 20;

/** A plain mix, by hand or by mixer; it keeps water back for the salt only when it has the water. */
function plainMixNote(mixer: boolean, addedWater: number): string {
  const reserve = addedWater >= RESERVE_WATER_G ? " Reserve ~20 g water for the salt." : "";
  return mixer
    ? `Dough hook, low speed 2–3 min to combine, then speed 2 for 4–6 min until smooth and elastic.${reserve} Watch the dough temperature; the mixer warms it.`
    : `Add starter and salt.${reserve}`;
}
const BULK_NOTE = "Target a 50–75 % rise, domed and jiggly. The clock is a guide.";
const DIVIDE_NOTE = "Weigh each piece from the division card.";

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
 * §5 — the whole schedule from the start time: the common prefix, one track per dough in use and
 * one lane per (preset, dough) line. Every gram a note quotes, every dough's method, factor and
 * mix length, and every line comes from `result`, computePlan's answer for the same plan, so the
 * timeline never disagrees with the ingredients or the division. Pure; overrides cascade naturally.
 */
export function buildTimeline(
  plan: Plan,
  presets: Preset[],
  table: BulkRow[],
  doughs: Dough[],
  result: BatchResult,
): Timeline {
  const ov = plan.timelineOverrides ?? {};
  const dur: Durations = (id, def) => {
    const v = ov[id];
    return v !== undefined && Number.isFinite(v) && v >= 0 ? v : def;
  };
  const est = bulkEstimate(plan.settings.doughTempC, plan.settings.inoculation, table);
  const foldCount = foldCountFor(plan);
  const ctx: Ctx = { plan, est, foldCount, dur };

  const lines = result.allocation.filter((l) => l.count > 0);
  const mixOf = (id: string) => result.mixes.find((m) => m.id === id);
  const baseMix = mixOf("base");
  // The base mix is absent when it holds no flour: items mode with no lean or split line. A line
  // that rides on it (lean, a split, a dough the library lacks) keeps it whatever its flour.
  const onBase = new Set(result.doughs.filter((d) => d.mixId === "base").map((d) => d.doughId));
  const hasBase =
    (baseMix !== undefined && baseMix.totalFlour > 0) ||
    lines.some((l) => l.doughId === LEAN_DOUGH_ID || onBase.has(l.doughId));

  let start = new Date(plan.startTime);
  if (Number.isNaN(start.getTime())) start = new Date();

  // The common prefix (decision 20): every tangzhong first, cooling while whatever follows runs,
  // then feed; then autolyse and the main mix when there is a main mix.
  const prefix = chain(start, dur);
  const cooling = plan.feedStarter || (hasBase && plan.autolyse);
  for (const d of result.doughs) {
    const tz = d.method === "separate" ? tangzhongOf(d, mixOf(d.mixId)) : undefined;
    if (tz) {
      prefix.push(
        `tangzhong@${d.doughId}`,
        "Cook tangzhong",
        cooling ? 15 : 45,
        tangzhongNote(d, tz),
      );
    }
  }
  if (plan.feedStarter) prefix.push("feed", "Feed starter", 360, "4–8 h until it peaks, then mix.");
  // Lean has pieces when a line on it has any (a line on a missing dough reads lean); the main
  // dough then bulks, divides and benches as it always did (§10). Without them it only feeds
  // its splits, if it has any, and holds whatever spare a starter-mode batch leaves.
  const leanPieces = result.allocation.some((l) => l.doughId === LEAN_DOUGH_ID && l.count > 0);
  const splits = result.doughs.filter((d) => d.method === "split");
  const restOnly = hasBase && !leanPieces && splits.length > 0;
  let batch: { run: ReturnType<typeof chain>; bulk: TimelineStep; folds: Date[] } | undefined;
  if (hasBase) {
    if (plan.autolyse) {
      prefix.push("autolyse", "Autolyse", 45, "Flour plus most of the water. Rest.");
    }
    const mixMinutes = baseMix?.mixMinutes ?? 10;
    const note = plainMixNote(plan.standMixer === true, baseMix?.addedWater ?? 0);
    prefix.push("mix", plan.standMixer ? "Mix (stand mixer)" : "Mix", mixMinutes, note);

    // The batch's bulk: the clock every split runs on. When the main dough only rests until its
    // splits, no step shows this bulk, so an edit to it (left from a plan that had lean pieces)
    // would move the splits unseen: they run on the guide instead.
    const run = chain(prefix.end(), restOnly ? (_id, def) => def : dur);
    const bulk = run.push("bulk", "Bulk ferment", midpoint(est), BULK_NOTE);
    if (leanPieces) {
      run.push("divide", "Divide & pre-shape", 15, DIVIDE_NOTE);
      run.push("bench", "Bench rest", 25);
    }
    batch = { run, bulk, folds: foldsDuring(bulk, foldCount) };
  }

  // Separate doughs mix one after another from the end of the prefix, in library order; split
  // doughs leave the batch's bulk at their split point (§5).
  const others: DoughTrack[] = [];
  let mixFrom = prefix.end();
  for (const d of result.doughs) {
    let track: DoughTrack | undefined;
    if (d.method === "separate") {
      track = separateTrack(d, mixOf(d.mixId), mixFrom, ctx);
      mixFrom = track.steps[0]?.end ?? mixFrom;
    } else if (d.method === "split" && batch) {
      const splitAt = splitAtFor(findDough(d.doughId, doughs) ?? LEAN);
      const whole = !leanPieces && isWholeBase(d, baseMix);
      track = splitTrack(d, splitAt, batch.bulk, batch.folds, whole, ctx);
    }
    if (track) others.push(track);
  }

  // The main dough first. Without lean pieces its bulk ends with the last split and nothing
  // divides it: it has nothing left to divide.
  const tracks: DoughTrack[] = [];
  if (batch) {
    const lean = result.doughs.find((d) => d.method === "base");
    let steps = batch.run.steps;
    let folds = batch.folds;
    if (restOnly) {
      const splitTracks = others.filter((t) => t.method === "split");
      const last = splitTracks
        .map((t) => t.steps[0]!)
        .reduce((a, b) => (b.end.getTime() > a.end.getTime() ? b : a));
      const minutes = (last.end.getTime() - batch.bulk.start.getTime()) / 60_000;
      const names = splitTracks.map((t) => t.name);
      const carry = names.length === 1 ? "track carries" : "tracks carry";
      steps = [
        {
          ...batch.bulk,
          label: "Bulk ferment (until the split)",
          end: last.end,
          minutes,
          defaultMinutes: minutes,
          note: `The whole batch rests until it is split; the ${listOf(names)} ${carry} on from there.`,
          fixed: true,
        },
      ];
      folds = batch.folds.filter((t) => t < last.start);
    }
    const bulkStep = steps[0]!;
    tracks.push({
      doughId: LEAN_DOUGH_ID,
      name: lean?.name ?? LEAN.name,
      icon: lean?.icon,
      method: "base",
      reason: lean?.reason ?? "",
      steps,
      folds,
      bulk: { ...est, usedMinutes: bulkStep.minutes, doughFactor: 1 },
      benchEnd: steps[steps.length - 1]!.end,
    });
  }
  tracks.push(...others);
  const trackOf = new Map(tracks.map((t) => [t.doughId, t] as const));

  // One lane per (preset, dough) line, in item order, from its own track's bench rest (decision 2).
  const lanes: Lane[] = [];
  let end = tracks.reduce((latest, t) => later(latest, t.benchEnd), prefix.end());
  for (const line of lines) {
    const p = presets.find((x) => x.id === line.presetId);
    if (!p || lanes.some((l) => l.key === line.key)) continue;
    const from = (trackOf.get(line.doughId) ?? tracks[0])?.benchEnd ?? prefix.end();
    const run = chain(from, dur);
    const dough = result.doughs.find((d) => d.doughId === line.doughId);
    const shape = run.push(`shape:${line.key}`, "Shape", 10, shapeNote(p, line, dough));
    run.push(`proof:${line.key}`, proofLabel(p.proof), p.proofMinutes[0]);
    const bake = bakeFor(p, findDough(line.doughId, doughs) ?? LEAN);
    run.push(`bake:${line.key}`, "Bake", p.bake.minutes[1], bake.note);
    lanes.push({
      key: line.key,
      presetId: p.id,
      name: p.name,
      label: lineLabel(line),
      icon: p.icon,
      doughId: line.doughId,
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
  };
}

/** A separate dough (§5): its own mix after the previous one, its own bulk, divide and bench. */
function separateTrack(
  d: DoughResult,
  mix: MixResult | undefined,
  mixStart: Date,
  ctx: Ctx,
): DoughTrack {
  const { plan, est, foldCount, dur } = ctx;
  const run = chain(mixStart, dur);
  const enriched = d.additions.some((a) => a.kind in ENRICHMENTS && a.grams > 0);
  run.push(
    `mix@${d.doughId}`,
    plan.standMixer ? "Mix (stand mixer)" : "Mix",
    mix?.mixMinutes ?? 10,
    separateMixNote(d, mix, plan, enriched),
  );
  const factor = d.bulkFactor;
  const guide = {
    ...est,
    minMinutes: est.minMinutes * factor,
    maxMinutes: est.maxMinutes * factor,
  };
  const bulk = run.push(
    `bulk@${d.doughId}`,
    "Bulk ferment",
    midpoint(guide),
    separateBulkNote(d, enriched),
  );
  run.push(`divide@${d.doughId}`, "Divide & pre-shape", 15, DIVIDE_NOTE);
  const bench = run.push(`bench@${d.doughId}`, "Bench rest", 25);
  return {
    doughId: d.doughId,
    name: d.name,
    icon: d.icon,
    method: "separate",
    reason: d.reason,
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
  d: DoughResult,
  splitAt: SplitAt,
  baseBulk: TimelineStep,
  baseFolds: Date[],
  whole: boolean,
  ctx: Ctx,
): DoughTrack {
  const { est, dur } = ctx;
  const into = INTO_BULK_MIN[splitAt] ?? INTO_BULK_MIN.fold1;
  const run = chain(addMin(baseBulk.start, into), dur);
  const split = run.push(`split@${d.doughId}`, "Split off", 10, splitNote(d, whole));
  const factor = d.bulkFactor;
  const gone = (split.end.getTime() - baseBulk.start.getTime()) / 60_000;
  const left = (minutes: number) => Math.max(0, minutes * factor - gone);
  const bulk = run.push(
    `bulk@${d.doughId}`,
    "Bulk ferment",
    Math.round(left(baseBulk.minutes)),
    BULK_NOTE,
  );
  run.push(`divide@${d.doughId}`, "Divide & pre-shape", 15, DIVIDE_NOTE);
  const bench = run.push(`bench@${d.doughId}`, "Bench rest", 25);
  return {
    doughId: d.doughId,
    name: d.name,
    icon: d.icon,
    method: "split",
    reason: d.reason,
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

interface TangzhongLines {
  flour: AdditionLine;
  liquid: AdditionLine;
}

/** A separate dough's two tangzhong lines, the paste first, from its result or else its mix. */
function tangzhongOf(d: DoughResult, mix: MixResult | undefined): TangzhongLines | undefined {
  for (const lines of [d.additions, mix?.additions ?? []]) {
    const flour = lines.find((a) => a.kind === "tangzhong-flour");
    const liquid = lines.find((a) => a.kind === "tangzhong-liquid");
    if (flour && liquid) return { flour, liquid };
  }
  return undefined;
}

/** §5, decision 20: the make-it-first step, with the grams of its two lines and the method. */
function tangzhongNote(d: DoughResult, tz: TangzhongLines): string {
  // "Tangzhong water" or "Tangzhong milk": calc names the one liquid it took.
  const liquid = tz.liquid.label.replace(/^tangzhong\s+/i, "").toLowerCase() || "liquid";
  return `Tangzhong for ${d.name}: cook ${grams(tz.flour.grams)} flour with ${grams(tz.liquid.grams)} ${liquid}, stirring, to 65 °C, a thick paste that holds a line. Cool to room temperature before it goes in. Made the day before and kept in the fridge is fine: bring it back to room temperature. If it waits more than about two hours (it will while the starter feeds), keep it in the fridge and bring it back to room temperature before the mix.`;
}

/** §5, decision 11: how much base dough to take, and everything that goes into it now. */
function splitNote(d: DoughResult, whole: boolean): string {
  const work = phrases(d.additions.filter((a) => a.addAt !== "shape"));
  if (whole) {
    return work.length > 0
      ? `Work in ${work.join(", ")}: this is all of the main dough.`
      : "This is all of the main dough.";
  }
  const workIn = work.length > 0 ? ` Work in ${work.join(", ")}.` : "";
  return `Take ${grams(d.portion ?? 0)} of dough for ${d.name}.${workIn} Keep it separate from here on.`;
}

/**
 * Whether a split takes the whole main dough (there are no lean pieces to leave behind): its
 * portion is the base mix's dough to the half gram, or it is the one dough the base mix holds.
 */
function isWholeBase(d: DoughResult, base: MixResult | undefined): boolean {
  if (!base) return false;
  const only = base.doughIds.length === 1 && base.doughIds[0] === d.doughId;
  return only || (d.portion ?? 0) >= base.totalDough - 0.5;
}

/**
 * §5, decisions 11 and 13: the separate mix, read off its lines as weighed. Liquids, oil and any
 * sweetness go in first (with the cooled tangzhong when there is one); butter after the mix goes
 * in pieces once the gluten is built.
 */
function separateMixNote(
  d: DoughResult,
  mix: MixResult | undefined,
  plan: Plan,
  enriched: boolean,
): string {
  const mixer = plan.standMixer === true;
  const lines = mix?.additions ?? d.additions;
  const atMix = lines.filter((a) => a.addAt === "mix" && a.grams > 0);
  const has = (kind: string) => atMix.some((a) => a.kind === kind);
  const milk = atMix.filter((a) => a.kind === "milk").reduce((n, a) => n + a.grams, 0);
  const water = mix?.addedWater ?? d.addedWater;
  const sweet = atMix.find((a) => a.kind in SWEETENERS);
  const first = [
    ...(milk >= 0.5 ? ["milk"] : []),
    ...(has("egg") ? ["egg"] : []),
    ...(has("yolk") ? ["egg yolk"] : []),
    ...(water >= 0.5 ? ["water"] : []),
    ...(has("oil") ? ["oil"] : []),
    ...(sweet ? [sweet.label.toLowerCase()] : []),
  ];
  const tz = tangzhongOf(d, mix) !== undefined;
  const out: string[] = [];
  if (enriched) {
    const dry = has("butter")
      ? "the starter, flour, salt and softened butter"
      : "the starter, flour and salt";
    let lead: string;
    if (tz) {
      lead =
        first.length > 0
          ? `Cooled tangzhong in with the ${listOf(first)}, then ${dry}`
          : `Cooled tangzhong, then ${dry}`;
    } else {
      lead = first.length > 0 ? `${capFirst(listOf(first))}, then ${dry}` : capFirst(dry);
    }
    out.push(`${lead}: ${mixer ? "dough hook" : "knead"} to a windowpane.`);
    const late = new Set(
      lines.filter((a) => a.addAt === "after-mix" && a.grams > 0).map((a) => a.kind),
    );
    for (const kind of late) {
      const label = ENRICHMENTS[kind as keyof typeof ENRICHMENTS]?.label ?? kind;
      out.push(
        kind === "butter"
          ? "Butter in pieces over 5–8 min."
          : `${capFirst(label.toLowerCase())} in a little at a time.`,
      );
    }
    out.push(
      mixer ? "Keep the dough under 26 °C; the mixer warms it." : "Keep the dough under 26 °C.",
    );
  } else {
    if (tz) {
      out.push(
        first.length > 0
          ? `Cooled tangzhong in with the ${listOf(first)}.`
          : "Cooled tangzhong in first.",
      );
    } else if (sweet) {
      out.push(`${capFirst(sweet.label.toLowerCase())} in with the water.`);
    }
    out.push(plainMixNote(mixer, water));
  }
  const early = phrases(lines.filter((a) => a.addAt === "mix" && isAddIn(a)));
  if (early.length > 0) out.push(`At the end, work in ${early.join(", ")}.`);
  if (enriched) out.push(bakeAdvice(sweet));
  return out.join(" ");
}

/** §5 and decision 23: an enriched dough is baked to its inside temperature, not to colour. */
function bakeAdvice(sweet: AdditionLine | undefined): string {
  if (!sweet) {
    return "No sugar, so bake to 88–93 °C inside rather than to colour, and a young levain keeps it mild.";
  }
  return SWEETENERS[sweet.kind as SweetKind]?.browns === "no"
    ? `${capFirst(sweet.label.toLowerCase())} does not brown, so bake to 88–93 °C inside rather than to colour.`
    : "It browns early, so bake to 88–93 °C inside rather than to colour.";
}

/** Decision 11: a separate dough's own add-ins go in 30 min (fold 1) or 60 min (fold 2) into bulk. */
function separateBulkNote(d: DoughResult, enriched: boolean): string {
  const out = [enriched ? "Go by the dough, not the clock." : BULK_NOTE];
  const at = (when: AdditionLine["addAt"]) =>
    phrases(d.additions.filter((a) => a.addAt === when)).join(", ");
  const laminate = at("lamination");
  const fold1 = at("fold1");
  const fold2 = at("fold2");
  if (laminate) out.push(`${INTO_BULK_MIN.fold1} min in, laminate in ${laminate}.`);
  if (fold1) out.push(`${INTO_BULK_MIN.fold1} min in (fold 1), work in ${fold1}.`);
  if (fold2) out.push(`${INTO_BULK_MIN.fold2} min in (fold 2), work in ${fold2}.`);
  return out.join(" ");
}

/**
 * Decision 11: a `shape` add-in becomes a note on the lane's shape step. Per piece it is the
 * line's own add-ins per piece (computePlan's `additionsEach`) in the dough's add-in proportions.
 */
function shapeNote(
  p: Preset,
  line: AllocationLine,
  d: DoughResult | undefined,
): string | undefined {
  const tucks = d?.additions.filter((a) => a.addAt === "shape") ?? [];
  if (!d || tucks.length === 0) return p.note;
  const addIns = d.additions.filter(isAddIn).reduce((n, a) => n + a.grams, 0);
  const perPiece = addIns > 0 ? line.additionsEach / addIns : 0;
  const tuck = `Tuck ${phrases(tucks, perPiece).join(", ")} into each piece as you shape.`;
  return p.note ? `${p.note} ${tuck}` : tuck;
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

/** Inclusions and their soaker water: what a piece weighs on top of its dough (decision 6). */
const isAddIn = (a: AdditionLine) => a.kind in INCLUSIONS || a.kind === "soaker-water";

/**
 * Addition lines as a list, grams × `scale`: "71 g mature cheddar", "13 g mixed seeds soaked in
 * 13 g water" (an inclusion and the soaker line computePlan writes straight after it).
 */
function phrases(lines: AdditionLine[], scale = 1): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i]!;
    if (a.kind === "tangzhong-flour" || a.kind === "tangzhong-liquid") continue;
    const amount = grams(a.grams * scale);
    if (!(a.kind in INCLUSIONS)) {
      out.push(
        `${amount} ${a.kind === "soaker-water" ? midSentence(a.label) : a.label.toLowerCase()}`,
      );
      continue;
    }
    const next = lines[i + 1];
    const soak =
      next?.kind === "soaker-water" && next.label === soakerLabel(a.label) ? next : undefined;
    if (soak) i++;
    out.push(
      `${amount} ${inclusionName(a.label)}${soak ? ` soaked in ${grams(soak.grams * scale)} water` : ""}`,
    );
  }
  return out;
}

/** The label computePlan gives an inclusion's soaker water: "Soaker water (mixed seeds)". */
const soakerLabel = (label: string) =>
  `Soaker water (${label
    .replace(/\s*\(.*\)\s*$/, "")
    .trim()
    .toLowerCase()})`;

/** "Jalapeño, fresh, diced" reads "jalapeño (fresh, diced)" in a list; a bracketed name stays. */
function inclusionName(label: string): string {
  const comma = label.indexOf(", ");
  return midSentence(
    comma > 0 && !label.includes("(")
      ? `${label.slice(0, comma)} (${label.slice(comma + 2)})`
      : label,
  );
}

/** Whole grams; two decimals under a gram (a high-intensity sweetener). */
const grams = (n: number) => (n >= 1 ? `${Math.round(n)} g` : `${n.toFixed(2)} g`);

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
    return `${l.label} ${fmtHM(start)}–${fmtHM(t)}`;
  });
  out.push(
    `Oven clash: ${order.map((l) => l.label).join(", ")} need the oven at the same time. Suggested order: ${seq.join(", then ")}.`,
  );
  return out;
}

function fmtHM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
