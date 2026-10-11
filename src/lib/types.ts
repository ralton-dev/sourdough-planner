export type Mode = "starter" | "items";
export type ProofType = "room" | "cold" | "either";

/** All ratios are fractions of total flour (baker's percentages), e.g. 0.75 = 75 %. */
export interface Settings {
  starterHydration: number; // water ÷ flour inside the starter; 1.0 = 100 %
  inoculation: number; // starter weight ÷ added flour
  hydration: number; // total water ÷ total flour, starter included
  salt: number; // salt ÷ total flour
  benchLoss: number; // fraction of dough lost to bowl and bench
  doughTempC: number;
}

export interface Preset {
  id: string;
  name: string;
  icon?: string;
  defaultWeight: number;
  minWeight: number;
  maxWeight: number;
  /** 0 = fixed weight. Higher numbers absorb surplus or deficit first. */
  flexPriority: number;
  proof: ProofType;
  proofMinutes: [number, number];
  bake: { tempC: number; minutes: [number, number]; steam: boolean };
  note?: string;
  /** Warn when hydration is high enough to make this hard to shape. */
  hydrationSensitive?: boolean;
  /** The dough this preset is made from unless an item line says otherwise. Undefined = lean. */
  doughId?: string;
}

export interface ItemSelection {
  presetId: string;
  count: number;
  /** Pins this item to an exact weight; it no longer flexes. */
  weightOverride?: number;
  /** The dough this line is made from. Wins over `Preset.doughId`; undefined = the preset's, then lean. */
  doughId?: string;
}

export interface Plan {
  id: string;
  name?: string;
  mode: Mode;
  starterWeight?: number; // starter mode
  starterAvailable?: number; // items mode, warning only
  items: ItemSelection[];
  settings: Settings;
  startTime: string; // ISO
  timelineOverrides?: Record<string, number>; // stepId -> minutes
  feedStarter?: boolean;
  autolyse?: boolean;
  /** Dough developed in a stand mixer at mix time; fewer folds are needed. */
  standMixer?: boolean;
  /** Stretch-and-fold sets during bulk. Undefined = the default for the mixing method. */
  foldCount?: number;
  /** This bake: what was planned, changed or learned. */
  notes?: string;
  /**
   * Whether a planned piece weight includes its add-ins (inclusions and soaker water).
   * Undefined reads as true, so no saved plan moves (decision 6).
   */
  weightsIncludeAdditions?: boolean;
}

export interface Ingredients {
  addedFlour: number;
  addedWater: number;
  starter: number;
  starterFlour: number;
  starterWater: number;
  salt: number;
  totalFlour: number;
  totalWater: number;
  totalDough: number;
  usableDough: number;
  /** totalWater ÷ totalFlour, always the true figure. */
  trueHydration: number;
}

export interface AllocationLine {
  /** `presetId` for lean, `presetId@doughId` otherwise (decision 2). Lanes and React keys use it. */
  key: string;
  presetId: string;
  name: string;
  icon?: string;
  doughId: string;
  doughName: string;
  count: number;
  /** The weight this item started from: override or preset default. */
  baseWeight: number;
  /** The planned weight: the finished piece with the tick box on, plain dough with it off. */
  weightEach: number;
  /** Plain dough per piece, add-ins out. */
  doughEach: number;
  /** Inclusions and soaker water per piece. */
  additionsEach: number;
  /** The finished piece: `weightEach` with the tick box on, `weightEach + additionsEach` off. */
  pieceEach: number;
  adjusted: boolean;
  belowMin: boolean;
  pinned: boolean;
}

export type WarningLevel = "warn" | "info";

export interface PlanWarning {
  level: WarningLevel;
  code: string;
  message: string;
}

export interface AdditionLine {
  kind:
    | EnrichmentKind
    | SweetKind
    | InclusionKind
    | "soaker-water"
    | "tangzhong-flour"
    | "tangzhong-liquid";
  label: string; // "Mature cheddar", "Butter", "Soaker water (mixed seeds)"
  pct: number; // of this dough's flour
  grams: number;
  addAt: EnrichmentAddAt | InclusionAddAt | "split";
  note?: string;
}

export interface DoughResult {
  doughId: string;
  name: string;
  icon?: string;
  method: EffectiveMethod;
  mixId: string; // "base" or the dough id
  flour: number; // this dough's total flour, starter flour included
  water: number; // true total water
  starter: number;
  salt: number;
  addedFlour: number; // what to weigh for a separate mix; 0 for base and split
  addedWater: number; // likewise (0 when liquids exceed the target, decision 5)
  additions: AdditionLine[];
  additionsTotal: number;
  mass: number; // dough including additions, before bench loss
  usable: number; // mass × (1 − benchLoss)
  portion?: number; // split only: grams of base dough to take at the split
  /** Split only: where it leaves the main dough, as its reason says; cards read this, not that. */
  splitAt?: SplitAt;
  trueHydration: number;
  bulkFactor: number;
  reason: string; // "Mixed separately: egg and milk have to go in with the water."
  notes?: string;
}

export interface MixResult extends Ingredients {
  id: string; // "base" or the dough id
  label: string; // "Main dough" or the dough name
  doughIds: string[]; // base mix lists lean plus its split doughs
  additions: AdditionLine[]; // separate mixes: enrichment and tangzhong lines; base: []
  mixMinutes: number; // 10 or 20 (decision 13)
}

/** Its inherited `Ingredients` fields are batch totals: the sums over `mixes` once WP-C fills them. */
export interface BatchResult extends Ingredients {
  allocation: AllocationLine[];
  mixes: MixResult[];
  doughs: DoughResult[];
  /** + spare, − short, after every flex tier has been used. */
  spareOrShort: number;
  suggestions: string[];
  warnings: PlanWarning[];
  /** Items mode only: the inoculation that would fit the available starter. */
  inoculationForAvailable?: number;
}

export type DoughMethod = "auto" | "split" | "separate";
export type EffectiveMethod = "base" | "split" | "separate";
export type SplitAt = "mix" | "fold1" | "fold2";
export type EnrichmentAddAt = "mix" | "after-mix";
export type InclusionAddAt = "mix" | "fold1" | "fold2" | "lamination" | "shape";
export type EnrichmentKind = "butter" | "oil" | "egg" | "yolk" | "milk";
export type SweetKind =
  "sugar" | "honey" | "xylitol" | "erythritol" | "maltitol" | "high-intensity";
export type InclusionKind =
  | "cheese"
  | "chilli"
  | "olive"
  | "seed"
  | "nut"
  | "dried-fruit"
  | "chocolate"
  | "herb"
  | "garlic"
  | "porridge"
  | "other";

/** pct is a fraction of the dough's total flour, like every other ratio in the app. */
export interface Enrichment {
  kind: EnrichmentKind;
  pct: number;
  addAt?: EnrichmentAddAt;
}
export interface Inclusion {
  kind: InclusionKind;
  name: string;
  pct: number;
  addAt?: InclusionAddAt;
  /** Water the inclusion is soaked in, as a fraction of flour. Its own line; not hydration. */
  soakerWaterPct?: number;
  note?: string;
}
/** Decision 23. pct is a fraction of flour; for high-intensity kinds it is tiny (≈0.0002). */
export interface Sweetness {
  kind: SweetKind;
  pct: number;
}

export interface Dough {
  id: string;
  name: string;
  icon?: string;
  method: DoughMethod;
  /** Separate mixes only; undefined = the batch settings. Ignored for split doughs (decision 9). */
  hydration?: number;
  salt?: number;
  enrichments: Enrichment[];
  inclusions: Inclusion[];
  /** Undefined = no sugar (decision 23). */
  sweetness?: Sweetness;
  /** Separate mixes only: a cooked paste from this fraction of the dough's flour at liquid:flour = ratio. */
  tangzhong?: { flourPct: number; ratio: number };
  /** Split doughs only. Default fold1. */
  splitAt?: SplitAt;
  /** Multiplier on the bulk estimate. Undefined = derived (decision 10). */
  bulkFactor?: number;
  bake?: { tempC?: number; steam?: boolean; wash?: string };
  notes?: string;
}

/** The base dough: the plan's Batch settings. Reserved, never stored, never deleted (decision 1). */
export const LEAN_DOUGH_ID = "lean";

export const DEFAULT_SETTINGS: Settings = {
  starterHydration: 1.0,
  inoculation: 0.25,
  hydration: 0.75,
  salt: 0.02,
  benchLoss: 0.01,
  doughTempC: 24,
};
