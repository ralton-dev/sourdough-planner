import { describe, expect, it } from "vitest";
import { batchFromStarter } from "./calc";
import {
  checkRow,
  fmtDuration,
  fmtPct,
  fmtPctRange,
  fmtSalt,
  joinAnd,
  lineLabel,
  roundSalt,
} from "./format";
import { LEAN_DOUGH_ID, type AdditionLine } from "./types";

const REF = {
  starterHydration: 1,
  inoculation: 0.25,
  hydration: 0.75,
  salt: 0.02,
  benchLoss: 0,
  doughTempC: 24,
};

describe("§5.4 rounding", () => {
  it("rounds salt to 1 g or 0.5 g", () => {
    expect(roundSalt(22.5, false)).toBe(23);
    expect(roundSalt(22.5, true)).toBe(22.5);
    expect(fmtSalt(22.5, true)).toBe("22.5 g");
    expect(fmtSalt(22.5, false)).toBe("23 g");
  });

  it("check row sums the displayed ingredients within ±2 g", () => {
    const r = batchFromStarter(250, REF);
    const whole = checkRow(r, false);
    expect(whole.sum).toBe(1000 + 719 + 250 + 23);
    expect(whole.total).toBe(1991);
    expect(whole.ok).toBe(true);
    const half = checkRow(r, true);
    expect(half.sum).toBe(1000 + 719 + 250 + 22.5);
    expect(half.ok).toBe(true);
  });

  it("formats durations", () => {
    expect(fmtDuration(45)).toBe("45 min");
    expect(fmtDuration(120)).toBe("2 h");
    expect(fmtDuration(330)).toBe("5 h 30 min");
  });

  it("rounds a half that floating point lands just short of up, and a real fraction as it is", () => {
    expect(330 * 1.15).toBeLessThan(379.5); // 379.49999999999994
    expect(fmtDuration(330 * 1.15)).toBe("6 h 20 min");
    expect(fmtDuration(379.5)).toBe("6 h 20 min");
    expect(fmtDuration(379.4)).toBe("6 h 19 min");
    // The nudge is a millionth of a minute: 379.4999 is a real fraction under the half.
    expect(fmtDuration(379.4999)).toBe("6 h 19 min");
  });
});

describe("check row per mix", () => {
  const line = (kind: AdditionLine["kind"], grams: number): AdditionLine => ({
    kind,
    label: kind,
    pct: 0,
    grams,
    addAt: "mix",
  });

  /*
   * Worked example B's soft-bun mix, as weighed: flour 463.869, water 62.877, starter 115.967,
   * salt 9.393, milk 182.648, egg 62.622, butter 62.622; total 960.
   */
  const bun = {
    ...batchFromStarter(0, REF),
    addedFlour: 463.869,
    addedWater: 62.877,
    starter: 115.967,
    salt: 9.393,
    totalDough: 960,
    additions: [line("milk", 182.648), line("egg", 62.622), line("butter", 62.622)],
  };

  it("adds the rounded addition lines to the plain ones", () => {
    const whole = checkRow(bun, false);
    expect(whole.sum).toBe(464 + 63 + 116 + 9 + 183 + 63 + 63);
    expect(whole.total).toBe(960);
    expect(whole.ok).toBe(true);
    const half = checkRow(bun, true);
    expect(half.sum).toBe(464 + 63 + 116 + 9.5 + 183 + 63 + 63);
    expect(half.ok).toBe(true);
  });

  it("catches a line the total does not hold", () => {
    const missing = checkRow({ ...bun, additions: bun.additions.slice(0, 2) }, false);
    expect(missing.diff).toBe(-62);
    expect(missing.ok).toBe(false);
  });

  it("allows half a gram of rounding per addition line, and ±2 g without any", () => {
    // Four plain lines that each round up by 0.5: +2 is still rounding.
    const plain = {
      ...batchFromStarter(0, REF),
      addedFlour: 100.5,
      addedWater: 100.5,
      starter: 100.5,
      salt: 1.5,
      totalDough: 303,
    };
    expect(checkRow(plain, false)).toMatchObject({ diff: 2, ok: true });
    expect(checkRow({ ...plain, totalDough: 302 }, false)).toMatchObject({ diff: 3, ok: false });
    // Two addition lines that round up too: +3 is rounding with them in.
    const more = { ...plain, totalDough: 304, additions: [line("milk", 0.5), line("egg", 0.5)] };
    expect(checkRow(more, false)).toMatchObject({ sum: 307, diff: 3, ok: true });
  });
});

describe("percentages (decision 35)", () => {
  /** U+2009 THIN SPACE, between the number and its sign. */
  const THIN = "\u2009";

  it("drops a zero decimal and sets the sign off with a thin space", () => {
    expect(fmtPct(0.65)).toBe(`65${THIN}%`);
    expect(fmtPct(0.75)).toBe(`75${THIN}%`);
    expect(fmtPct(1)).toBe(`100${THIN}%`);
    expect(fmtPct(0.725)).toBe(`72.5${THIN}%`);
    // The number itself does not change: still rounded to one decimal.
    expect(fmtPct(0.7628)).toBe(`76.3${THIN}%`);
    expect(fmtPct(0.74999)).toBe(`75${THIN}%`);
  });

  it("keeps dp as the decimals it rounds to, dropping them only when they are all zero", () => {
    expect(fmtPct(0.7628, 0)).toBe(`76${THIN}%`);
    expect(fmtPct(0.7628, 2)).toBe(`76.28${THIN}%`);
    expect(fmtPct(0.725, 2)).toBe(`72.50${THIN}%`);
    expect(fmtPct(0.75, 2)).toBe(`75${THIN}%`);
  });
});

describe("hint and message helpers", () => {
  it("formats a typical range as the editor hints show it", () => {
    expect(fmtPctRange([0.05, 0.2])).toBe("5–20%");
    expect(fmtPctRange([0, 0.05])).toBe("up to 5%");
    expect(fmtPctRange([0.125, 0.125])).toBe("12.5%");
    expect(fmtPctRange([0.07, 0.1])).toBe("7–10%");
    expect(fmtPctRange([0.0002, 0.0003], " g per 100 g flour")).toBe("0.02–0.03 g per 100 g flour");
  });

  it("joins a list the way a sentence does", () => {
    expect(joinAnd([])).toBe("");
    expect(joinAnd(["egg"])).toBe("egg");
    expect(joinAnd(["egg", "milk"])).toBe("egg and milk");
    expect(joinAnd(["egg", "milk", "butter"])).toBe("egg, milk and butter");
  });

  it("names a line by preset, and by dough when it is not the main one", () => {
    const loaf = { name: "Loaf", presetId: "loaf" };
    expect(
      lineLabel({ ...loaf, key: "loaf", doughId: LEAN_DOUGH_ID, doughName: "Main dough" }),
    ).toBe("Loaf");
    expect(
      lineLabel({
        ...loaf,
        key: "loaf@jalapeno-cheddar",
        doughId: "jalapeno-cheddar",
        doughName: "Jalapeño cheddar",
      }),
    ).toBe("Loaf (Jalapeño cheddar)");
    expect(
      lineLabel({
        ...loaf,
        key: "loaf@gone",
        doughId: LEAN_DOUGH_ID,
        doughName: "Main dough (dough gone not found)",
      }),
    ).toBe("Loaf (dough gone not found)");
    // A later line on a key already taken is keyed #2 and named like the first.
    expect(
      lineLabel({ ...loaf, key: "loaf#2", doughId: LEAN_DOUGH_ID, doughName: "Main dough" }),
    ).toBe("Loaf");
    expect(
      lineLabel({
        ...loaf,
        key: "loaf@gone#3",
        doughId: LEAN_DOUGH_ID,
        doughName: "Main dough (dough gone not found)",
      }),
    ).toBe("Loaf (dough gone not found)");
  });
});
