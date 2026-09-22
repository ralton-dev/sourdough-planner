import { DEFAULT_PRESETS, clonePresets } from "./presets";
import { DEFAULT_BULK_TABLE, type BulkRow } from "./timeline";
import { DEFAULT_SETTINGS, type Plan, type Preset } from "./types";
import { newId } from "./ids";

const NS = "sourdough.v1";
export const KEYS = {
  presets: `${NS}.presets`,
  plan: `${NS}.plan`,
  bulkTable: `${NS}.bulkTable`,
  savedPlans: `${NS}.savedPlans`,
  ui: `${NS}.ui`,
} as const;

export interface UiPrefs {
  halfGramSalt: boolean;
}

export const DEFAULT_UI: UiPrefs = { halfGramSalt: false };

export interface SavedPlan {
  id: string;
  name: string;
  savedAt: string;
  plan: Plan;
}

function store(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function load<T>(key: string, fallback: T, validate?: (v: unknown) => v is T): T {
  const s = store();
  if (!s) return fallback;
  try {
    const raw = s.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (validate && !validate(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode: the plan still works for this session.
  }
}

export function newPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: newId("plan"),
    mode: "starter",
    starterWeight: 250,
    items: [
      { presetId: "pizza", count: 2 },
      { presetId: "roll", count: 4 },
      { presetId: "loaf", count: 2 },
    ],
    settings: { ...DEFAULT_SETTINGS },
    startTime: new Date().toISOString(),
    timelineOverrides: {},
    feedStarter: false,
    autolyse: false,
    ...overrides,
  };
}

export const isPresetList = (v: unknown): v is Preset[] =>
  Array.isArray(v) &&
  v.every(
    (p) =>
      p && typeof p === "object" && typeof p.id === "string" && typeof p.defaultWeight === "number",
  );

export const isBulkTable = (v: unknown): v is BulkRow[] =>
  Array.isArray(v) && v.every((r) => r && typeof r === "object" && typeof r.tempC === "number");

export const isPlan = (v: unknown): v is Plan =>
  !!v &&
  typeof v === "object" &&
  Array.isArray((v as Plan).items) &&
  typeof (v as Plan).settings === "object";

export const isSavedPlans = (v: unknown): v is SavedPlan[] =>
  Array.isArray(v) && v.every((s) => s && typeof s === "object" && isPlan((s as SavedPlan).plan));

export function loadAll() {
  return {
    presets: load(KEYS.presets, clonePresets(DEFAULT_PRESETS), isPresetList),
    plan: load(KEYS.plan, newPlan(), isPlan),
    bulkTable: load(
      KEYS.bulkTable,
      DEFAULT_BULK_TABLE.map((r) => ({ ...r })),
      isBulkTable,
    ),
    savedPlans: load(KEYS.savedPlans, [] as SavedPlan[], isSavedPlans),
    ui: load(KEYS.ui, DEFAULT_UI),
  };
}

export interface ExportBundle {
  app: "sourdough-planner";
  version: 1;
  exportedAt: string;
  presets: Preset[];
  bulkTable: BulkRow[];
  savedPlans: SavedPlan[];
  plan: Plan;
}

export function exportBundle(data: Omit<ExportBundle, "app" | "version" | "exportedAt">): string {
  const bundle: ExportBundle = {
    app: "sourdough-planner",
    version: 1,
    exportedAt: new Date().toISOString(),
    ...data,
  };
  return JSON.stringify(bundle, null, 2);
}

export function parseBundle(text: string): ExportBundle {
  const v: unknown = JSON.parse(text);
  if (!v || typeof v !== "object" || (v as ExportBundle).app !== "sourdough-planner") {
    throw new Error("Not a sourdough-planner export.");
  }
  const b = v as ExportBundle;
  if (!isPresetList(b.presets)) throw new Error("Export has no valid presets.");
  if (!isBulkTable(b.bulkTable)) throw new Error("Export has no valid bulk table.");
  if (!isSavedPlans(b.savedPlans ?? [])) throw new Error("Export has invalid saved plans.");
  if (!isPlan(b.plan)) throw new Error("Export has no valid plan.");
  return { ...b, savedPlans: b.savedPlans ?? [] };
}
