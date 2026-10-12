import { describe, expect, it } from "vitest";
import { cloneDoughs } from "../lib/doughs";
import { clonePresets } from "../lib/presets";
import { DEFAULT_UI, isBundleShape, newPlan } from "../lib/storage";
import { DEFAULT_BULK_TABLE } from "../lib/timeline";
import type { Mergeable } from "../lib/sync";
import {
  LOCAL_TEXT,
  OFFLINE_TEXT,
  SIGNIN_TEXT,
  hasTimes,
  onConflict,
  readMe,
  readRemote,
  resolve,
  sameTimes,
  signinNotice,
  statusLine,
  timesKey,
  toWire,
  withoutSignin,
  type Me,
} from "./logic";

const T1 = "2026-10-12T09:00:00.000Z";
const T2 = "2026-10-12T10:00:00.000Z";
const T3 = "2026-10-12T11:00:00.000Z";

function copy(overrides: Partial<Mergeable> = {}): Mergeable {
  return {
    presets: clonePresets(),
    doughs: cloneDoughs(),
    bulkTable: DEFAULT_BULK_TABLE.map((r) => ({ ...r })),
    savedPlans: [],
    plan: newPlan({ id: "plan-1", startTime: T1 }),
    ui: { ...DEFAULT_UI },
    updatedAt: {},
    ...overrides,
  };
}

/** A device's copy with the first preset renamed, as an edit there would leave it. */
function renamed(name: string, at: string, base = copy()): Mergeable {
  const presets = base.presets.map((p, i) => (i === 0 ? { ...p, name } : p));
  return { ...base, presets, updatedAt: { ...base.updatedAt, presets: at } };
}

const SIGNED_IN: Me = { enabled: true, user: { name: "Ben", email: "ben@example.test" } };
const at = () => "21:14";

describe("readMe", () => {
  it("is accounts off unless a 200 says enabled", () => {
    expect(readMe(200, { enabled: false })).toEqual({ enabled: false });
    expect(readMe(404, { enabled: true })).toEqual({ enabled: false });
    expect(readMe(null, undefined)).toEqual({ enabled: false }); // network error
    expect(readMe(200, undefined)).toEqual({ enabled: false }); // index.html from a static host
    expect(readMe(200, [])).toEqual({ enabled: false });
  });

  it("reads signed out and signed in, with either name or email missing", () => {
    expect(readMe(200, { enabled: true })).toEqual({ enabled: true, user: null });
    expect(readMe(200, { enabled: true, user: { name: null, email: "a@b.test" } })).toEqual({
      enabled: true,
      user: { name: null, email: "a@b.test" },
    });
  });
});

describe("statusLine", () => {
  it("says nothing with accounts off, and the §4 strings otherwise", () => {
    expect(statusLine({ enabled: false }, { kind: "local" })).toBe("");
    expect(statusLine(null, { kind: "local" })).toBe("");
    expect(statusLine({ enabled: true, user: null }, { kind: "local" })).toBe(LOCAL_TEXT);
    expect(statusLine(SIGNED_IN, { kind: "synced", at: T1 }, at)).toBe(
      "Signed in as Ben, synced 21:14.",
    );
    expect(statusLine(SIGNED_IN, { kind: "offline" })).toBe(OFFLINE_TEXT);
    expect(statusLine(SIGNED_IN, { kind: "signin" })).toBe(SIGNIN_TEXT);
    expect(statusLine(SIGNED_IN, { kind: "offline", reason: "Too big." })).toBe("Too big.");
  });

  it("names the account by its email when it has no name", () => {
    const me: Me = { enabled: true, user: { name: null, email: "a@b.test" } };
    expect(statusLine(me, { kind: "synced", at: T1 }, at)).toBe(
      "Signed in as a@b.test, synced 21:14.",
    );
  });
});

describe("change times", () => {
  it("compare and key regardless of key order", () => {
    expect(sameTimes({ plan: T1, presets: T2 }, { presets: T2, plan: T1 })).toBe(true);
    expect(sameTimes({ plan: T1 }, { plan: T2 })).toBe(false);
    expect(timesKey({ plan: T1, presets: T2 })).toBe(timesKey({ presets: T2, plan: T1 }));
    expect(hasTimes({})).toBe(false);
    expect(hasTimes({ ui: T1 })).toBe(true);
  });
});

describe("toWire and readRemote", () => {
  it("round-trips a copy as a version-3 bundle the server accepts", () => {
    const mine = renamed("Pizza base", T2);
    const wire = toWire(mine);
    expect(wire.version).toBe(3);
    expect(isBundleShape(wire)).toBe(true);
    const back = readRemote(JSON.parse(JSON.stringify(wire)));
    expect(back?.presets[0]?.name).toBe("Pizza base");
    expect(back?.updatedAt).toEqual({ presets: T2 });
  });

  it("leaves a section the server has no time for untimed, not dated now", () => {
    const wire = toWire(copy({ updatedAt: { plan: T1 } }));
    expect(readRemote(wire)?.updatedAt).toEqual({ plan: T1 });
  });

  it("refuses a document parseBundle would refuse", () => {
    expect(readRemote({ app: "sourdough-planner", version: 4 })).toBeNull();
    expect(readRemote({ ...toWire(copy()), presets: [{ id: 1 }] })).toBeNull();
    expect(readRemote(null)).toBeNull();
  });
});

describe("resolve (a pull)", () => {
  it("takes newer sections from the server and pushes what this device has newer", () => {
    const local = renamed("Mine", T3, copy({ updatedAt: { plan: T1 } }));
    const remotePlan = newPlan({ id: "plan-1", startTime: T2 });
    const remote = toWire({ ...copy(), plan: remotePlan, updatedAt: { plan: T2, presets: T1 } });
    const r = resolve(local, remote);
    if (r.kind !== "merged") throw new Error("expected a merge");
    expect(r.fromLocal).toEqual(["presets"]);
    expect(r.fromRemote).toEqual(["plan"]);
    expect(r.apply).toBe(true);
    expect(r.push).toBe(true);
    expect(r.bundle.presets[0]?.name).toBe("Mine");
    expect(r.bundle.plan.startTime).toBe(T2);
    expect(r.notice).toBe("Merged: presets from this device, plan from the server.");
  });

  it("a fresh device takes the server's copy whole and pushes nothing", () => {
    const remote = toWire(renamed("Theirs", T1));
    const r = resolve(copy(), remote);
    if (r.kind !== "merged") throw new Error("expected a merge");
    expect(r.push).toBe(false);
    expect(r.apply).toBe(true);
    expect(r.bundle.presets[0]?.name).toBe("Theirs");
  });

  it("two copies that agree merge silently", () => {
    const mine = renamed("Same", T1);
    const r = resolve(mine, toWire(mine));
    if (r.kind !== "merged") throw new Error("expected a merge");
    expect([r.apply, r.push, r.notice]).toEqual([false, false, ""]);
  });

  it("never applies a document that fails readBundle", () => {
    expect(resolve(copy(), { app: "other" }).kind).toBe("unreadable");
  });
});

describe("onConflict (a push answered 409)", () => {
  it("pushes the merge on the server's version, never the stale local copy", () => {
    // This device renamed a preset at T3; the other device changed the plan at T2 and saved v7.
    const local = renamed("Mine", T3, copy({ updatedAt: { plan: T1 } }));
    const theirPlan = newPlan({ id: "plan-1", startTime: T2, starterWeight: 400 });
    const body = {
      version: 7,
      updatedAt: T2,
      bundle: toWire({ ...copy(), plan: theirPlan, updatedAt: { plan: T2, presets: T1 } }),
    };
    const step = onConflict(local, body);
    if (step.kind !== "push") throw new Error(`expected a push, got ${step.kind}`);
    expect(step.baseVersion).toBe(7);
    // The other device's plan survives: a blind push of `local` would have sent starterWeight 250.
    expect(step.bundle.plan.starterWeight).toBe(400);
    expect(step.bundle).not.toBe(local);
    expect(step.bundle.presets[0]?.name).toBe("Mine");
    expect(step.bundle.updatedAt).toEqual({ presets: T3, plan: T2 });
    expect(step.apply).toBe(step.bundle); // the app takes the merge first
    expect(step.notice).toBe("Merged: presets from this device, plan from the server.");
  });

  it("the same section on both: the later save wins whole", () => {
    const local = renamed("Mine", T2);
    const body = { version: 3, updatedAt: T3, bundle: toWire(renamed("Theirs", T3)) };
    const step = onConflict(local, body);
    if (step.kind !== "settle") throw new Error(`expected settle, got ${step.kind}`);
    expect(step.version).toBe(3);
    expect(step.apply?.presets[0]?.name).toBe("Theirs");
    expect(step.notice).toBe("Merged: presets from the server.");
  });

  it("an empty server takes this device's copy on the version it gives", () => {
    const local = renamed("Mine", T2);
    const step = onConflict(local, { version: 0, updatedAt: null, bundle: null });
    expect(step).toEqual({ kind: "push", baseVersion: 0, bundle: local, apply: null, notice: "" });
  });

  it("an unreadable answer or document is not merged", () => {
    expect(onConflict(copy(), { version: 2, bundle: { app: "x" } }).kind).toBe("unreadable");
    expect(onConflict(copy(), "nope").kind).toBe("unreadable");
    expect(onConflict(copy(), { version: -1, bundle: null }).kind).toBe("unreadable");
  });
});

describe("the sign-in notice", () => {
  it("reads ?signin= and strips it from the query", () => {
    expect(signinNotice("?signin=denied")).toMatch(/cancelled or refused/);
    expect(signinNotice("?signin=error")).toMatch(/did not complete/);
    expect(signinNotice("?x=1")).toBe("");
    expect(withoutSignin("?signin=denied")).toBe("");
    expect(withoutSignin("?a=1&signin=error")).toBe("?a=1");
  });
});
