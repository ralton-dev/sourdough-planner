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
}

export interface ItemSelection {
  presetId: string;
  count: number;
  /** Pins this item to an exact weight; it no longer flexes. */
  weightOverride?: number;
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
  presetId: string;
  name: string;
  icon?: string;
  count: number;
  /** The weight this item started from: override or preset default. */
  baseWeight: number;
  weightEach: number;
  subtotal: number;
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

export interface BatchResult extends Ingredients {
  allocation: AllocationLine[];
  /** + spare, − short, after every flex tier has been used. */
  spareOrShort: number;
  suggestions: string[];
  warnings: PlanWarning[];
  /** Items mode only: the inoculation that would fit the available starter. */
  inoculationForAvailable?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  starterHydration: 1.0,
  inoculation: 0.25,
  hydration: 0.75,
  salt: 0.02,
  benchLoss: 0.01,
  doughTempC: 24,
};
