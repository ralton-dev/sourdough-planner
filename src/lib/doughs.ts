import {
  LEAN_DOUGH_ID,
  type Dough,
  type Enrichment,
  type EnrichmentAddAt,
  type EnrichmentKind,
  type Inclusion,
  type InclusionAddAt,
  type InclusionKind,
  type ItemSelection,
  type Plan,
  type Preset,
  type Settings,
  type SplitAt,
  type SweetKind,
} from "./types";

const EPS = 1e-9;

/**
 * The water each enrichment or sweetener carries, as a fraction of its own weight (R2, R4).
 * That water counts towards true hydration; the rest of its weight is dough (decision 5).
 */
export const WATER_FRACTION: Record<EnrichmentKind | SweetKind, number> = {
  butter: 0.16,
  oil: 0,
  egg: 0.76,
  yolk: 0.52,
  milk: 0.88,
  sugar: 0,
  honey: 0.17,
  xylitol: 0,
  erythritol: 0,
  maltitol: 0,
  "high-intensity": 0,
};

/** A typical range as fractions of flour. A lower bound of 0 reads as "up to". */
export type Range = readonly [number, number];

export interface EnrichmentInfo {
  kind: EnrichmentKind;
  label: string;
  typical: Range;
  /** Default add-at. Butter moves to after the mix above `afterMixAbove` (decision 11). */
  addAt: EnrichmentAddAt;
  afterMixAbove?: number;
  /** The one-line effect shown under the field. */
  hint: string;
}

/** §6, R2. */
export const ENRICHMENTS: Record<EnrichmentKind, EnrichmentInfo> = {
  butter: {
    kind: "butter",
    label: "Butter",
    typical: [0.05, 0.2],
    addAt: "mix",
    afterMixAbove: 0.1,
    hint: "Tender crumb, softer crust, keeps longer. Above 10 % it goes in after the gluten is built.",
  },
  oil: {
    kind: "oil",
    label: "Oil",
    typical: [0.02, 0.1],
    addAt: "mix",
    hint: "Softer crumb, keeps longer, little flavour. Above 10 % it behaves like extra water.",
  },
  egg: {
    kind: "egg",
    label: "Egg",
    typical: [0.1, 0.3],
    addAt: "mix",
    hint: "Richer, softer, more volume, browns faster. Goes in with the liquid, always.",
  },
  yolk: {
    kind: "yolk",
    label: "Egg yolk",
    typical: [0.05, 0.15],
    addAt: "mix",
    hint: "Richer and more tender than whole egg.",
  },
  milk: {
    kind: "milk",
    label: "Milk",
    typical: [0.2, 0.6],
    addAt: "mix",
    hint: "Softer crust, finer crumb, browner. Counts as 88 % water.",
  },
};

/** Decision 23: sweetness is none, sugar (sugar, honey or syrup) or a sweetener. */
export type SweetChoice = "none" | "sugar" | "sweetener";

export interface SweetenerInfo {
  kind: SweetKind;
  label: string;
  choice: Exclude<SweetChoice, "none">;
  /** Sweetness relative to sugar. */
  sweetness: Range;
  /** Weight on the bulk factor's sugar term (decision 10). */
  osmoticFactor: number;
  browns: "yes" | "fast" | "no";
  softens: boolean;
  typical: Range;
  /** The editor shows this amount as g per 100 g flour, two decimals; it is stored as a fraction. */
  perHundredGrams?: true;
  hint: string;
}

/** The "no sugar" choice: the default for every seeded dough (decision 23). */
export const NO_SUGAR = {
  label: "No sugar",
  hint: "Colour comes from the milk and the wash; softness from butter, egg, milk or a tangzhong. Ferments like a lean dough; bake to 88–93 °C inside, not to colour. A young levain keeps it mild.",
} as const;

/** §6, R4. Allulose is deliberately absent: not authorised for sale in the EU or UK. */
export const SWEETENERS: Record<SweetKind, SweetenerInfo> = {
  sugar: {
    kind: "sugar",
    label: "Sugar",
    choice: "sugar",
    sweetness: [1, 1],
    osmoticFactor: 1,
    browns: "yes",
    softens: true,
    typical: [0.03, 0.1],
    hint: "Softer, browns faster. Slows the rise from about 5 %; a lot above 10 %.",
  },
  honey: {
    kind: "honey",
    label: "Honey or syrup",
    choice: "sugar",
    sweetness: [1, 1],
    osmoticFactor: 0.8,
    browns: "fast",
    softens: true,
    typical: [0.03, 0.1],
    hint: "Honey, maple or date syrup: still sugar, and browns faster than sugar. 17 % water.",
  },
  xylitol: {
    kind: "xylitol",
    label: "Xylitol",
    choice: "sweetener",
    sweetness: [1, 1],
    osmoticFactor: 1.2,
    browns: "no",
    softens: true,
    typical: [0, 0.05],
    hint: "As sweet as sugar, moist crumb, no browning: rely on the wash. Poisonous to dogs. Laxative above ~20 g.",
  },
  erythritol: {
    kind: "erythritol",
    label: "Erythritol",
    choice: "sweetener",
    sweetness: [0.7, 0.7],
    osmoticFactor: 1.5,
    browns: "no",
    softens: false,
    typical: [0, 0.04],
    hint: "Swerve, Lakanto and Truvia are erythritol. No browning, no softness, a cooling taste, can go gritty, and the strongest drag on the rise per gram.",
  },
  maltitol: {
    kind: "maltitol",
    label: "Maltitol",
    choice: "sweetener",
    sweetness: [0.9, 0.9],
    osmoticFactor: 0.5,
    browns: "no",
    softens: true,
    typical: [0.02, 0.06],
    hint: "Softens and slows staling; pale crust. Laxative above ~60 g.",
  },
  "high-intensity": {
    kind: "high-intensity",
    label: "High-intensity sweetener",
    choice: "sweetener",
    sweetness: [200, 600],
    osmoticFactor: 0,
    browns: "no",
    softens: false,
    typical: [0.0002, 0.0003],
    perHundredGrams: true,
    hint: 'Pure stevia, monk fruit or sucralose: sweetness only, nothing else changes. Check the label: "cup-for-cup" blends are mostly dextrose or maltodextrin, which is sugar. Avoid sucralose in baking.',
  },
};

export type InclusionFlag = "salty" | "sugary" | "fatty" | "dry" | "wet";

export interface InclusionInfo {
  kind: InclusionKind;
  label: string;
  /** A typical amount as a fraction of flour; none for "other". */
  typical?: number;
  addAt: InclusionAddAt;
  flags: InclusionFlag[];
  /** What the planner prints with it. */
  note?: string;
}

/** §6, R3. */
export const INCLUSIONS: Record<InclusionKind, InclusionInfo> = {
  cheese: {
    kind: "cheese",
    label: "Cheese",
    typical: 0.25,
    addAt: "fold1",
    flags: ["salty", "fatty"],
    note: "Keep it inside at shaping; parchment under the loaf.",
  },
  chilli: {
    kind: "chilli",
    label: "Chilli",
    typical: 0.08,
    addAt: "fold1",
    flags: ["wet"],
    note: "Pat dry; sautéing first tames the water.",
  },
  olive: {
    kind: "olive",
    label: "Olives",
    typical: 0.2,
    addAt: "fold1",
    flags: ["salty", "wet"],
    note: "Rinse and dry; drop the water up to 5 % if the dough goes slack.",
  },
  seed: {
    kind: "seed",
    label: "Seeds",
    typical: 0.15,
    addAt: "mix",
    flags: ["dry"],
    note: "Soak 1:1 in boiling water (flax 1:3), drain. Seeds on the crust darken: −10 °C.",
  },
  nut: {
    kind: "nut",
    label: "Nuts",
    typical: 0.15,
    addAt: "fold1",
    flags: ["dry"],
    note: "Toast first. Soak if you want a softer bite.",
  },
  "dried-fruit": {
    kind: "dried-fruit",
    label: "Dried fruit",
    typical: 0.15,
    addAt: "fold1",
    flags: ["sugary"],
    note: "Tuck pieces in at shaping; they burn. Can slow the rise.",
  },
  chocolate: {
    kind: "chocolate",
    label: "Chocolate",
    typical: 0.2,
    addAt: "fold1",
    flags: ["sugary"],
    note: "Tuck under the pre-shaped round.",
  },
  herb: {
    kind: "herb",
    label: "Herbs",
    typical: 0.01,
    addAt: "mix",
    flags: [],
    note: "Start at 1 %.",
  },
  garlic: {
    kind: "garlic",
    label: "Garlic",
    typical: 0.035,
    addAt: "fold2",
    flags: [],
    note: "Slows the rise; add late.",
  },
  porridge: {
    kind: "porridge",
    label: "Porridge",
    typical: 0.2,
    addAt: "fold2",
    flags: ["wet"],
    note: "Slackens the dough late in bulk: −5 % water.",
  },
  other: {
    kind: "other",
    label: "Other",
    addAt: "fold1",
    flags: [],
  },
};

/** Seeded on first run, sugar-free (decision 23). Fully editable; "reset" restores exactly this. */
export const DEFAULT_DOUGHS: Dough[] = [
  {
    id: "soft-bun",
    name: "Soft bun dough",
    icon: "🍔",
    method: "separate",
    hydration: 0.65,
    salt: 0.018,
    enrichments: [
      { kind: "milk", pct: 0.35 },
      { kind: "egg", pct: 0.12 },
      { kind: "butter", pct: 0.12 },
    ],
    inclusions: [],
    bake: { tempC: 190, steam: false, wash: "Egg + a splash of milk" },
    notes:
      "Mix to a windowpane before the butter goes in. Bulk to doubled, proof to doubled; 88–93 °C inside, not to colour. A tangzhong (5 % of the flour at 1:5) makes it softer still.",
  },
  {
    id: "soft-sandwich",
    name: "Soft sandwich dough",
    icon: "🥪",
    method: "separate",
    hydration: 0.7,
    salt: 0.018,
    enrichments: [
      { kind: "milk", pct: 0.22 },
      { kind: "butter", pct: 0.12 },
    ],
    inclusions: [],
    bake: { tempC: 190, steam: false, wash: "None under a lid; egg wash if open" },
    notes: "Pain de mie style. Bulk to +40 %, proof to just below the rim of the tin.",
  },
  {
    id: "buttered",
    name: "Buttered (softer crumb)",
    icon: "🧈",
    method: "split",
    enrichments: [{ kind: "butter", pct: 0.08 }],
    inclusions: [],
    splitAt: "fold1",
    notes:
      "Dimple softened butter into the portion in thirds and fold until it disappears; it goes slimy for a while. Keep it cool. Expect a slightly slower rise.",
  },
  {
    id: "jalapeno-cheddar",
    name: "Jalapeño cheddar",
    icon: "🌶️",
    method: "split",
    enrichments: [],
    inclusions: [
      {
        kind: "cheese",
        name: "Mature cheddar",
        pct: 0.25,
        note: "Mostly grated, some chunks for pockets",
      },
      { kind: "chilli", name: "Jalapeño, fresh, diced", pct: 0.08 },
    ],
    splitAt: "fold1",
    notes: "Keep the cheese inside at shaping; parchment under the loaf. Bake as plain.",
  },
  {
    id: "seeded",
    name: "Seeded",
    icon: "🌻",
    method: "split",
    enrichments: [],
    inclusions: [
      {
        kind: "seed",
        name: "Mixed seeds (sunflower, sesame, flax)",
        pct: 0.15,
        soakerWaterPct: 0.15,
        note: "Soak in boiling water 5 h or overnight; drain",
      },
    ],
    splitAt: "fold1",
    notes: "Seeds on the crust darken fast: drop 10 °C if coating the outside.",
  },
];

export function cloneDoughs(list: Dough[] = DEFAULT_DOUGHS): Dough[] {
  return list.map((d) => ({
    ...d,
    enrichments: d.enrichments.map((e) => ({ ...e })),
    inclusions: d.inclusions.map((x) => ({ ...x })),
    ...(d.sweetness && { sweetness: { ...d.sweetness } }),
    ...(d.tangzhong && { tangzhong: { ...d.tangzhong } }),
    ...(d.bake && { bake: { ...d.bake } }),
  }));
}

/**
 * The base dough under its reserved id (decision 1): nothing in it, no hydration or salt of its
 * own, so every helper reads the plan's Batch settings for it. Never stored. Its effective
 * method is "base"; `effectiveMethod` (split or separate) does not apply to it. Its name is the
 * one the app shows everywhere: "Main dough".
 */
export function leanDough(): Dough {
  return { id: LEAN_DOUGH_ID, name: "Main dough", method: "auto", enrichments: [], inclusions: [] };
}

/** The dough behind an id: lean, a library dough, or undefined when the library has no such id. */
export function findDough(id: string, doughs: Dough[]): Dough | undefined {
  if (id === LEAN_DOUGH_ID) return leanDough();
  return doughs.find((d) => d.id === id);
}

/** Decision 2: the item's dough, else the preset's, else lean. A blank id counts as unset. */
export function resolveDoughId(sel: ItemSelection, preset: Preset): string {
  return sel.doughId || preset.doughId || LEAN_DOUGH_ID;
}

/** Decision 2: `presetId` for lean, so lean keys and step ids stay byte-identical. */
export function lineKey(presetId: string, doughId: string): string {
  return doughId === LEAN_DOUGH_ID ? presetId : `${presetId}@${doughId}`;
}

/** Decision 3: a sweetness forces a separate mix once its sugar-equivalent is above this. */
export const SEPARATE_SUGAR_EQUIVALENT = 0.05;

/** Liquids that have to be inside the hydration from the start (decision 3, R2). */
const SEPARATE_ENRICHMENTS: EnrichmentKind[] = ["egg", "yolk", "milk"];

/**
 * Why a dough needs its own mix, whatever its method says: "egg", "egg yolk", "milk", the
 * sweetener ("sugar", "honey or syrup" …), "tangzhong", then "own hydration" and "own salt".
 * Empty for doughs a split can carry: inclusions, butter, oil (decision 3).
 */
export function separateReasons(d: Dough): string[] {
  const out: string[] = [];
  for (const kind of SEPARATE_ENRICHMENTS) {
    if (d.enrichments.some((e) => e.kind === kind && positive(e.pct) > 0)) {
      out.push(ENRICHMENTS[kind].label.toLowerCase());
    }
  }
  if (d.sweetness && sugarEquivalent(d) > SEPARATE_SUGAR_EQUIVALENT) {
    out.push((SWEETENERS[d.sweetness.kind]?.label ?? d.sweetness.kind).toLowerCase());
  }
  if (d.tangzhong && positive(d.tangzhong.flourPct) > 0) out.push("tangzhong");
  if (d.hydration !== undefined) out.push("own hydration");
  if (d.salt !== undefined) out.push("own salt");
  return out;
}

/** Decision 3: a forced method wins; `auto` is separate exactly when there is a reason to be. */
export function effectiveMethod(d: Dough): "split" | "separate" {
  if (d.method === "split" || d.method === "separate") return d.method;
  return separateReasons(d).length > 0 ? "separate" : "split";
}

/** Decision 9: only a separate mix can have its own hydration; split doughs share the batch's. */
export function doughHydration(d: Dough, base: Settings): number {
  return effectiveMethod(d) === "separate" && d.hydration !== undefined
    ? d.hydration
    : base.hydration;
}

/** Decision 9, for salt. */
export function doughSalt(d: Dough, base: Settings): number {
  return effectiveMethod(d) === "separate" && d.salt !== undefined ? d.salt : base.salt;
}

/** Decision 10: the sweetness as a fraction of flour times its osmotic factor. 0 without one. */
export function sugarEquivalent(d: Dough): number {
  const sw = d.sweetness;
  if (!sw) return 0;
  return positive(sw.pct) * (SWEETENERS[sw.kind]?.osmoticFactor ?? 0);
}

/**
 * Decision 10, a guide: 1 + 0.05 × max(0, sugarEq% − 3) + (butter% + oil% ≥ 20 ? 0.1 : 0),
 * clamped to 1–2, with percentages as numbers of percent (5 for 5 %).
 */
export function defaultBulkFactor(d: Dough): number {
  const sugarPct = sugarEquivalent(d) * 100;
  const fatPct =
    d.enrichments
      .filter((e) => e.kind === "butter" || e.kind === "oil")
      .reduce((sum, e) => sum + positive(e.pct), 0) * 100;
  const factor = 1 + 0.05 * Math.max(0, sugarPct - 3) + (fatPct >= 20 - EPS ? 0.1 : 0);
  return Math.min(2, Math.max(1, factor));
}

/** The dough's own bulk factor when it has a usable one, else the derived guide. */
export function bulkFactorFor(d: Dough): number {
  const v = d.bulkFactor;
  return v !== undefined && Number.isFinite(v) && v > 0 ? v : defaultBulkFactor(d);
}

/** Σ pct × water fraction over the enrichments and the sweetness, per gram of flour. */
export function enrichmentWater(d: Dough): number {
  return enrichmentsAndSweetness(d).reduce(
    (sum, e) => sum + positive(e.pct) * (WATER_FRACTION[e.kind] ?? 0),
    0,
  );
}

/**
 * k_dough (§4): dough grams per flour gram, add-ins out. A separate mix is 1 + H + s + Σ e·(1 − w):
 * its added water gives way to the water its enrichments carry (decision 5). A split is
 * 1 + H + s + Σ e: its portion of the base dough already holds all its water and cannot give any
 * back, so the enrichments count whole.
 */
export function doughOnlyFactor(d: Dough, base: Settings): number {
  const split = effectiveMethod(d) === "split";
  const enriched = enrichmentsAndSweetness(d).reduce(
    (sum, e) => sum + positive(e.pct) * (split ? 1 : 1 - (WATER_FRACTION[e.kind] ?? 0)),
    0,
  );
  return 1 + doughHydration(d, base) + doughSalt(d, base) + enriched;
}

/** k (§4): dough grams per flour gram, add-ins in. k_dough + inclusions + soaker water. */
export function compositionFactor(d: Dough, base: Settings): number {
  const addIns = d.inclusions.reduce(
    (sum, x) => sum + positive(x.pct) + positive(x.soakerWaterPct),
    0,
  );
  return doughOnlyFactor(d, base) + addIns;
}

/**
 * Usable grams per flour gram for a line on this dough (§4, decision 6): k with the tick box on
 * (the default; undefined reads as on), k_dough with it off, after bench loss.
 */
export function usablePerFlour(
  d: Dough,
  base: Settings,
  plan: Pick<Plan, "weightsIncludeAdditions">,
): number {
  const k =
    plan.weightsIncludeAdditions === false ? doughOnlyFactor(d, base) : compositionFactor(d, base);
  return k * (1 - base.benchLoss);
}

/** Decision 11: butter in at the mix up to 10 %, after it above; everything else at the mix. */
export function enrichmentAddAt(e: Enrichment): EnrichmentAddAt {
  if (e.addAt) return e.addAt;
  const above = ENRICHMENTS[e.kind]?.afterMixAbove;
  return above !== undefined && positive(e.pct) > above ? "after-mix" : "mix";
}

/** Decision 11 and §6: the inclusion's own add-at, else its kind's default. */
export function inclusionAddAt(x: Inclusion): InclusionAddAt {
  return x.addAt ?? INCLUSIONS[x.kind]?.addAt ?? "fold1";
}

/** Decision 11: a split dough is taken at fold 1 unless it says otherwise. */
export function splitAtFor(d: Dough): SplitAt {
  return d.splitAt ?? "fold1";
}

/** A usable amount: the number when it is finite and positive, else 0 (blank or a typo reads as none). */
export function positive(n: number | undefined): number {
  return n !== undefined && Number.isFinite(n) && n > 0 ? n : 0;
}

function enrichmentsAndSweetness(d: Dough): { kind: EnrichmentKind | SweetKind; pct: number }[] {
  return d.sweetness ? [...d.enrichments, d.sweetness] : d.enrichments;
}
