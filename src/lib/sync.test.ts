import { describe, expect, it } from "vitest";
import { V3_BUNDLE } from "./bundle.fixtures";
import {
  exportBundle,
  isBundleShape,
  parseBundle,
  readBundle,
  type ImportedBundle,
} from "./storage";
import {
  SECTIONS,
  describeMerge,
  mergeBundles,
  nextBackoff,
  type Section,
  type SectionTimes,
} from "./sync";

/** One device's copy: the fixture with each section made distinct by `tag`, stamped as given. */
const copy = (tag: string, updatedAt: SectionTimes): ImportedBundle => {
  const b = readBundle(V3_BUNDLE, "2026-10-12T00:00:00.000Z");
  return {
    ...b,
    presets: b.presets.map((p) => ({ ...p, name: `${p.name} ${tag}` })),
    doughs: [{ id: `d-${tag}`, name: tag, method: "auto", enrichments: [], inclusions: [] }],
    bulkTable: [{ tempC: 24, minMinutes: 270, maxMinutes: tag.length * 100 }],
    savedPlans: [{ id: `s-${tag}`, name: tag, savedAt: "2026-10-12T00:00:00.000Z", plan: b.plan }],
    plan: { ...b.plan, name: tag },
    ui: { halfGramSalt: tag === "local" },
    updatedAt,
  };
};

/** Every section at `at`, then `patch`. */
const at = (time: string, patch: SectionTimes = {}): SectionTimes => ({
  ...Object.fromEntries(SECTIONS.map((s) => [s, time])),
  ...patch,
});

const T = (hhmmss: string) => `2026-10-12T${hhmmss}.000Z`;

/** Which side each section of a merged bundle came from. */
const sides = (merged: ImportedBundle) =>
  Object.fromEntries(SECTIONS.map((s) => [s, sideOf(merged, s)]));
const sideOf = (merged: ImportedBundle, s: Section) =>
  JSON.stringify(merged[s]) === JSON.stringify(copy("local", {})[s]) ? "local" : "remote";

describe("mergeBundles (decision 45)", () => {
  it("takes every section from this device when all of it is newer", () => {
    const local = copy("local", at(T("12:00:00")));
    const remote = copy("remote", at(T("11:00:00")));
    const r = mergeBundles(local, remote);
    expect(r.fromLocal).toEqual([...SECTIONS]);
    expect(r.fromRemote).toEqual([]);
    for (const s of SECTIONS) expect(r.bundle[s]).toEqual(local[s]);
    expect(r.bundle.updatedAt).toEqual(local.updatedAt);
  });

  it("takes every section from the server when all of it is newer", () => {
    const local = copy("local", at(T("11:00:00")));
    const remote = copy("remote", at(T("12:00:00")));
    const r = mergeBundles(local, remote);
    expect(r.fromLocal).toEqual([]);
    expect(r.fromRemote).toEqual([...SECTIONS]);
    for (const s of SECTIONS) expect(r.bundle[s]).toEqual(remote[s]);
  });

  it("mixes, section by section, and keeps the winning time", () => {
    const local = copy("local", at(T("11:00:00"), { presets: T("12:00:00"), ui: T("12:30:00") }));
    const remote = copy("remote", at(T("11:30:00"), { presets: T("11:59:59") }));
    const r = mergeBundles(local, remote);
    expect(r.fromLocal).toEqual(["presets", "ui"]);
    expect(r.fromRemote).toEqual(["doughs", "bulkTable", "savedPlans", "plan"]);
    expect(sides(r.bundle)).toMatchObject({ presets: "local", ui: "local", plan: "remote" });
    expect(r.bundle.updatedAt).toEqual(
      at(T("11:30:00"), { presets: T("12:00:00"), ui: T("12:30:00") }),
    );
  });

  it("gives a tie to the server", () => {
    const local = copy("local", at(T("12:00:00")));
    const remote = copy("remote", at(T("12:00:00")));
    const r = mergeBundles(local, remote);
    for (const s of SECTIONS) expect(r.bundle[s]).toEqual(remote[s]);
    // The copies differ, so this device takes the server's and says so.
    expect(r.fromRemote).toEqual([...SECTIONS]);
    expect(r.fromLocal).toEqual([]);
  });

  it("says nothing about sections that already agree, whatever their times", () => {
    const local = copy("same", at(T("12:00:00"), { plan: T("13:00:00") }));
    const remote = { ...copy("same", at(T("11:00:00"))), plan: { ...local.plan, name: "other" } };
    const r = mergeBundles(local, remote);
    expect(r.fromLocal).toEqual(["plan"]);
    expect(r.fromRemote).toEqual([]);
    expect(r.bundle.presets).toEqual(local.presets);
  });

  it("counts a side with no time for a section as oldest", () => {
    const local = copy("local", { presets: T("00:00:01") });
    const remote = copy("remote", at(T("12:00:00"), { presets: undefined, doughs: "not a time" }));
    const r = mergeBundles(local, remote);
    expect(r.fromLocal).toEqual(["presets"]);
    // Doughs: remote's time is unreadable and local has none, so both are oldest: a tie, remote.
    expect(r.fromRemote).toEqual(["doughs", "bulkTable", "savedPlans", "plan", "ui"]);
    expect(r.bundle.updatedAt).toEqual({
      presets: T("00:00:01"),
      doughs: "not a time",
      bulkTable: T("12:00:00"),
      savedPlans: T("12:00:00"),
      plan: T("12:00:00"),
      ui: T("12:00:00"),
    });
  });

  it("merges two bundles with no times at all to the server's", () => {
    const local = copy("local", {});
    const remote = { ...copy("remote", {}), updatedAt: undefined } as unknown as ImportedBundle;
    const r = mergeBundles(local, remote);
    for (const s of SECTIONS) expect(r.bundle[s]).toEqual(remote[s]);
    expect(r.bundle.updatedAt).toEqual({});
  });

  it("handles three sections changed in one minute on each side", () => {
    const base = at(T("08:00:00"));
    const local = copy("local", {
      ...base,
      presets: T("12:00:10"),
      doughs: T("12:00:30"),
      plan: T("12:00:50"),
    });
    const remote = copy("remote", {
      ...base,
      doughs: T("12:00:20"),
      savedPlans: T("12:00:40"),
      plan: T("12:00:45"),
    });
    const r = mergeBundles(local, remote);
    expect(r.fromLocal).toEqual(["presets", "doughs", "plan"]);
    // Bulk table and settings: both at 08:00, a tie, and the copies differ: the server's.
    expect(r.fromRemote).toEqual(["bulkTable", "savedPlans", "ui"]);
    expect(describeMerge(r)).toBe(
      "Merged: presets, doughs and plan from this device, bulk table, saved plans and settings from the server.",
    );
  });

  it("is deterministic with clocks ten minutes apart: newer by the devices' own clocks", () => {
    // This device's clock runs ten minutes fast. It edited the plan at 12:00 real time (stamped
    // 12:10); the other device edited it at 12:05 real time (stamped 12:05). By the stamps, this
    // device is newer, and the merge says so on every run, whichever side is asked first.
    const local = copy("local", at(T("09:00:00"), { plan: T("12:10:00") }));
    const remote = copy("remote", at(T("09:00:00"), { plan: T("12:05:00") }));
    const first = mergeBundles(local, remote);
    expect(first.fromLocal).toEqual(["plan"]);
    expect(first.bundle.plan).toEqual(local.plan);
    expect(mergeBundles(local, remote)).toEqual(first);
    // Asked from the other device, the same plan wins.
    const swapped = mergeBundles(remote, local);
    expect(swapped.bundle.plan).toEqual(local.plan);
    expect(swapped.fromRemote).toContain("plan");
  });

  it("does not change its inputs, and keeps the server's envelope", () => {
    const local = copy("local", at(T("12:00:00")));
    const remote = { ...copy("remote", at(T("11:00:00"))), exportedAt: "remote-envelope" };
    const before = JSON.stringify([local, remote]);
    const r = mergeBundles(local, remote);
    expect(JSON.stringify([local, remote])).toBe(before);
    expect(r.bundle.exportedAt).toBe("remote-envelope");
    expect(r.bundle).not.toBe(remote);
  });
});

describe("a 1 MiB bundle (§9)", () => {
  it("exports, passes the shape check, parses and merges whole", () => {
    const local = copy("local", at(T("12:00:00"), { savedPlans: T("13:00:00") }));
    const plans = Array.from({ length: 1500 }, (_, i) => ({
      id: `s-${i}`,
      name: `Saved ${i}`,
      savedAt: T("12:00:00"),
      plan: { ...local.plan, name: `Saved ${i}` },
    }));
    const big = { ...local, savedPlans: plans };
    const text = exportBundle(big, T("13:00:00"));
    expect(text.length).toBeGreaterThan(1024 * 1024);
    expect(isBundleShape(JSON.parse(text))).toBe(true);
    const back = parseBundle(text, T("14:00:00"));
    expect(back.savedPlans).toHaveLength(1500);
    const r = mergeBundles(back, copy("remote", at(T("12:30:00"))));
    expect(r.bundle.savedPlans).toHaveLength(1500);
    expect(r.fromLocal).toEqual(["savedPlans"]);
  });
});

describe("nextBackoff (decision 46)", () => {
  it("waits 5 s, 30 s, 2 min, then every 5 min", () => {
    expect([1, 2, 3, 4, 5, 50].map(nextBackoff)).toEqual([
      5_000, 30_000, 120_000, 300_000, 300_000, 300_000,
    ]);
  });

  it("reads anything below the first attempt as the first", () => {
    expect([0, -3, Number.NaN, 1.7].map(nextBackoff)).toEqual([5_000, 5_000, 5_000, 5_000]);
  });
});

describe("describeMerge", () => {
  it("names the sections in plain words, this device first", () => {
    expect(describeMerge({ fromLocal: ["presets", "doughs"], fromRemote: ["savedPlans"] })).toBe(
      "Merged: presets and doughs from this device, saved plans from the server.",
    );
  });

  it("names one side alone", () => {
    expect(describeMerge({ fromLocal: ["bulkTable"], fromRemote: [] })).toBe(
      "Merged: bulk table from this device.",
    );
    expect(describeMerge({ fromLocal: [], fromRemote: ["ui", "plan"] })).toBe(
      "Merged: settings and plan from the server.",
    );
  });

  it("is empty when nothing came from either side", () => {
    expect(describeMerge({ fromLocal: [], fromRemote: [] })).toBe("");
  });
});
