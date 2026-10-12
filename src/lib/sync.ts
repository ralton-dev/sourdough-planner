/**
 * The pure half of sync (PLAN-accounts decisions 44–46): which sections a bundle has, how two
 * copies of it merge, how long to wait before retrying, and the sentence that says what a merge
 * did. No storage, no network, no clock: the hook that talks to the server (`src/sync/`) owns those.
 */
import type { BulkRow } from "./timeline";
import type { Dough, Plan, Preset } from "./types";
import type { SavedPlan, UiPrefs } from "./storage";

/** The six parts of what the app keeps, each synced whole (decision 45), in display order. */
export const SECTIONS = ["presets", "doughs", "bulkTable", "savedPlans", "plan", "ui"] as const;
export type Section = (typeof SECTIONS)[number];

/** Per section, the ISO time of its last change on the device that made it, by that device's clock. */
export type SectionTimes = Partial<Record<Section, string>>;

/**
 * Stored under `KEYS.sync`: the server's document version this device last saw (0 before the
 * first pull or push) and when each section last changed here.
 */
export interface SyncMeta {
  version: number;
  updatedAt: SectionTimes;
}

/** The six sections, as a bundle and the app hold them. `ImportedBundle` is one. */
export interface Sections {
  presets: Preset[];
  doughs: Dough[];
  bulkTable: BulkRow[];
  savedPlans: SavedPlan[];
  plan: Plan;
  ui: UiPrefs;
}

/** What `mergeBundles` reads: the six sections and, optionally, when each changed. */
export type Mergeable = Sections & { updatedAt?: SectionTimes };

export interface MergeResult<B extends Mergeable> {
  /** Remote's envelope with each section from the side that won it and the winner's time. */
  bundle: B;
  /** Sections this device had newer and different: the server does not have them yet. */
  fromLocal: Section[];
  /** Sections the server had newer (or equally new) and different: this device takes them. */
  fromRemote: Section[];
}

/** A section's time as a number; missing or unreadable is the oldest possible. */
const timeOf = (t: SectionTimes | undefined, s: Section): number => {
  const ms = Date.parse(t?.[s] ?? "");
  return Number.isNaN(ms) ? -Infinity : ms;
};

/**
 * Decision 45: per section, the side whose `updatedAt` is later wins whole; a tie goes to remote,
 * and a side with no time for a section counts as oldest. Times are device clocks, so with two
 * clocks apart "later" means later by those clocks; the result depends only on the two inputs,
 * never on when or where it runs. A section is reported on a side only when the side's copy won and
 * differs from the other's, so two copies that already agree merge silently.
 */
export function mergeBundles<B extends Mergeable>(local: B, remote: B): MergeResult<B> {
  const bundle: B = { ...remote };
  const updatedAt: SectionTimes = {};
  const fromLocal: Section[] = [];
  const fromRemote: Section[] = [];
  for (const s of SECTIONS) {
    const localWins = timeOf(local.updatedAt, s) > timeOf(remote.updatedAt, s);
    const winner = localWins ? local : remote;
    const differs = JSON.stringify(local[s]) !== JSON.stringify(remote[s]);
    (bundle as Sections)[s] = winner[s] as never;
    const at = winner.updatedAt?.[s];
    if (at !== undefined) updatedAt[s] = at;
    if (differs) (localWins ? fromLocal : fromRemote).push(s);
  }
  bundle.updatedAt = updatedAt;
  return { bundle, fromLocal, fromRemote };
}

/** Retry waits after a failed sync (decision 46), in milliseconds. */
const BACKOFF_MS = [5_000, 30_000, 120_000] as const;
const BACKOFF_STEADY_MS = 300_000;

/**
 * How long to wait before retrying after `attempt` consecutive failures, 1 for the first: 5 s,
 * 30 s, 2 min, then every 5 min. Anything below 1 (or not a number) reads as 1.
 */
export function nextBackoff(attempt: number): number {
  const n = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  return BACKOFF_MS[n - 1] ?? BACKOFF_STEADY_MS;
}

/** How the status line names each section. */
export const SECTION_NAMES: Record<Section, string> = {
  presets: "presets",
  doughs: "doughs",
  bulkTable: "bulk table",
  savedPlans: "saved plans",
  plan: "plan",
  ui: "settings",
};

/** "a", "a and b", "a, b and c". */
const listOf = (sections: readonly Section[]): string => {
  const names = sections.map((s) => SECTION_NAMES[s]);
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

/**
 * The one-off status sentence after a merge (§4): "Merged: presets and doughs from this device,
 * saved plans from the server." Empty when neither side brought anything the other lacked, since
 * a merge that changed nothing is not news and the status line keeps its usual text.
 */
export function describeMerge(result: Pick<MergeResult<Mergeable>, "fromLocal" | "fromRemote">) {
  const parts = [
    result.fromLocal.length ? `${listOf(result.fromLocal)} from this device` : "",
    result.fromRemote.length ? `${listOf(result.fromRemote)} from the server` : "",
  ].filter(Boolean);
  return parts.length ? `Merged: ${parts.join(", ")}.` : "";
}
