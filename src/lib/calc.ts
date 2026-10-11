import {
  DEFAULT_SETTINGS,
  LEAN_DOUGH_ID,
  type AdditionLine,
  type AllocationLine,
  type BatchResult,
  type Dough,
  type DoughResult,
  type EffectiveMethod,
  type Ingredients,
  type ItemSelection,
  type MixResult,
  type Plan,
  type Preset,
  type Settings,
  type SplitAt,
} from "./types";
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
  positive,
  resolveDoughId,
  separateReasons,
  splitAtFor,
  usablePerFlour,
} from "./doughs";
import { joinAnd, lineLabel } from "./format";
import { collectWarnings } from "./warnings";

/** The one rule for naming a line or a lane (decision 2); it lives with the formatters. */
export { lineLabel };

const EPS = 1e-9;

/** §5.1 — the plain batch from S grams of starter: T = S/i + S/(1 + h_s) of flour. Unrounded. */
export function batchFromStarter(S: number, s: Settings): Ingredients {
  if (!(S > 0) || !(s.inoculation > 0)) return emptyIngredients();
  const starterFlour = S / (1 + s.starterHydration);
  const starterWater = S - starterFlour;
  const addedFlour = S / s.inoculation;
  const totalFlour = addedFlour + starterFlour;
  const totalWater = s.hydration * totalFlour;
  const addedWater = totalWater - starterWater;
  const salt = s.salt * totalFlour;
  const totalDough = addedFlour + addedWater + S + salt;
  const usableDough = totalDough * (1 - s.benchLoss);
  return {
    addedFlour,
    addedWater,
    starter: S,
    starterFlour,
    starterWater,
    salt,
    totalFlour,
    totalWater,
    totalDough,
    usableDough,
    trueHydration: totalWater / totalFlour,
  };
}

/**
 * §4 — the starter a batch holding `totalFlour` grams of flour (starter flour included) needs:
 * i × addedFlour, where addedFlour = T / (1 + i/(1 + h_s)).
 */
function starterForFlour(totalFlour: number, s: Settings): number {
  if (!(totalFlour > 0) || !(s.inoculation > 0)) return 0;
  const addedFlour = totalFlour / (1 + s.inoculation / (1 + s.starterHydration));
  return s.inoculation * addedFlour;
}

/**
 * §4 — the flour pivot: the plain batch holding `totalFlour` grams of flour. Items mode sizes
 * through it; starter mode starts from the starter itself, so the starter stays exactly as given.
 */
export function batchFromFlour(totalFlour: number, s: Settings): Ingredients {
  return batchFromStarter(starterForFlour(totalFlour, s), s);
}

/** §5.2 — size a lean batch from the usable dough the items need, through the flour pivot. */
export function batchFromItems(required: number, s: Settings): Ingredients {
  if (!(required > 0) || !(s.inoculation > 0) || s.benchLoss >= 1) return emptyIngredients();
  const totalDough = required / (1 - s.benchLoss);
  const r = batchFromFlour(totalDough / (1 + s.hydration + s.salt), { ...s, benchLoss: 0 });
  return { ...r, totalDough, usableDough: required };
}

/**
 * §5.2 — the inoculation that would make a batch of `totalFlour` need exactly
 * `available` grams of starter. Algebraic: S = i·(totalFlour − S/(1+h_s)).
 */
export function inoculationForStarter(
  available: number,
  totalFlour: number,
  starterHydration: number,
): number {
  const denom = totalFlour - available / (1 + starterHydration);
  if (!(available > 0) || denom <= 0) return NaN;
  return available / denom;
}

/** What a line needs from the plan to price itself in flour (§4): settings, library, tick box. */
export interface LineContext {
  settings: Settings;
  doughs: Dough[];
  /** Decision 6; undefined reads as on. */
  weightsIncludeAdditions?: boolean;
}

/** Every line on the base dough: what `allocate` assumes when it is given no context. */
const LEAN_CONTEXT: LineContext = { settings: DEFAULT_SETTINGS, doughs: [] };

interface Line extends AllocationLine {
  minWeight: number;
  maxWeight: number;
  flexPriority: number;
  /** Planned grams per gram of flour on this line's dough, before bench loss (§4, decision 6). */
  perFlour: number;
  /**
   * Base-dough grams one planned gram costs: k_lean ÷ perFlour, exactly 1 on the base dough. The
   * allocation runs in flour (decision 8) counted in base-dough grams, so an all-lean plan
   * computes bit for bit as it did before doughs existed.
   */
  rel: number;
  /** k and k_dough of the line's dough (§4), for the per-piece split. */
  k: number;
  kDough: number;
  weightsIncludeAdditions: boolean;
}

function resolveLines(items: ItemSelection[], presets: Preset[], ctx: LineContext): Line[] {
  const lean = leanDough();
  const flat = { ...ctx.settings, benchLoss: 0 };
  const kLean = usablePerFlour(lean, flat, ctx);
  const lines: Line[] = [];
  for (const sel of items) {
    const p = presets.find((x) => x.id === sel.presetId);
    if (!p || !(sel.count > 0)) continue;
    const asked = resolveDoughId(sel, p);
    // Decision 2: a dough missing from the library keeps its own key and computes as lean.
    const found = findDough(asked, ctx.doughs);
    const d = found ?? lean;
    const isLean = d.id === LEAN_DOUGH_ID;
    const perFlour = isLean ? kLean : usablePerFlour(d, flat, ctx);
    const pinned = sel.weightOverride !== undefined && sel.weightOverride > 0;
    const baseWeight = pinned ? (sel.weightOverride as number) : p.defaultWeight;
    lines.push({
      key: lineKey(p.id, asked),
      presetId: p.id,
      name: p.name,
      icon: p.icon,
      doughId: d.id,
      doughName: found ? d.name : `Lean (dough ${asked} not found)`,
      count: Math.floor(sel.count),
      baseWeight,
      weightEach: baseWeight,
      doughEach: baseWeight,
      additionsEach: 0,
      pieceEach: baseWeight,
      subtotal: baseWeight * Math.floor(sel.count),
      adjusted: false,
      belowMin: baseWeight < p.minWeight,
      pinned,
      minWeight: p.minWeight,
      maxWeight: p.maxWeight,
      flexPriority: pinned ? 0 : p.flexPriority,
      perFlour,
      rel: isLean || !(perFlour > 0) ? 1 : kLean / perFlour,
      k: compositionFactor(d, ctx.settings),
      kDough: doughOnlyFactor(d, ctx.settings),
      weightsIncludeAdditions: ctx.weightsIncludeAdditions !== false,
    });
  }
  return lines;
}

export interface AllocationResult {
  allocation: AllocationLine[];
  spareOrShort: number;
  suggestions: string[];
}

/**
 * §5.3 and §4 — spread a batch across the selected items, flex tiers first. `usableDough` is the
 * batch's usable dough counted as base dough; each line costs its planned grams × `rel`, which is
 * the flour it needs in base-dough grams (decision 8), so the flex water-fill keeps its shape.
 * Spare or short comes back in base-dough grams. Without a context every line is on the base dough.
 */
export function allocate(
  usableDough: number,
  items: ItemSelection[],
  presets: Preset[],
  ctx: LineContext = LEAN_CONTEXT,
): AllocationResult {
  const lines = resolveLines(items, presets, ctx);
  const remaining = fill(usableDough, lines);
  const spareOrShort = Math.abs(remaining) < 0.5 ? 0 : remaining;
  return {
    allocation: settle(lines),
    spareOrShort,
    suggestions: suggest(spareOrShort, lines),
  };
}

/** The water-fill: share evenly per piece, clamp, re-share. Returns what is left, in base dough. */
function fill(budget: number, lines: Line[]): number {
  const fixedTotal = lines.reduce((sum, l) => sum + l.count * l.baseWeight * l.rel, 0);
  let remaining = budget - fixedTotal;

  const tiers = [
    ...new Set(lines.filter((l) => l.flexPriority > 0).map((l) => l.flexPriority)),
  ].sort((a, b) => b - a);

  for (const tier of tiers) {
    if (Math.abs(remaining) < EPS) break;
    const members = lines.filter((l) => l.flexPriority === tier);
    const clamped = new Set<Line>();
    // Water-fill: share evenly per piece, clamp, and re-share what the clamped
    // pieces could not take among the rest until nobody clamps.
    for (let guard = 0; guard < members.length + 1; guard++) {
      const active = members.filter((m) => !clamped.has(m));
      if (active.length === 0 || Math.abs(remaining) < EPS) break;
      const pieces = active.reduce((n, m) => n + m.count * m.rel, 0);
      const share = remaining / pieces;
      let anyClamped = false;
      for (const m of active) {
        const target = m.weightEach + share;
        const next = Math.min(m.maxWeight, Math.max(m.minWeight, target));
        remaining -= (next - m.weightEach) * m.count * m.rel;
        m.weightEach = next;
        if (Math.abs(next - target) > EPS) {
          clamped.add(m);
          anyClamped = true;
        }
      }
      if (!anyClamped) break;
    }
  }
  return remaining;
}

/** Final per-line figures, including the piece's dough and add-ins (§4, decision 6). */
function settle(lines: Line[]): AllocationLine[] {
  for (const l of lines) {
    const w = l.weightEach;
    const addIns = l.k - l.kDough;
    if (addIns > EPS && l.k > 0 && l.kDough > 0) {
      if (l.weightsIncludeAdditions) {
        l.doughEach = (w * l.kDough) / l.k;
        l.additionsEach = (w * addIns) / l.k;
        l.pieceEach = w;
      } else {
        l.doughEach = w;
        l.additionsEach = (w * addIns) / l.kDough;
        l.pieceEach = w + l.additionsEach;
      }
    } else {
      l.doughEach = w;
      l.additionsEach = 0;
      l.pieceEach = w;
    }
    l.subtotal = w * l.count;
    l.adjusted = Math.abs(w - l.baseWeight) >= 0.5;
    l.belowMin = w < l.minWeight - EPS;
  }
  return lines.map(stripLine);
}

/**
 * Spare or short is base-dough grams; a piece on another dough costs its planned grams × `rel` of
 * it (a split loaf's portion, a separate dough's flour counted as base dough).
 */
function suggest(delta: number, lines: Line[]): string[] {
  if (delta === 0 || lines.length === 0) return [];
  const g = (n: number) => `${Math.round(n)} g`;
  const cost = (l: Line) => l.baseWeight * l.rel;
  if (delta > 0) {
    const fits = lines.filter((l) => cost(l) <= delta).sort((a, b) => cost(a) - cost(b));
    const pick = fits[0];
    if (pick) {
      const label = lineLabel(pick);
      const what =
        label === pick.name
          ? `${pick.name} (${g(pick.baseWeight)})`
          : `${label} at ${g(pick.baseWeight)}`;
      return [`${g(delta)} spare. Add one more ${what} and ${g(delta - cost(pick))} is left over.`];
    }
    const smallest = [...lines].sort((a, b) => cost(a) - cost(b))[0];
    return [
      `${g(delta)} spare. Not enough for another ${smallest ? lineLabel(smallest) : "piece"}; bake it as a mini or fold it into a loaf.`,
    ];
  }
  const short = -delta;
  const fixed = lines.filter((l) => l.flexPriority === 0);
  const pool = fixed.length > 0 ? fixed : lines;
  const covers = pool.filter((l) => cost(l) >= short).sort((a, b) => cost(a) - cost(b));
  const pick = covers[0] ?? [...pool].sort((a, b) => cost(b) - cost(a))[0];
  const out = [`Short by ${g(short)}.`];
  if (pick) out.push(`Drop one ${lineLabel(pick)} to free ${g(cost(pick))}.`);
  out.push("Or switch to items mode to size the batch from the items you want.");
  return out;
}

function stripLine(l: Line): AllocationLine {
  return {
    key: l.key,
    presetId: l.presetId,
    name: l.name,
    icon: l.icon,
    doughId: l.doughId,
    doughName: l.doughName,
    count: l.count,
    baseWeight: l.baseWeight,
    weightEach: l.weightEach,
    doughEach: l.doughEach,
    additionsEach: l.additionsEach,
    pieceEach: l.pieceEach,
    subtotal: l.subtotal,
    adjusted: l.adjusted,
    belowMin: l.belowMin,
    pinned: l.pinned,
  };
}

/** What one dough's lines need (§4). */
interface Need {
  /** Σ count × weightEach: the planned grams. */
  grams: number;
  /** The flour those grams take: grams ÷ usablePerFlour. */
  flour: number;
  /** The same flour as usable base dough: grams × k_lean ÷ k; exactly the grams on lean. */
  baseDough: number;
}

/**
 * §4 — the flour each dough needs for its lines (supersedes requiredDough): Σ count × weightEach ÷
 * usablePerFlour, per dough. The grams are summed first and divided once, as the dough-grams
 * inverse did, so an all-lean plan needs exactly the flour it always did.
 */
function requiredFlour(allocation: AllocationLine[], ctx: LineContext): Map<string, Need> {
  const grams = new Map<string, number>();
  for (const l of allocation) {
    grams.set(l.doughId, (grams.get(l.doughId) ?? 0) + l.count * l.weightEach);
  }
  const keep = 1 - ctx.settings.benchLoss;
  const flat = { ...ctx.settings, benchLoss: 0 };
  const kLean = usablePerFlour(leanDough(), flat, ctx);
  const out = new Map<string, Need>();
  for (const [id, g] of grams) {
    const perFlour = usablePerFlour(findDough(id, ctx.doughs) ?? leanDough(), flat, ctx);
    const ok = keep > 0 && perFlour > 0;
    out.set(id, {
      grams: g,
      flour: ok ? g / keep / perFlour : 0,
      baseDough: id === LEAN_DOUGH_ID ? g : ok ? (g * kLean) / perFlour : 0,
    });
  }
  return out;
}

/** One dough in use: its effective method, its flour share and its starter share. */
interface Share {
  dough: Dough;
  method: EffectiveMethod;
  flour: number;
  starter: number;
}

/**
 * §4 — share the batch's flour between the doughs in use: lean first, then library order. In
 * starter mode the unallocated flour (spare or short) belongs to lean; should the other doughs
 * alone need more than the batch holds, lean gets none and they shrink in proportion. In items
 * mode every dough has exactly what its lines need. Starter follows flour (decision 7).
 */
function shareFlour(
  needs: Map<string, Need>,
  totalFlour: number,
  fromStarter: boolean,
  library: Dough[],
  starterFor: (flour: number) => number,
): Share[] {
  const others = [...needs].reduce((n, [id, x]) => (id === LEAN_DOUGH_ID ? n : n + x.flour), 0);
  const scale = fromStarter && others > totalFlour ? (totalFlour > 0 ? totalFlour / others : 0) : 1;
  const leanFlour = fromStarter
    ? Math.max(0, totalFlour - others * scale)
    : (needs.get(LEAN_DOUGH_ID)?.flour ?? 0);

  const shares: Share[] = [];
  if (needs.has(LEAN_DOUGH_ID) || leanFlour > EPS) {
    const flour = leanFlour;
    shares.push({ dough: leanDough(), method: "base", flour, starter: starterFor(flour) });
  }
  const seen = new Set<string>([LEAN_DOUGH_ID]);
  for (const d of library) {
    const need = needs.get(d.id);
    if (need === undefined || seen.has(d.id)) continue;
    seen.add(d.id);
    const flour = need.flour * scale;
    shares.push({ dough: d, method: effectiveMethod(d), flour, starter: starterFor(flour) });
  }
  return shares;
}

/** The whole plan, in one pure call (§4). `doughs` is the dough library. */
export function computePlan(plan: Plan, presets: Preset[], doughs: Dough[] = []): BatchResult {
  const s = plan.settings;
  const ctx: LineContext = {
    settings: s,
    doughs,
    weightsIncludeAdditions: plan.weightsIncludeAdditions,
  };
  let alloc: AllocationResult;
  let starter = 0;
  let totalFlour = 0;

  if (plan.mode === "starter") {
    const batch = batchFromStarter(plan.starterWeight ?? 0, s);
    alloc = allocate(batch.usableDough, plan.items, presets, ctx);
    starter = batch.starter;
    totalFlour = batch.totalFlour;
  } else {
    const allocation = settle(resolveLines(plan.items, presets, ctx));
    alloc = { allocation, spareOrShort: 0, suggestions: [] };
  }

  const fromStarter = plan.mode === "starter";
  const needs = requiredFlour(alloc.allocation, ctx);
  if (!fromStarter) totalFlour = [...needs.values()].reduce((n, x) => n + x.flour, 0);
  // Starter follows flour: a share of the starter on hand, or what that flour needs.
  const starterFor = fromStarter
    ? (flour: number) => (totalFlour > 0 ? starter * (flour / totalFlour) : 0)
    : (flour: number) => starterForFlour(flour, s);
  const shares = shareFlour(needs, totalFlour, fromStarter, doughs, starterFor);

  // The base mix pools lean and the splits: the plain formula over their flour. From the starter
  // it is whatever the separate mixes leave; from the items it is sized from the base dough its
  // lines take, as batchFromItems always sized the batch. Either way an all-lean plan gets
  // exactly the batch it always did.
  const onBase = shares.filter((x) => x.method !== "separate");
  let base: Ingredients | undefined;
  if (onBase.length > 0) {
    if (fromStarter) {
      const separate = shares.reduce((n, x) => (x.method === "separate" ? n + x.flour : n), 0);
      base = batchFromStarter(starterFor(Math.max(0, totalFlour - separate)), s);
    } else {
      const lines = onBase.reduce((n, x) => n + (needs.get(x.dough.id)?.baseDough ?? 0), 0);
      base = batchFromItems(lines, s);
    }
  }
  // The base mix is absent when its total flour is 0, and the doughs on it with it: from the items
  // when every line is on a separate dough, from the starter when the separate doughs take it all.
  if (base && !(base.totalFlour > EPS)) base = undefined;
  const { mixes, results } = perMix(shares, base, s);

  const totals = sumMixes(mixes);
  let inoculationForAvailable: number | undefined;
  if (plan.mode === "items" && plan.starterAvailable !== undefined && plan.starterAvailable > 0) {
    inoculationForAvailable = inoculationForStarter(
      plan.starterAvailable,
      totals.totalFlour,
      s.starterHydration,
    );
  }

  const partial = { ...totals, ...alloc, mixes, doughs: results, inoculationForAvailable };
  const warnings = collectWarnings(plan, presets, partial, doughs);
  return { ...partial, warnings };
}

/**
 * §4 Mixes: the base mix (lean and every split, pooled) first, then one mix per separate dough in
 * library order; and one DoughResult per dough in use, in share order. Without a base mix there is
 * no lean dough and no split.
 */
function perMix(
  shares: Share[],
  base: Ingredients | undefined,
  s: Settings,
): { mixes: MixResult[]; results: DoughResult[] } {
  const mixes: MixResult[] = [];
  const results: DoughResult[] = [];
  const splits: DoughResult[] = [];
  for (const share of shares) {
    if (share.method === "base" || (share.method === "split" && !base)) continue;
    const built = perDough(share, s);
    results.push(built.result);
    if (built.mix) mixes.push(built.mix);
    else splits.push(built.result);
  }
  if (base) {
    const onBase = shares.filter((x) => x.method !== "separate");
    mixes.unshift({
      ...base,
      id: "base",
      label: "Main dough",
      doughIds: onBase.map((x) => x.dough.id),
      additions: [],
      mixMinutes: 10,
    });
    const lean = shares.find((x) => x.method === "base");
    if (lean) results.unshift(leanResult(lean, base, splits, s));
  }
  return { mixes, results };
}

/**
 * Lean is the base mix less the portions its splits take out, so with no split it is the base
 * mix to the last bit: the figures an all-lean plan always showed.
 */
function leanResult(
  share: Share,
  base: Ingredients,
  splits: DoughResult[],
  s: Settings,
): DoughResult {
  const less = (pick: (d: DoughResult) => number) => splits.reduce((n, d) => n + pick(d), 0);
  const keep = 1 - s.benchLoss;
  const d = share.dough;
  return {
    doughId: d.id,
    name: d.name,
    icon: d.icon,
    method: "base",
    mixId: "base",
    flour: base.totalFlour - less((x) => x.flour),
    water: base.totalWater - less((x) => s.hydration * x.flour),
    starter: base.starter - less((x) => x.starter),
    salt: base.salt - less((x) => x.salt),
    addedFlour: 0,
    addedWater: 0,
    additions: [],
    additionsTotal: 0,
    mass: base.totalDough - less((x) => x.portion ?? 0),
    usable: base.usableDough - less((x) => (x.portion ?? 0) * keep),
    trueHydration: base.trueHydration,
    bulkFactor: bulkFactorFor(d),
    reason: reasonFor(d, "base"),
    notes: d.notes,
  };
}

/** §4 Per dough: what a split or separate dough holds, and a separate dough's mix as weighed. */
function perDough(share: Share, s: Settings): { result: DoughResult; mix?: MixResult } {
  const { dough: d, method, flour: F, starter } = share;
  const keep = 1 - s.benchLoss;
  const common = {
    doughId: d.id,
    name: d.name,
    icon: d.icon,
    method,
    bulkFactor: bulkFactorFor(d),
    reason: reasonFor(d, method),
    notes: d.notes,
  };

  if (method === "split") {
    // Decision 9: a portion of the base dough, at the base hydration and salt, with its
    // additions worked in at the split. Their water stays in, as k_split counts it (§4), so the
    // mass is F·k.
    const additions = additionLines(d, F, true);
    const additionsTotal = sumGrams(additions);
    const portion = F * (1 + s.hydration + s.salt);
    const water = s.hydration * F + F * enrichmentWater(d);
    const mass = portion + additionsTotal;
    const result: DoughResult = {
      ...common,
      mixId: "base",
      flour: F,
      water,
      starter,
      salt: s.salt * F,
      addedFlour: 0,
      addedWater: 0,
      additions,
      additionsTotal,
      mass,
      usable: mass * keep,
      portion,
      trueHydration: F > 0 ? water / F : 0,
    };
    return { result };
  }

  // Separate: the plain formula at the dough's own hydration and salt, less the water its
  // enrichments carry (decision 5), clamped at 0; then the tangzhong moves inside the mix.
  const plain = batchFromStarter(starter, {
    ...s,
    hydration: doughHydration(d, s),
    salt: doughSalt(d, s),
  });
  const flour = plain.totalFlour;
  const enrichWater = flour * enrichmentWater(d);
  const wantWater = plain.addedWater - enrichWater;
  const addedWater = Math.max(0, wantWater);
  const water = wantWater >= 0 ? plain.totalWater : plain.starterWater + enrichWater;
  const additions = additionLines(d, flour, false);
  const additionsTotal = sumGrams(additions);
  // The lines as weighed; once the water clamps this is heavier than F·k by the shortfall.
  const mass = plain.addedFlour + addedWater + plain.starter + plain.salt + additionsTotal;
  const trueHydration = flour > 0 ? water / flour : 0;
  const result: DoughResult = {
    ...common,
    mixId: d.id,
    flour,
    water,
    starter: plain.starter,
    salt: plain.salt,
    addedFlour: plain.addedFlour,
    addedWater,
    additions,
    additionsTotal,
    mass,
    usable: mass * keep,
    trueHydration,
  };
  const weighed = tangzhong(d, flour, plain.addedFlour, addedWater, additions);
  const mix: MixResult = {
    addedFlour: weighed.addedFlour,
    addedWater: weighed.addedWater,
    starter: plain.starter,
    starterFlour: plain.starterFlour,
    starterWater: plain.starterWater,
    salt: plain.salt,
    totalFlour: flour,
    totalWater: water,
    totalDough: mass,
    usableDough: mass * keep,
    trueHydration,
    id: d.id,
    label: d.name,
    doughIds: [d.id],
    additions: weighed.additions,
    mixMinutes: d.enrichments.some((e) => positive(e.pct) > 0) ? 20 : 10,
  };
  return { result, mix };
}

/** §4, verbatim: the note both tangzhong lines carry. */
const TANGZHONG_NOTE =
  "Cook to 65 °C, stirring, to a thick paste that holds a line. Cool to room temperature before it goes in. Made the day before and kept in the fridge is fine: bring it back to room temperature.";

/**
 * §4 tangzhong (decision 20): its flour comes out of the flour line; its liquid out of the milk
 * when the milk covers it, else out of the water line, one liquid and never a blend, clamped to
 * what the water line holds (`tangzhong-liquid-short` reports that). The mix totals do not move.
 * Returns the flour and water as weighed and the addition lines with the paste first.
 */
function tangzhong(
  d: Dough,
  flour: number,
  addedFlour: number,
  addedWater: number,
  lines: AdditionLine[],
): { addedFlour: number; addedWater: number; additions: AdditionLine[] } {
  const tz = d.tangzhong;
  if (!tz || positive(tz.flourPct) === 0 || positive(tz.ratio) === 0 || !(flour > 0)) {
    return { addedFlour, addedWater, additions: lines };
  }
  const tzFlour = Math.min(addedFlour, tz.flourPct * flour);
  const wanted = tz.ratio * tzFlour;
  const milk = sumGrams(lines.filter((a) => a.kind === "milk"));
  let rest = lines;
  let liquid: number;
  let water = addedWater;
  const fromMilk = milk > 0 && milk >= wanted;
  if (fromMilk) {
    let need = wanted;
    rest = lines.map((a) => {
      if (a.kind !== "milk" || need <= 0) return a;
      const take = Math.min(a.grams, need);
      need -= take;
      const grams = a.grams - take;
      return { ...a, grams, pct: grams / flour };
    });
    liquid = wanted;
  } else {
    liquid = Math.min(wanted, addedWater);
    water = addedWater - liquid;
  }
  return {
    addedFlour: addedFlour - tzFlour,
    addedWater: water,
    additions: [
      {
        kind: "tangzhong-flour",
        label: "Tangzhong flour",
        pct: tzFlour / flour,
        grams: tzFlour,
        addAt: "mix",
        note: TANGZHONG_NOTE,
      },
      {
        kind: "tangzhong-liquid",
        label: fromMilk ? "Tangzhong milk" : "Tangzhong water",
        pct: liquid / flour,
        grams: liquid,
        addAt: "mix",
        note: TANGZHONG_NOTE,
      },
      ...rest,
    ],
  };
}

/**
 * A dough's addition lines at `flour` grams of flour (§4): its enrichments, its sweetness, its
 * inclusions and their soaker water. In a split everything goes in at the split, except
 * inclusions added at shaping (decision 11).
 */
function additionLines(d: Dough, flour: number, split: boolean): AdditionLine[] {
  const out: AdditionLine[] = [];
  const push = (line: Omit<AdditionLine, "grams">) => {
    out.push({ ...line, grams: line.pct * flour });
  };
  for (const e of d.enrichments) {
    if (positive(e.pct) === 0) continue;
    push({
      kind: e.kind,
      label: ENRICHMENTS[e.kind]?.label ?? e.kind,
      pct: e.pct,
      addAt: split ? "split" : enrichmentAddAt(e),
    });
  }
  const sw = d.sweetness;
  if (sw && positive(sw.pct) > 0) {
    push({
      kind: sw.kind,
      label: SWEETENERS[sw.kind]?.label ?? sw.kind,
      pct: sw.pct,
      addAt: split ? "split" : "mix",
    });
  }
  for (const x of d.inclusions) {
    const own = inclusionAddAt(x);
    const addAt = split && own !== "shape" ? "split" : own;
    const kindLabel = INCLUSIONS[x.kind]?.label ?? x.kind;
    if (positive(x.pct) > 0) {
      const note = x.note || INCLUSIONS[x.kind]?.note;
      push({
        kind: x.kind,
        label: x.name.trim() || kindLabel,
        pct: x.pct,
        addAt,
        ...(note && { note }),
      });
    }
    const soaker = positive(x.soakerWaterPct);
    if (soaker > 0) {
      const what = x.name.replace(/\s*\(.*\)\s*$/, "").trim() || kindLabel;
      push({
        kind: "soaker-water",
        label: `Soaker water (${what.toLowerCase()})`,
        pct: soaker,
        addAt,
      });
    }
  }
  return out;
}

const SPLIT_AT: Record<SplitAt, string> = {
  mix: "the end of the mix",
  fold1: "fold 1",
  fold2: "fold 2",
};

/** The one-line why under a dough's heading: "Mixed separately: …", "Split off at fold 1: …". */
function reasonFor(d: Dough, method: EffectiveMethod): string {
  if (method === "base") return "The main dough: the batch settings, nothing added.";
  if (method === "split") {
    const what = [
      ...d.enrichments
        .filter((e) => positive(e.pct) > 0)
        .map((e) => (ENRICHMENTS[e.kind]?.label ?? e.kind).toLowerCase()),
      ...(d.sweetness && positive(d.sweetness.pct) > 0
        ? [(SWEETENERS[d.sweetness.kind]?.label ?? d.sweetness.kind).toLowerCase()]
        : []),
      ...d.inclusions
        .filter((x) => positive(x.pct) > 0)
        .map((x) => (INCLUSIONS[x.kind]?.label ?? x.kind).toLowerCase()),
    ];
    const worked = what.length > 0 ? `${joinAnd([...new Set(what)])} worked into ` : "";
    return `Split off at ${SPLIT_AT[splitAtFor(d)] ?? "fold 1"}: ${worked}a portion of the main dough.`;
  }
  const reasons = separateReasons(d);
  const own = reasons.filter((r) => r.startsWith("own ")).map((r) => r.slice(4));
  const liquids = reasons.filter((r) => !r.startsWith("own ") && r !== "tangzhong");
  const clauses: string[] = [];
  if (liquids.length > 0) {
    clauses.push(
      `${joinAnd(liquids)} ${liquids.length === 1 ? "has" : "have"} to go in with the water`,
    );
  }
  if (reasons.includes("tangzhong")) clauses.push("the tangzhong goes in with the liquids");
  if (own.length > 0) clauses.push(`it has its own ${joinAnd(own)}`);
  return clauses.length > 0
    ? `Mixed separately: ${clauses.join("; ")}.`
    : "Mixed separately, as set.";
}

/** The batch's Ingredients: sums over the mixes (one mix gives its own values back exactly). */
function sumMixes(mixes: MixResult[]): Ingredients {
  const t = emptyIngredients();
  for (const m of mixes) {
    t.addedFlour += m.addedFlour;
    t.addedWater += m.addedWater;
    t.starter += m.starter;
    t.starterFlour += m.starterFlour;
    t.starterWater += m.starterWater;
    t.salt += m.salt;
    t.totalFlour += m.totalFlour;
    t.totalWater += m.totalWater;
    t.totalDough += m.totalDough;
    t.usableDough += m.usableDough;
  }
  t.trueHydration = t.totalFlour > 0 ? t.totalWater / t.totalFlour : 0;
  return t;
}

const sumGrams = (lines: AdditionLine[]) => lines.reduce((n, a) => n + a.grams, 0);

function emptyIngredients(): Ingredients {
  return {
    addedFlour: 0,
    addedWater: 0,
    starter: 0,
    starterFlour: 0,
    starterWater: 0,
    salt: 0,
    totalFlour: 0,
    totalWater: 0,
    totalDough: 0,
    usableDough: 0,
    trueHydration: 0,
  };
}
