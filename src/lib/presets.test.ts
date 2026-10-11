import { describe, expect, it } from "vitest";
import { DEFAULT_DOUGHS, cloneDoughs } from "./doughs";
import { DEFAULT_PRESETS, LEGACY_PRESETS, clonePresets, reconcileDefaults } from "./presets";
import { LEAN_DOUGH_ID, type Dough, type Preset } from "./types";

const find = <T extends { id: string }>(list: readonly T[], id: string): T => {
  const hit = list.find((x) => x.id === id);
  if (!hit) throw new Error(`${id} is not in the list`);
  return hit;
};
const ids = (list: readonly { id: string }[]) => list.map((x) => x.id);

/** A list stored before this release: the legacy defaults, as JSON hands them back. */
const storedBefore = (): Preset[] => JSON.parse(JSON.stringify(LEGACY_PRESETS)) as Preset[];
/** What `loadAll` does for a browser from before the seeded-ids record. */
const reconcile = (stored: Preset[]) =>
  reconcileDefaults(stored, clonePresets(DEFAULT_PRESETS), LEGACY_PRESETS);

const OLD_IDS = ["roll", "loaf", "pizza", "baguette", "focaccia"];
const NEW_IDS = ["dinner-roll", "burger-bun", "hot-dog-bun"];

describe("default presets (§6, R1)", () => {
  it("makes roll a 100 g lean bread roll", () => {
    const roll = find(DEFAULT_PRESETS, "roll");
    expect(roll).toMatchObject({ name: "Bread roll", defaultWeight: 100, minWeight: 70 });
    expect(roll.maxWeight).toBe(140);
    expect(roll.doughId).toBeUndefined();
  });

  it("sizes the burger bun at 100 g or more, on soft-bun", () => {
    const bun = find(DEFAULT_PRESETS, "burger-bun");
    expect(bun.defaultWeight).toBeGreaterThanOrEqual(100);
    expect(bun.doughId).toBe("soft-bun");
  });

  it("carries the §6 rows", () => {
    const soft = { flexPriority: 0, proof: "room", proofMinutes: [120, 240], doughId: "soft-bun" };
    const rows: Record<string, Partial<Preset>> = {
      roll: {
        icon: "🥐",
        flexPriority: 0,
        proof: "room",
        proofMinutes: [60, 90],
        bake: { tempC: 220, minutes: [18, 22], steam: true },
        note: "Bap size. Tight pre-shape; proofs fastest; bake first. Steam 8 min.",
      },
      "dinner-roll": {
        ...(soft as Partial<Preset>),
        name: "Dinner roll",
        defaultWeight: 70,
        minWeight: 50,
        maxWeight: 90,
        bake: { tempC: 190, minutes: [20, 24], steam: false },
        note: "Pan, touching. Egg wash. 88–93 °C inside.",
      },
      "burger-bun": {
        ...(soft as Partial<Preset>),
        name: "Burger bun",
        icon: "🍔",
        defaultWeight: 120,
        minWeight: 90,
        maxWeight: 150,
        bake: { tempC: 190, minutes: [18, 22], steam: false },
        note: "Flatten after shaping. Egg wash, sesame. 88–93 °C inside.",
      },
      "hot-dog-bun": {
        ...(soft as Partial<Preset>),
        name: "Hot dog bun",
        icon: "🌭",
        defaultWeight: 90,
        minWeight: 70,
        maxWeight: 110,
        bake: { tempC: 190, minutes: [18, 20], steam: false },
        note: "15 cm logs, almost touching. Egg wash.",
      },
    };
    for (const [id, row] of Object.entries(rows))
      expect(find(DEFAULT_PRESETS, id)).toMatchObject(row);
  });

  it("lists them in §6 order and leaves loaf, pizza, baguette and focaccia as shipped", () => {
    expect(ids(DEFAULT_PRESETS)).toEqual([
      "roll",
      ...NEW_IDS,
      "loaf",
      "pizza",
      "baguette",
      "focaccia",
    ]);
    for (const id of ["loaf", "pizza", "baguette", "focaccia"]) {
      expect(find(DEFAULT_PRESETS, id)).toEqual(find(LEGACY_PRESETS, id));
    }
  });

  it("puts every preset on lean or a seeded dough, each id once", () => {
    const known = new Set([LEAN_DOUGH_ID, ...ids(DEFAULT_DOUGHS)]);
    for (const p of DEFAULT_PRESETS) expect(known.has(p.doughId ?? LEAN_DOUGH_ID)).toBe(true);
    expect(new Set(ids(DEFAULT_PRESETS)).size).toBe(DEFAULT_PRESETS.length);
  });

  it("keeps the shipped list as legacy, roll at 70 g", () => {
    expect(ids(LEGACY_PRESETS)).toEqual(OLD_IDS);
    expect(find(LEGACY_PRESETS, "roll")).toMatchObject({ name: "Roll", defaultWeight: 70 });
  });
});

describe("reconcileDefaults (decision 14)", () => {
  it("leaves an edited roll alone, whatever the edit", () => {
    const edits: ((p: Preset) => void)[] = [
      (p) => (p.defaultWeight = 85),
      (p) => (p.note = "Mine."),
      (p) => (p.icon = ""),
      (p) => (p.hydrationSensitive = false),
      (p) => (p.bake.minutes = [18, 20]),
      (p) => (p.doughId = "soft-bun"),
    ];
    for (const edit of edits) {
      const stored = storedBefore();
      const roll = find(stored, "roll");
      edit(roll);
      const kept = structuredClone(roll);
      const out = reconcile(stored);
      expect(find(out, "roll")).toBe(roll);
      expect(roll).toEqual(kept);
      expect(ids(out)).toEqual([...OLD_IDS, ...NEW_IDS]);
    }
  });

  it("replaces a roll still deep-equal to the legacy default, in place", () => {
    const out = reconcile(storedBefore());
    expect(out[0]).toEqual(find(DEFAULT_PRESETS, "roll"));
  });

  it("reads key order and keys left undefined the way JSON does", () => {
    const legacy = find(LEGACY_PRESETS, "roll");
    const reordered = Object.fromEntries(
      Object.entries({ ...legacy, bake: { steam: true, minutes: [18, 22], tempC: 220 } }).reverse(),
    ) as unknown as Preset;
    const withUndefined: Preset = { ...legacy, doughId: undefined };
    expect(reconcile([reordered])[0]).toEqual(find(DEFAULT_PRESETS, "roll"));
    expect(reconcile([withUndefined])[0]).toEqual(find(DEFAULT_PRESETS, "roll"));
  });

  it("appends the new presets after the stored ones, in default order", () => {
    expect(ids(reconcile(storedBefore()))).toEqual([...OLD_IDS, ...NEW_IDS]);
  });

  it("keeps the user's order and the presets they added", () => {
    const stored = storedBefore();
    const mine: Preset = { ...find(stored, "loaf"), id: "preset-mine", name: "Sandwich tin" };
    const order = ["focaccia", "roll", "loaf", "pizza", "baguette"].map((id) => find(stored, id));
    const out = reconcile([order[0]!, mine, ...order.slice(1)]);
    expect(ids(out)).toEqual([
      "focaccia",
      "preset-mine",
      "roll",
      "loaf",
      "pizza",
      "baguette",
      ...NEW_IDS,
    ]);
    expect(find(out, "preset-mine")).toBe(mine);
  });

  it("leaves a deleted default deleted, old or new", () => {
    const withoutFocaccia = storedBefore().filter((p) => p.id !== "focaccia");
    expect(ids(reconcile(withoutFocaccia))).toEqual([
      "roll",
      "loaf",
      "pizza",
      "baguette",
      ...NEW_IDS,
    ]);
    // Once a browser has been given the new presets, deleting one sticks as well.
    const given = [...LEGACY_PRESETS, ...DEFAULT_PRESETS];
    const withoutHotDog = clonePresets(DEFAULT_PRESETS).filter((p) => p.id !== "hot-dog-bun");
    const out = reconcileDefaults(withoutHotDog, clonePresets(DEFAULT_PRESETS), given);
    expect(ids(out)).not.toContain("hot-dog-bun");
    expect(reconcileDefaults([], clonePresets(DEFAULT_PRESETS), given)).toEqual([]);
  });

  it("changes nothing on a list it has already reconciled", () => {
    const once = reconcile(storedBefore());
    const twice = reconcile(once);
    expect(twice).toHaveLength(once.length);
    twice.forEach((p, i) => expect(p).toBe(once[i]));
  });

  it("keeps a stored entry whose default has gone", () => {
    const defaults = clonePresets(DEFAULT_PRESETS).filter((p) => p.id !== "pizza");
    const out = reconcileDefaults(storedBefore(), defaults, LEGACY_PRESETS);
    expect(find(out, "pizza")).toEqual(find(LEGACY_PRESETS, "pizza"));
  });

  it("works on any id-keyed list: doughs", () => {
    const stored: Dough[] = cloneDoughs().filter((d) => d.id !== "seeded");
    stored[0]!.notes = "Less butter next time.";
    // With nothing given before, a missing default is new and is appended.
    const fresh = reconcileDefaults(stored, cloneDoughs(), []);
    expect(ids(fresh)).toEqual([...ids(stored), "seeded"]);
    expect(fresh[0]!.notes).toBe("Less butter next time.");
    // Given the current library already, the deletion stands.
    expect(ids(reconcileDefaults(stored, cloneDoughs(), DEFAULT_DOUGHS))).toEqual(ids(stored));
  });
});
