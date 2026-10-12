// The decisions of sync (PLAN-accounts decision 46) as pure functions, so they can be tested
// without a server or a clock: what /api/me means, what a pulled or conflicting document does to
// this device's copy, what the status line says. `useSync.ts` does the fetching and the timing.
import { exportBundle, readBundle, type ExportBundle } from "../lib/storage";
import {
  SECTIONS,
  describeMerge,
  mergeBundles,
  type Mergeable,
  type Section,
  type SectionTimes,
} from "../lib/sync";
import { fmtTime } from "../lib/format";

/** Who is using the app, as `GET /api/me` says. */
export type Me =
  | { enabled: false }
  | { enabled: true; user: { name: string | null; email: string | null } | null };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const orNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * `GET /api/me`'s answer. Anything but a 200 with `{ enabled: true }` is accounts off: a static
 * host answers the SPA's index.html (not JSON), an old server 404s, a dead one does not answer.
 */
export function readMe(status: number | null, body: unknown): Me {
  if (status !== 200 || !isRecord(body) || body.enabled !== true) return { enabled: false };
  const u = body.user;
  if (!isRecord(u)) return { enabled: true, user: null };
  return { enabled: true, user: { name: orNull(u.name), email: orNull(u.email) } };
}

/** The account's name as the menu shows it: the name, else the email. */
export function displayName(user: { name: string | null; email: string | null }): string {
  return user.name ?? user.email ?? "your account";
}

/**
 * Where sync stands (decision 46). `local`: accounts off or signed out. `offline` carries a reason
 * when the trouble is not the network (the server refused or could not be read), which retrying
 * will not fix.
 */
export type SyncStatus =
  | { kind: "local" }
  | { kind: "syncing" }
  | { kind: "synced"; at: string }
  | { kind: "offline"; reason?: string }
  | { kind: "signin" };

export const OFFLINE_TEXT = "Offline, changes kept; will sync when back.";
export const SIGNIN_TEXT = "Sign in again to keep syncing.";
export const LOCAL_TEXT = "Local only. Sign in to keep this on every device.";

/**
 * The status line (§4), for the Backup card and the menu's tooltip. Empty with accounts off: the
 * page then says nothing about accounts beyond the footer.
 */
export function statusLine(
  me: Me | null,
  status: SyncStatus,
  time: (d: Date) => string = fmtTime,
): string {
  if (!me?.enabled) return "";
  if (!me.user) return LOCAL_TEXT;
  const who = `Signed in as ${displayName(me.user)}`;
  switch (status.kind) {
    case "synced":
      return `${who}, synced ${time(new Date(status.at))}.`;
    case "syncing":
      return `${who}, syncing…`;
    case "offline":
      return status.reason ?? OFFLINE_TEXT;
    case "signin":
      return SIGNIN_TEXT;
    case "local":
      return `${who}.`;
  }
}

/** True when two change-time maps agree on every section, whatever order their keys are in. */
export function sameTimes(a: SectionTimes, b: SectionTimes): boolean {
  return SECTIONS.every((s) => a[s] === b[s]);
}

/** A canonical key for a change-time map, for effect dependencies. */
export function timesKey(t: SectionTimes): string {
  return SECTIONS.map((s) => t[s] ?? "").join("|");
}

/** Whether this device has ever changed anything (else it has nothing of its own to push). */
export const hasTimes = (t: SectionTimes): boolean => SECTIONS.some((s) => t[s] !== undefined);

/** A time no real change has: what `readBundle` is told is "now" for a section with no time. */
const NO_TIME = new Date(0).toISOString();

/**
 * The server's bundle read as `parseBundle` reads a file, or null when it fails the same checks:
 * a document this client cannot read is never applied. Unlike a file import, a section the
 * document has no change time for stays without one (oldest in a merge), rather than being dated
 * now and beating this device's real edits. (`readBundle` has no "leave it untimed" option; it
 * belongs in src/lib/storage.ts as one, and this sentinel goes.)
 */
export function readRemote(value: unknown): (Mergeable & ExportBundle) | null {
  try {
    const b = readBundle(value, NO_TIME);
    const updatedAt: SectionTimes = {};
    for (const s of SECTIONS) {
      const at = b.updatedAt[s];
      if (at !== undefined && at !== NO_TIME) updatedAt[s] = at;
    }
    return { ...b, updatedAt };
  } catch {
    return null;
  }
}

/** The bundle as `PUT /api/state` carries it: exportBundle's version 3, as an object. */
export function toWire(m: Mergeable): ExportBundle {
  return JSON.parse(
    exportBundle({
      presets: m.presets,
      doughs: m.doughs,
      bulkTable: m.bulkTable,
      savedPlans: m.savedPlans,
      plan: m.plan,
      ui: m.ui,
      updatedAt: m.updatedAt ?? {},
    }),
  ) as ExportBundle;
}

/** What this device does with a document from the server (a pull's 200, a push's 409). */
export type Resolution =
  | { kind: "unreadable" }
  | {
      kind: "merged";
      /** What this device keeps from now on: newest per section (decision 45). */
      bundle: Mergeable;
      /** Whether the app's state must take `bundle` (something came from the server, or a time). */
      apply: boolean;
      /** Whether the server lacks something `bundle` has: push it. */
      push: boolean;
      fromLocal: Section[];
      fromRemote: Section[];
      /** The one-off sentence, empty when nothing moved. */
      notice: string;
    };

/** Merges the server's document into this device's copy. */
export function resolve(local: Mergeable, remote: unknown): Resolution {
  const theirs = readRemote(remote);
  if (!theirs) return { kind: "unreadable" };
  const mine: Mergeable = { ...local, updatedAt: local.updatedAt ?? {} };
  const result = mergeBundles<Mergeable>(mine, theirs);
  const bundle: Mergeable = {
    presets: result.bundle.presets,
    doughs: result.bundle.doughs,
    bulkTable: result.bundle.bulkTable,
    savedPlans: result.bundle.savedPlans,
    plan: result.bundle.plan,
    ui: result.bundle.ui,
    updatedAt: result.bundle.updatedAt ?? {},
  };
  return {
    kind: "merged",
    bundle,
    apply: result.fromRemote.length > 0 || !sameTimes(bundle.updatedAt ?? {}, mine.updatedAt ?? {}),
    push: result.fromLocal.length > 0,
    fromLocal: result.fromLocal,
    fromRemote: result.fromRemote,
    notice: describeMerge(result),
  };
}

/** What to do next after `PUT /api/state` answered 409 `{ version, updatedAt, bundle }`. */
export type ConflictStep =
  | { kind: "unreadable" }
  | {
      kind: "push";
      baseVersion: number;
      /** What to send: the merge, or this device's copy when the server holds nothing. */
      bundle: Mergeable;
      /** Set when the app's state must take the merge before the push. */
      apply: Mergeable | null;
      notice: string;
    }
  | {
      kind: "settle";
      version: number;
      /** The server already has everything; the app takes its document (when it differs). */
      apply: Mergeable | null;
      times: SectionTimes;
      notice: string;
    };

/**
 * Decision 46 and §9: a 409 means the push was made from a stale copy. The server's document is
 * merged with this device's copy and the merge is what goes back, on the server's version; the
 * local copy is never re-sent as it was on the new version, which would overwrite whatever the
 * other device saved. Only when the server holds nothing (`bundle: null`, version 0) does the
 * local copy go as it is.
 */
export function onConflict(local: Mergeable, body: unknown): ConflictStep {
  const version = isRecord(body) && Number.isSafeInteger(body.version) ? Number(body.version) : NaN;
  if (!isRecord(body) || !(version >= 0)) return { kind: "unreadable" };
  if (body.bundle === null) {
    return { kind: "push", baseVersion: version, bundle: local, apply: null, notice: "" };
  }
  const r = resolve(local, body.bundle);
  if (r.kind === "unreadable") return r;
  if (r.push) {
    return {
      kind: "push",
      baseVersion: version,
      bundle: r.bundle,
      apply: r.apply ? r.bundle : null,
      notice: r.notice,
    };
  }
  return {
    kind: "settle",
    version,
    apply: r.apply ? r.bundle : null,
    times: r.bundle.updatedAt ?? {},
    notice: r.notice,
  };
}

/** The one-line notice after the issuer sent the browser back with `?signin=…`. */
export function signinNotice(search: string): string {
  const v = new URLSearchParams(search).get("signin");
  if (v === "denied") return "Sign-in was cancelled or refused, so you are still signed out.";
  if (v === "error") return "Sign-in did not complete. Try again in a moment.";
  return "";
}

/** The query string without `signin`, for `history.replaceState` ("" when nothing is left). */
export function withoutSignin(search: string): string {
  const q = new URLSearchParams(search);
  q.delete("signin");
  const rest = q.toString();
  return rest ? `?${rest}` : "";
}
