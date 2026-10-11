import {
  ENRICHMENTS,
  INCLUSIONS,
  SWEETENERS,
  WATER_FRACTION,
  doughHydration,
  doughSalt,
  findDough,
  leanDough,
  positive,
  resolveDoughId,
  separateReasons,
  sugarEquivalent,
} from "./doughs";
import { joinAnd, lineLabel } from "./format";
import {
  LEAN_DOUGH_ID,
  type AllocationLine,
  type Dough,
  type DoughResult,
  type Ingredients,
  type MixResult,
  type Plan,
  type PlanWarning,
  type Preset,
} from "./types";

/** What the warnings read: a BatchResult before its warnings. */
export interface WarningInput extends Ingredients {
  allocation: AllocationLine[];
  mixes: MixResult[];
  doughs: DoughResult[];
  spareOrShort: number;
  inoculationForAvailable?: number;
}

const EPS = 1e-9;
/** Below this many grams a clamp is rounding, not news. */
const NOISE_G = 0.5;

const pct = (f: number) => `${Math.round(f * 1000) / 10}%`;
const g = (n: number) => `${Math.round(n)} g`;

/**
 * §8 and PLAN-doughs §7 — soft validation. Never blocks; the plan still computes. `library` is
 * the dough library the plan was computed with.
 */
export function collectWarnings(
  plan: Plan,
  presets: Preset[],
  r: WarningInput,
  library: Dough[],
): PlanWarning[] {
  const out: PlanWarning[] = [];
  const s = plan.settings;
  const inUse = r.doughs.map((res) => ({
    res,
    dough: findDough(res.doughId, library) ?? leanDough(),
  }));

  // Hydration sensitivity is per dough: each dough's true hydration against its own lines.
  for (const { res } of inUse) {
    const sensitive = r.allocation.filter(
      (l) =>
        l.doughId === res.doughId && presets.find((p) => p.id === l.presetId)?.hydrationSensitive,
    );
    if (res.trueHydration > 0.8 && sensitive.length > 0) {
      const names = [...new Set(sensitive.map((l) => l.name.toLowerCase()))].join(" and ");
      const where = res.doughId === LEAN_DOUGH_ID ? "" : ` in ${res.name}`;
      out.push({
        level: "warn",
        code: "high-hydration",
        message: `High hydration${where} (${pct(res.trueHydration)}) — ${names} will be slack to shape.`,
      });
    }
  }

  if (s.inoculation < 0.1 || s.inoculation > 0.35) {
    out.push({
      level: "warn",
      code: "inoculation-range",
      message: `Inoculation ${pct(s.inoculation)} is outside the typical 10–35% range.`,
    });
  }

  // The batch salt, unless every dough in use has its own; then each separate dough's own salt.
  const ownSalt = ({ res, dough }: (typeof inUse)[number]) =>
    res.method === "separate" && dough.salt !== undefined;
  const outsideSalt = (f: number) => f < 0.018 || f > 0.025;
  if ((inUse.length === 0 || !inUse.every(ownSalt)) && outsideSalt(s.salt)) {
    out.push({
      level: "info",
      code: "salt-range",
      message: `Salt ${pct(s.salt)} is outside the usual 1.8–2.5%.`,
    });
  }
  for (const entry of inUse) {
    const salt = doughSalt(entry.dough, s);
    if (ownSalt(entry) && outsideSalt(salt)) {
      out.push({
        level: "info",
        code: "salt-range",
        message: `Salt ${pct(salt)} in ${entry.res.name} is outside the usual 1.8–2.5%.`,
      });
    }
  }

  for (const l of r.allocation) {
    if (l.belowMin) {
      const p = presets.find((x) => x.id === l.presetId);
      out.push({
        level: "warn",
        code: "below-min",
        message: `${lineLabel(l)} at ${Math.round(l.weightEach)} g is below its ${p?.minWeight ?? "?"} g minimum. Drop a piece, unpin it, or lower the minimum in presets.`,
      });
    }
  }

  if (plan.mode === "starter" && r.spareOrShort < 0) {
    out.push({
      level: "warn",
      code: "short",
      message: `Not enough dough: short by ${Math.round(-r.spareOrShort)} g of main dough after every flex item hit its minimum.`,
    });
  }

  if (
    plan.mode === "items" &&
    plan.starterAvailable !== undefined &&
    plan.starterAvailable > 0 &&
    r.starter > plan.starterAvailable + 0.5
  ) {
    const alt = r.inoculationForAvailable;
    const remedy =
      alt !== undefined && Number.isFinite(alt) && alt > 0
        ? ` Drop inoculation to ${pct(alt)} to use what you have; a lower inoculation lengthens bulk fermentation.`
        : "";
    out.push({
      level: "warn",
      code: "starter-short",
      message: `This batch needs ${Math.round(r.starter)} g starter but only ${Math.round(plan.starterAvailable)} g is available.${remedy}`,
    });
  }

  out.push(...unknownDoughs(plan, presets, library));
  for (const entry of inUse) out.push(...doughWarnings(entry.dough, entry.res, r.mixes, s));
  for (const entry of inUse) out.push(...doughNotes(entry.dough, entry.res, plan));
  return out;
}

/** Decision 2: a line whose dough is not in the library computes as lean; say which and why. */
function unknownDoughs(plan: Plan, presets: Preset[], library: Dough[]): PlanWarning[] {
  const missing = new Map<string, string[]>();
  for (const sel of plan.items) {
    const p = presets.find((x) => x.id === sel.presetId);
    if (!p || !(sel.count > 0)) continue;
    const id = resolveDoughId(sel, p);
    if (findDough(id, library)) continue;
    const names = missing.get(id) ?? [];
    if (!names.includes(p.name)) names.push(p.name);
    missing.set(id, names);
  }
  return [...missing].map(([id, names]) => ({
    level: "warn",
    code: "unknown-dough",
    message: `Dough "${id}" is not in the dough library (deleted, or saved in another browser), so ${joinAnd(names)} ${names.length === 1 ? "is" : "are"} planned on the main dough. Pick a dough for ${names.length === 1 ? "it" : "them"} in Items, or add it back on the Presets page.`,
  }));
}

/** The warn-level checks on one dough in use: its method, its water and its tangzhong. */
function doughWarnings(
  d: Dough,
  res: DoughResult,
  mixes: MixResult[],
  s: Plan["settings"],
): PlanWarning[] {
  const out: PlanWarning[] = [];

  // Decision 3: a forced split still computes, but say what it cannot carry.
  const reasons = res.method === "split" ? separateReasons(d) : [];
  if (reasons.length > 0) {
    const own = reasons.filter((x) => x.startsWith("own ")).map((x) => x.slice(4));
    const liquids = reasons.filter((x) => !x.startsWith("own ") && x !== "tangzhong");
    const clauses: string[] = [];
    if (liquids.length > 0) {
      clauses.push(
        `${joinAnd(liquids)} ${liquids.length === 1 ? "has" : "have"} to go in with the water at the mix`,
      );
    }
    if (reasons.includes("tangzhong")) {
      clauses.push("a tangzhong goes in with the liquids at the mix");
    }
    if (own.length > 0) {
      clauses.push(
        `its own ${joinAnd(own)} ${own.length === 1 ? "needs" : "need"} a mix of its own`,
      );
    }
    out.push({
      level: "warn",
      code: "split-needs-mix",
      message: `${res.name} is set to split off the main dough, but ${clauses.join(", and ")}. Set its method to auto or separate to give it a mix of its own.`,
    });
  }

  // Decision 5: the liquids alone outrun the hydration, so the water line clamped at 0.
  if (res.method === "separate" && res.flour > 0) {
    const target = doughHydration(d, s);
    const extra = res.water - target * res.flour;
    if (extra > NOISE_G) {
      const wet = [...d.enrichments, ...(d.sweetness ? [d.sweetness] : [])]
        .filter((e) => positive(e.pct) > 0 && (WATER_FRACTION[e.kind] ?? 0) > 0)
        .sort(
          (a, b) => b.pct * (WATER_FRACTION[b.kind] ?? 0) - a.pct * (WATER_FRACTION[a.kind] ?? 0),
        );
      const label = (kind: string) => (LABELS[kind] ?? kind).toLowerCase();
      const labels = ["starter", ...new Set(wet.map((e) => label(e.kind)))];
      const most = wet[0] ? label(wet[0].kind) : "liquid";
      out.push({
        level: "warn",
        code: "liquid-exceeds-hydration",
        message: `${res.name}: the water in the ${joinAnd(labels)} alone makes ${pct(res.trueHydration)} true hydration, above its ${pct(target)}. There is no water to add, and the dough comes out ${g(extra)} heavier than planned. Raise its hydration to ${pct(res.trueHydration)} or use less ${most}.`,
      });
    }
  }

  // §4 tangzhong: the water line could not cover the paste's liquid, so the line was clamped.
  const mix = res.method === "separate" ? mixes.find((m) => m.id === res.mixId) : undefined;
  const tzFlour = mix?.additions.find((a) => a.kind === "tangzhong-flour");
  const tzLiquid = mix?.additions.find((a) => a.kind === "tangzhong-liquid");
  if (d.tangzhong && tzFlour && tzLiquid) {
    const wanted = d.tangzhong.ratio * tzFlour.grams;
    if (wanted - tzLiquid.grams > NOISE_G) {
      out.push({
        level: "warn",
        code: "tangzhong-liquid-short",
        message: `${res.name}: the tangzhong wants ${g(wanted)} of liquid, but the water line holds only ${g(tzLiquid.grams)} and the milk does not cover it, so it is made with ${g(tzLiquid.grams)} and comes out stiffer. Use less tangzhong flour or a lower ratio, or raise the hydration.`,
      });
    }
  }
  return out;
}

/** The info-level notes on one dough in use: add-ins, sweetness and butter. */
function doughNotes(d: Dough, res: DoughResult, plan: Plan): PlanWarning[] {
  const out: PlanWarning[] = [];
  const info = (code: string, message: string) => out.push({ level: "info", code, message });
  const inclusions = d.inclusions.filter((x) => positive(x.pct) > 0);

  const load = inclusions.reduce((n, x) => n + x.pct, 0);
  if (load > 0.35 + EPS) {
    info(
      "inclusion-load",
      `${res.name} carries ${pct(load)} add-ins. Most inclusion loaves run 20–33%; heavier loads hold the rise back and are hard to work in.`,
    );
  }

  const salty = inclusions.filter((x) => INCLUSIONS[x.kind]?.flags.includes("salty"));
  const saltyLoad = salty.reduce((n, x) => n + x.pct, 0);
  if (saltyLoad >= 0.15 - EPS) {
    const names = [
      ...new Set(
        salty.map((x) => (x.name?.trim() || INCLUSIONS[x.kind]?.label || x.kind).toLowerCase()),
      ),
    ];
    const shared = res.method === "split" ? " A split dough shares the main dough's salt." : "";
    info(
      "salty-inclusions",
      `${res.name}: ${pct(saltyLoad)} salty add-ins (${joinAnd(names)}). Some bakers drop the salt to 1.6–1.8% to make up for them.${shared}`,
    );
  }

  const sugarEq = sugarEquivalent(d);
  if (sugarEq > 0.12 + EPS) {
    info(
      "sugar-high",
      `${res.name}: ${pct(sugarEq)} sugar-equivalent. Expect a slow bulk; a sweet or stiff levain helps.`,
    );
  }

  const sw = d.sweetness;
  if (sw && positive(sw.pct) > 0) {
    if (sw.kind === "erythritol" && sw.pct > 0.04 + EPS) {
      info(
        "erythritol-fit",
        `${res.name}: ${pct(sw.pct)} erythritol is more than the 4% it suits. Expect it pale and drier; no browning or softness from erythritol.`,
      );
    }
    if (sw.kind === "xylitol") {
      info(
        "xylitol-dogs",
        `${res.name} has xylitol, which is poisonous to dogs: keep the bread and the crumbs out of their reach.`,
      );
    }
    if (sw.kind === "high-intensity") {
      info(
        "sweetener-label",
        `${res.name}: check the bulking agent on the sweetener's label. "Cup-for-cup" blends are mostly dextrose or maltodextrin, which is sugar: it ferments and browns.`,
      );
    }
  }

  const butter = d.enrichments
    .filter((e) => e.kind === "butter" && positive(e.pct) > 0)
    .reduce((n, e) => n + e.pct, 0);
  if (butter > 0.3 + EPS && !plan.standMixer) {
    info(
      "butter-by-hand",
      `${res.name}: ${pct(butter)} butter is a long job by hand. Work it in cold, in pieces, over several sets of folds, or use a stand mixer.`,
    );
  }
  return out;
}

/** What an enrichment or a sweetener is called: "Milk", "Honey or syrup". */
const LABELS: Record<string, string> = Object.fromEntries(
  [...Object.values(ENRICHMENTS), ...Object.values(SWEETENERS)].map((x) => [x.kind, x.label]),
);
