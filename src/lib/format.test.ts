import { describe, expect, it } from "vitest";
import { batchFromStarter } from "./calc";
import { checkRow, fmtDuration, fmtSalt, roundSalt } from "./format";

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
});
