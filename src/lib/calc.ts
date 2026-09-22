import type {
  AllocationLine,
  BatchResult,
  Ingredients,
  ItemSelection,
  Plan,
  Preset,
  Settings,
} from "./types";
import { collectWarnings } from "./warnings";

const EPS = 1e-9;

/** §5.1 — size the batch from the starter on hand. Unrounded. */
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

/** §5.2 — size the batch from the dough the items need. Unrounded. */
export function batchFromItems(required: number, s: Settings): Ingredients {
  if (!(required > 0) || !(s.inoculation > 0) || s.benchLoss >= 1) return emptyIngredients();
  const totalDough = required / (1 - s.benchLoss);
  const totalFlour = totalDough / (1 + s.hydration + s.salt);
  const addedFlour = totalFlour / (1 + s.inoculation / (1 + s.starterHydration));
  const S = s.inoculation * addedFlour;
  const r = batchFromStarter(S, { ...s, benchLoss: 0 });
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

export function requiredDough(items: ItemSelection[], presets: Preset[]): number {
  return resolveLines(items, presets).reduce((sum, l) => sum + l.count * l.baseWeight, 0);
}

interface Line extends AllocationLine {
  minWeight: number;
  maxWeight: number;
  flexPriority: number;
}

function resolveLines(items: ItemSelection[], presets: Preset[]): Line[] {
  const lines: Line[] = [];
  for (const sel of items) {
    const p = presets.find((x) => x.id === sel.presetId);
    if (!p || !(sel.count > 0)) continue;
    const pinned = sel.weightOverride !== undefined && sel.weightOverride > 0;
    const baseWeight = pinned ? (sel.weightOverride as number) : p.defaultWeight;
    lines.push({
      presetId: p.id,
      name: p.name,
      icon: p.icon,
      count: Math.floor(sel.count),
      baseWeight,
      weightEach: baseWeight,
      subtotal: baseWeight * Math.floor(sel.count),
      adjusted: false,
      belowMin: baseWeight < p.minWeight,
      pinned,
      minWeight: p.minWeight,
      maxWeight: p.maxWeight,
      flexPriority: pinned ? 0 : p.flexPriority,
    });
  }
  return lines;
}

export interface AllocationResult {
  allocation: AllocationLine[];
  spareOrShort: number;
  suggestions: string[];
}

/** §5.3 — spread usable dough across the selected items, flex tiers first. */
export function allocate(
  usableDough: number,
  items: ItemSelection[],
  presets: Preset[],
): AllocationResult {
  const lines = resolveLines(items, presets);
  const fixedTotal = lines.reduce((sum, l) => sum + l.count * l.baseWeight, 0);
  let remaining = usableDough - fixedTotal;

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
      const pieces = active.reduce((n, m) => n + m.count, 0);
      const share = remaining / pieces;
      let anyClamped = false;
      for (const m of active) {
        const target = m.weightEach + share;
        const next = Math.min(m.maxWeight, Math.max(m.minWeight, target));
        remaining -= (next - m.weightEach) * m.count;
        m.weightEach = next;
        if (Math.abs(next - target) > EPS) {
          clamped.add(m);
          anyClamped = true;
        }
      }
      if (!anyClamped) break;
    }
  }

  for (const l of lines) {
    l.subtotal = l.weightEach * l.count;
    l.adjusted = Math.abs(l.weightEach - l.baseWeight) >= 0.5;
    l.belowMin = l.weightEach < l.minWeight - EPS;
  }

  const spareOrShort = Math.abs(remaining) < 0.5 ? 0 : remaining;
  return {
    allocation: lines.map(stripLine),
    spareOrShort,
    suggestions: suggest(spareOrShort, lines),
  };
}

function suggest(delta: number, lines: Line[]): string[] {
  if (delta === 0 || lines.length === 0) return [];
  const g = (n: number) => `${Math.round(n)} g`;
  if (delta > 0) {
    const fits = lines
      .filter((l) => l.baseWeight <= delta)
      .sort((a, b) => a.baseWeight - b.baseWeight);
    const pick = fits[0];
    if (pick) {
      return [
        `${g(delta)} spare. Add one more ${pick.name} (${g(pick.baseWeight)}) and ${g(delta - pick.baseWeight)} is left over.`,
      ];
    }
    const smallest = [...lines].sort((a, b) => a.baseWeight - b.baseWeight)[0];
    return [
      `${g(delta)} spare. Not enough for another ${smallest?.name ?? "piece"}; bake it as a mini or fold it into a loaf.`,
    ];
  }
  const short = -delta;
  const fixed = lines.filter((l) => l.flexPriority === 0);
  const pool = fixed.length > 0 ? fixed : lines;
  const covers = pool
    .filter((l) => l.baseWeight >= short)
    .sort((a, b) => a.baseWeight - b.baseWeight);
  const pick = covers[0] ?? [...pool].sort((a, b) => b.baseWeight - a.baseWeight)[0];
  const out = [`Short by ${g(short)}.`];
  if (pick) out.push(`Drop one ${pick.name} to free ${g(pick.baseWeight)}.`);
  out.push("Or switch to items mode to size the batch from the items you want.");
  return out;
}

function stripLine(l: Line): AllocationLine {
  return {
    presetId: l.presetId,
    name: l.name,
    icon: l.icon,
    count: l.count,
    baseWeight: l.baseWeight,
    weightEach: l.weightEach,
    subtotal: l.subtotal,
    adjusted: l.adjusted,
    belowMin: l.belowMin,
    pinned: l.pinned,
  };
}

/** The whole plan, in one pure call. */
export function computePlan(plan: Plan, presets: Preset[]): BatchResult {
  const s = plan.settings;
  let ingredients: Ingredients;
  let alloc: AllocationResult;
  let inoculationForAvailable: number | undefined;

  if (plan.mode === "starter") {
    ingredients = batchFromStarter(plan.starterWeight ?? 0, s);
    alloc = allocate(ingredients.usableDough, plan.items, presets);
  } else {
    const required = requiredDough(plan.items, presets);
    ingredients = batchFromItems(required, s);
    const lines = resolveLines(plan.items, presets).map(stripLine);
    alloc = { allocation: lines, spareOrShort: 0, suggestions: [] };
    if (plan.starterAvailable !== undefined && plan.starterAvailable > 0) {
      inoculationForAvailable = inoculationForStarter(
        plan.starterAvailable,
        ingredients.totalFlour,
        s.starterHydration,
      );
    }
  }

  const partial = { ...ingredients, ...alloc, inoculationForAvailable };
  const warnings = collectWarnings(plan, presets, partial);
  return { ...partial, warnings };
}

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
