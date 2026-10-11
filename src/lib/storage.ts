import { DEFAULT_DOUGHS, ENRICHMENTS, INCLUSIONS, SWEETENERS, cloneDoughs } from "./doughs";
import { DEFAULT_PRESETS, LEGACY_PRESETS, clonePresets, reconcileDefaults } from "./presets";
import { DEFAULT_BULK_TABLE, type BulkRow } from "./timeline";
import {
  DEFAULT_SETTINGS,
  LEAN_DOUGH_ID,
  type Dough,
  type DoughMethod,
  type EnrichmentAddAt,
  type InclusionAddAt,
  type Plan,
  type Preset,
  type SplitAt,
} from "./types";
import { newId } from "./ids";

const NS = "sourdough.v1";
export const KEYS = {
  presets: `${NS}.presets`,
  doughs: `${NS}.doughs`,
  plan: `${NS}.plan`,
  bulkTable: `${NS}.bulkTable`,
  savedPlans: `${NS}.savedPlans`,
  ui: `${NS}.ui`,
  /** The default preset and dough ids this browser has been given (`loadAll`, decision 14). */
  seeded: `${NS}.seeded`,
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

/** Writes `value` as JSON. False when it could not be written. */
export function save(key: string, value: unknown): boolean {
  const s = store();
  if (!s) return false;
  try {
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota or private mode: the plan still works for this session.
    return false;
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
    standMixer: false,
    ...overrides,
  };
}

export const isPresetList = (v: unknown): v is Preset[] =>
  Array.isArray(v) &&
  v.every(
    (p) =>
      p && typeof p === "object" && typeof p.id === "string" && typeof p.defaultWeight === "number",
  );

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
/** An optional field may be absent, never present with the wrong type (null included). */
const optional = (v: unknown, ok: (x: unknown) => boolean) => v === undefined || ok(v);
/** One of a table's keys. Tables typed `Record<Union, …>` stay in step with their union. */
const keyOf = (table: object) => (v: unknown) => isString(v) && Object.hasOwn(table, v);

const METHODS: Record<DoughMethod, true> = { auto: true, split: true, separate: true };
const SPLIT_AT: Record<SplitAt, true> = { mix: true, fold1: true, fold2: true };
const ENRICHMENT_AT: Record<EnrichmentAddAt, true> = { mix: true, "after-mix": true };
const INCLUSION_AT: Record<InclusionAddAt, true> = {
  mix: true,
  fold1: true,
  fold2: true,
  lamination: true,
  shape: true,
};

const isEnrichment = (v: unknown) =>
  isRecord(v) &&
  keyOf(ENRICHMENTS)(v.kind) &&
  isFiniteNumber(v.pct) &&
  optional(v.addAt, keyOf(ENRICHMENT_AT));

const isInclusion = (v: unknown) =>
  isRecord(v) &&
  keyOf(INCLUSIONS)(v.kind) &&
  isString(v.name) &&
  isFiniteNumber(v.pct) &&
  optional(v.addAt, keyOf(INCLUSION_AT)) &&
  optional(v.soakerWaterPct, isFiniteNumber) &&
  optional(v.note, isString);

/**
 * A dough as the app writes it, checked all the way down, since a bundle or a stored value can
 * hold anything: known kinds and methods, finite amounts, strings where the planner reads text.
 */
export const isDough = (v: unknown): v is Dough =>
  isRecord(v) &&
  isString(v.id) &&
  isString(v.name) &&
  keyOf(METHODS)(v.method) &&
  Array.isArray(v.enrichments) &&
  v.enrichments.every(isEnrichment) &&
  Array.isArray(v.inclusions) &&
  v.inclusions.every(isInclusion) &&
  optional(v.sweetness, (x) => isRecord(x) && keyOf(SWEETENERS)(x.kind) && isFiniteNumber(x.pct)) &&
  optional(
    v.tangzhong,
    (x) => isRecord(x) && isFiniteNumber(x.flourPct) && isFiniteNumber(x.ratio),
  ) &&
  optional(
    v.bake,
    (x) =>
      isRecord(x) &&
      optional(x.tempC, isFiniteNumber) &&
      optional(x.steam, isBoolean) &&
      optional(x.wash, isString),
  ) &&
  optional(v.hydration, isFiniteNumber) &&
  optional(v.salt, isFiniteNumber) &&
  optional(v.bulkFactor, isFiniteNumber) &&
  optional(v.splitAt, keyOf(SPLIT_AT)) &&
  optional(v.icon, isString) &&
  optional(v.notes, isString);

/**
 * A dough library, every dough valid. Like the other validators it judges the whole list: one bad
 * dough and a stored library falls back to the defaults (the stored value is left as it is), and an
 * import is refused rather than half taken.
 */
export const isDoughList = (v: unknown): v is Dough[] => Array.isArray(v) && v.every(isDough);

export const isBulkTable = (v: unknown): v is BulkRow[] =>
  Array.isArray(v) && v.every((r) => r && typeof r === "object" && typeof r.tempC === "number");

export const isPlan = (v: unknown): v is Plan =>
  !!v &&
  typeof v === "object" &&
  Array.isArray((v as Plan).items) &&
  typeof (v as Plan).settings === "object";

export const isSavedPlans = (v: unknown): v is SavedPlan[] =>
  Array.isArray(v) && v.every((s) => s && typeof s === "object" && isPlan((s as SavedPlan).plan));

/** Decision 1: the lean dough is the batch settings, never in the library, stored or exported. */
const withoutLean = (doughs: Dough[]): Dough[] => doughs.filter((d) => d.id !== LEAN_DOUGH_ID);

/** The default ids a browser has been given, per library (decision 14). */
interface Seeded {
  presets?: string[];
  doughs?: string[];
}

const isIdList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

const isSeeded = (v: unknown): v is Seeded =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  [(v as Seeded).presets, (v as Seeded).doughs].every((l) => l === undefined || isIdList(l));

/** The entries of `defaults` whose ids are in `ids`. */
const given = <T extends { id: string }>(defaults: readonly T[], ids: readonly string[]): T[] =>
  defaults.filter((d) => ids.includes(d.id));

/** `ids`, then every default id not already among them. */
const withIds = (ids: readonly string[] | undefined, defaults: readonly { id: string }[]) => [
  ...new Set([...(ids ?? []), ...defaults.map((d) => d.id)]),
];

/**
 * One library as stored, reconciled with its defaults (decision 14). With nothing usable stored it
 * is the defaults, and whatever is stored is left as it is. A stored list the reconcile changed is
 * written back; `ok` is false only when that write failed, so the caller does not record defaults
 * as given that the stored list never received.
 */
function loadLibrary<T extends { id: string }>(
  key: string,
  valid: (v: unknown) => v is T[],
  defaults: T[],
  previous: readonly T[],
): { list: T[]; ok: boolean } {
  const stored = load<unknown>(key, undefined);
  if (!valid(stored)) return { list: defaults, ok: true };
  const list = reconcileDefaults(stored, defaults, previous);
  const changed = list.length !== stored.length || list.some((e, i) => e !== stored[i]);
  return { list, ok: !changed || save(key, list) };
}

export interface Loaded {
  presets: Preset[];
  doughs: Dough[];
  plan: Plan;
  bulkTable: BulkRow[];
  savedPlans: SavedPlan[];
  ui: UiPrefs;
}

/**
 * Everything the app keeps, as stored. Presets and doughs are reconciled with the shipped defaults
 * (decision 14): a list saved before a default existed gains it, an unedited old default is
 * refreshed in place, and edits, deletions, order and user-added entries stay. A list the reconcile
 * changed is written straight back, then the default ids given are recorded under `KEYS.seeded`,
 * so a default the user deletes after this load stays deleted. Nothing else is written.
 */
export function loadAll(): Loaded {
  const seeded = load<Seeded>(KEYS.seeded, {}, isSeeded);
  const presets = loadLibrary(KEYS.presets, isPresetList, clonePresets(DEFAULT_PRESETS), [
    // A browser from before the record was given exactly the legacy list.
    ...LEGACY_PRESETS,
    ...given(DEFAULT_PRESETS, seeded.presets ?? []),
  ]);
  const doughs = loadLibrary(
    KEYS.doughs,
    isDoughList,
    cloneDoughs(),
    // No dough library predates the record, so one stored without it was seeded from these.
    given(DEFAULT_DOUGHS, seeded.doughs ?? DEFAULT_DOUGHS.map((d) => d.id)),
  );
  const record: Seeded = {
    presets: withIds(seeded.presets, DEFAULT_PRESETS),
    doughs: withIds(seeded.doughs, DEFAULT_DOUGHS),
  };
  if (presets.ok && doughs.ok && JSON.stringify(record) !== JSON.stringify(seeded)) {
    save(KEYS.seeded, record);
  }
  return {
    presets: presets.list,
    doughs: withoutLean(doughs.list),
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
  /** 1 up to 187a90a; 2 adds the dough library (decision 16). */
  version: 1 | 2;
  exportedAt: string;
  presets: Preset[];
  /** Version 2. Optional until WP-H passes the app's library (decision 21). */
  doughs?: Dough[];
  bulkTable: BulkRow[];
  savedPlans: SavedPlan[];
  plan: Plan;
}

/** What an import yields, whatever its version: always with a dough library. */
export type ImportedBundle = ExportBundle & { doughs: Dough[] };

export function exportBundle(data: Omit<ExportBundle, "app" | "version" | "exportedAt">): string {
  const { doughs, ...rest } = data;
  const bundle: ExportBundle = {
    app: "sourdough-planner",
    version: 2,
    exportedAt: new Date().toISOString(),
    ...rest,
    ...(doughs && { doughs: withoutLean(doughs) }),
  };
  return JSON.stringify(bundle, null, 2);
}

/**
 * Reads an export (decision 16). Version 1, up to 187a90a, has no doughs: it gets the default
 * library, and its presets are reconciled the way a list stored then would be. Version 2 is taken
 * as written; one without doughs (exported before the app passed them) gets the defaults too. A
 * missing version reads as 1; any other version, and anything malformed, is rejected.
 */
export function parseBundle(text: string): ImportedBundle {
  const v: unknown = JSON.parse(text);
  if (!v || typeof v !== "object" || (v as ExportBundle).app !== "sourdough-planner") {
    throw new Error("Not a sourdough-planner export.");
  }
  const b = v as ExportBundle;
  const version: unknown = (v as { version?: unknown }).version ?? 1;
  if (version !== 1 && version !== 2) {
    throw new Error(`This export is version ${String(version)}; this app reads versions 1 and 2.`);
  }
  if (!isPresetList(b.presets)) throw new Error("Export has no valid presets.");
  if (version === 2 && b.doughs !== undefined && !isDoughList(b.doughs)) {
    throw new Error("Export has invalid doughs.");
  }
  if (!isBulkTable(b.bulkTable)) throw new Error("Export has no valid bulk table.");
  if (!isSavedPlans(b.savedPlans ?? [])) throw new Error("Export has invalid saved plans.");
  if (!isPlan(b.plan)) throw new Error("Export has no valid plan.");
  const legacy = version === 1;
  return {
    ...b,
    presets: legacy
      ? reconcileDefaults(b.presets, clonePresets(DEFAULT_PRESETS), LEGACY_PRESETS)
      : b.presets,
    doughs: !legacy && b.doughs ? withoutLean(b.doughs) : cloneDoughs(),
    savedPlans: b.savedPlans ?? [],
  };
}
