// Sync (PLAN-accounts decision 46): offline first. localStorage stays what the app renders from;
// signed in, this hook pulls the account's document on load and when the tab comes back, merges it
// section by section (newest wins), and pushes 1.5 s after the last change with the version it
// knows. A 409 is merged and pushed again (a few rounds at most); a network failure keeps the
// local copy and retries with backoff; a 401 asks for a new sign-in. With accounts off it makes
// one request, `GET /api/me`, and nothing else. The decisions live in ./logic.ts, tested; this
// file is the timing and the fetching.
import { useEffect, useRef, useState } from "react";
import {
  nextBackoff,
  type Mergeable,
  type Sections,
  type SectionTimes,
  type SyncMeta,
} from "../lib/sync";
import {
  hasTimes,
  onConflict,
  readMe,
  resolve,
  sameTimes,
  statusLine,
  timesKey,
  toWire,
  type Me,
  type SyncStatus,
} from "./logic";

/** How long after the last change the push goes (decision 46). */
const DEBOUNCE_MS = 1500;
/** 409 → merge → push rounds before giving up until the next retry. */
const MAX_ROUNDS = 3;
/** The tab coming back pulls, at most this often. */
const REFOCUS_PULL_MS = 30_000;

export interface SyncInput {
  /** The six sections as the app holds them now. */
  data: Sections;
  /** `KEYS.sync`: the version last seen and when each section last changed here. */
  meta: SyncMeta;
  /** Takes a merged document into the app's state, with its change times, stamping nothing. */
  apply: (bundle: Mergeable) => void;
  /** Records the server's version (the change times stay as they are). */
  setVersion: (version: number) => void;
}

export interface SyncState {
  /** `GET /api/me`'s answer; null until it comes. */
  me: Me | null;
  status: SyncStatus;
  /** The §4 status sentence ("" with accounts off). */
  line: string;
  /** The last merge's sentence ("Merged: …"), until the next one or a dismissal. */
  notice: string;
  dismissNotice: () => void;
}

type Reply = { status: number; body: unknown } | null;

/** The one fetch: same-origin cookie, JSON both ways. Null when the network failed. */
async function call(method: "GET" | "PUT", path: string, body?: unknown): Promise<Reply> {
  try {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed: unknown = undefined;
    if (res.status !== 204) {
      try {
        parsed = await res.json();
      } catch {
        // Not JSON (a static host's index.html): the reader treats it as nothing.
      }
    }
    return { status: res.status, body: parsed };
  } catch {
    return null;
  }
}

interface Io {
  local: () => Mergeable;
  version: () => number;
  apply: (bundle: Mergeable) => void;
  setVersion: (version: number) => void;
  setMe: (me: Me) => void;
  setStatus: (status: SyncStatus) => void;
  setNotice: (notice: string) => void;
}

/**
 * The sync loop, one per mounted app. One request at a time: a pull or push asked for while one
 * is in flight runs after it. Everything it decides comes from ./logic.ts.
 */
function createEngine(io: Io) {
  let dead = false;
  let signedIn = false;
  /** Whether sync has stopped until something outside changes (401, a refused document). */
  let halted = false;
  /** The change times the server's document has, as far as this device knows; null before a pull. */
  let synced: SectionTimes | null = null;
  let version = io.version();
  let busy = false;
  let queued: "pull" | "push" | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let lastPull = 0;

  const ok = () => {
    attempt = 0;
    io.setStatus({ kind: "synced", at: new Date().toISOString() });
  };
  /** The network or the server failed: keep everything, try `op` again after the backoff. */
  const fail = (op: "pull" | "push") => {
    attempt += 1;
    io.setStatus({ kind: "offline" });
    clearTimeout(timer);
    timer = setTimeout(() => run(op), nextBackoff(attempt));
  };
  /** Something retrying will not fix: say so and wait for a reload or a sign-in. */
  const halt = (status: SyncStatus) => {
    halted = true;
    clearTimeout(timer);
    io.setStatus(status);
  };
  const adopt = (v: number) => {
    version = v;
    io.setVersion(v);
  };

  /** Handles a reply every route shares: true when it was dealt with (and the caller stops). */
  function common(reply: Reply, op: "pull" | "push"): reply is null {
    // (The guard's "true" side means "dealt with"; callers return on it, so only "false" narrows.)
    if (!reply || reply.status >= 500 || reply.status === 404) {
      // 404: the server came back with accounts off, or an old build; keep trying, quietly.
      fail(op);
      return true;
    }
    if (reply.status === 401) {
      halt({ kind: "signin" });
      return true;
    }
    return false;
  }

  async function pull(): Promise<void> {
    lastPull = Date.now();
    const reply = await call("GET", "/api/state");
    if (dead || common(reply, "pull")) return;
    const r = reply;
    if (r.status === 204) {
      // Nothing stored for this account: this device's copy becomes it, if it has any edits.
      adopt(0);
      const local = io.local();
      if (hasTimes(local.updatedAt ?? {})) {
        synced = {};
        return push(local, 1);
      }
      synced = local.updatedAt ?? {};
      return ok();
    }
    const body = r.body as { version?: unknown; bundle?: unknown } | undefined;
    if (r.status !== 200 || !body || !Number.isSafeInteger(body.version)) return fail("pull");
    const res = resolve(io.local(), body.bundle);
    if (res.kind === "unreadable") {
      return halt({
        kind: "offline",
        reason: "The copy on the server could not be read; changes are kept in this browser.",
      });
    }
    if (res.apply) io.apply(res.bundle);
    adopt(Number(body.version));
    if (res.notice) io.setNotice(res.notice);
    if (res.push) {
      synced = {};
      return push(res.bundle, 1);
    }
    synced = res.bundle.updatedAt ?? {};
    ok();
  }

  /**
   * Sends `bundle` on the known version. `bundle` is passed, not read back from the app, because
   * after a merge is applied the app's state has not re-rendered yet: reading it then would send
   * the stale copy on the new version, which is exactly the push that must never happen.
   */
  async function push(bundle: Mergeable, round: number): Promise<void> {
    const reply = await call("PUT", "/api/state", { baseVersion: version, bundle: toWire(bundle) });
    if (dead || common(reply, "push")) return;
    const r = reply;
    const body = r.body as { version?: unknown } | undefined;
    if (r.status === 200 && body && Number.isSafeInteger(body.version)) {
      adopt(Number(body.version));
      synced = bundle.updatedAt ?? {};
      return ok();
    }
    if (r.status === 409) {
      if (round >= MAX_ROUNDS) return fail("pull"); // another device keeps saving; try again later
      const step = onConflict(bundle, r.body);
      if (step.kind === "unreadable") {
        return halt({
          kind: "offline",
          reason: "The copy on the server could not be read; changes are kept in this browser.",
        });
      }
      if (step.apply) io.apply(step.apply);
      if (step.notice) io.setNotice(step.notice);
      if (step.kind === "push") {
        version = step.baseVersion; // recorded once the push lands
        return push(step.bundle, round + 1);
      }
      adopt(step.version);
      synced = step.times;
      return ok();
    }
    if (r.status === 413) {
      return halt({
        kind: "offline",
        reason: "Too big to sync (over 1 MiB); everything is kept in this browser.",
      });
    }
    // 400 or 415: the server refused this copy; resending it will not change that.
    halt({
      kind: "offline",
      reason: "The server refused this copy; everything is kept in this browser.",
    });
  }

  /** Runs one operation now, or after the one in flight. */
  function run(op: "pull" | "push") {
    if (dead || !signedIn || halted) return;
    clearTimeout(timer);
    if (busy) {
      queued = queued === "pull" || op === "pull" ? "pull" : "push";
      return;
    }
    busy = true;
    io.setStatus({ kind: "syncing" });
    const task = op === "pull" ? pull() : push(io.local(), 1);
    void task.finally(() => {
      busy = false;
      const next = queued;
      queued = null;
      if (next) run(next);
      else changed();
    });
  }

  /** The app's change times moved: push after the debounce if the server lacks something. */
  function changed() {
    if (dead || !signedIn || halted || busy || synced === null || attempt > 0) return;
    if (sameTimes(io.local().updatedAt ?? {}, synced)) return;
    clearTimeout(timer);
    timer = setTimeout(() => run("push"), DEBOUNCE_MS);
  }

  async function start() {
    const reply = await call("GET", "/api/me");
    if (dead) return;
    const me = readMe(reply?.status ?? null, reply?.body);
    io.setMe(me);
    signedIn = me.enabled && me.user !== null;
    if (signedIn) run("pull");
  }

  /** Back online or back in view: retry now, or pull what other devices saved meanwhile. */
  function wake() {
    if (dead || !signedIn || halted) return;
    if (attempt > 0) return run(synced === null ? "pull" : "push");
    if (Date.now() - lastPull > REFOCUS_PULL_MS) run("pull");
  }

  return {
    start,
    changed,
    wake,
    stop() {
      dead = true;
      clearTimeout(timer);
    },
  };
}

export function useSync({ data, meta, apply, setVersion }: SyncInput): SyncState {
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ kind: "local" });
  const [notice, setNotice] = useState("");
  // The engine reads the app's latest values through this, kept current after every render.
  const latest = useRef({ data, meta, apply, setVersion });
  const engine = useRef<ReturnType<typeof createEngine> | null>(null);

  useEffect(() => {
    latest.current = { data, meta, apply, setVersion };
  });

  useEffect(() => {
    const e = createEngine({
      local: () => ({ ...latest.current.data, updatedAt: latest.current.meta.updatedAt }),
      version: () => latest.current.meta.version,
      apply: (b) => latest.current.apply(b),
      setVersion: (v) => latest.current.setVersion(v),
      setMe,
      setStatus,
      setNotice,
    });
    engine.current = e;
    void e.start();
    const wake = () => e.wake();
    const onVisible = () => document.visibilityState === "visible" && e.wake();
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      e.stop();
      engine.current = null;
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const key = timesKey(meta.updatedAt);
  useEffect(() => {
    engine.current?.changed();
  }, [key]);

  return {
    me,
    status,
    line: statusLine(me, status),
    notice,
    dismissNotice: () => setNotice(""),
  };
}
