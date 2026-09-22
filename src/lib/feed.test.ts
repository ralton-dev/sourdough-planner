import { describe, expect, it } from "vitest";
import { feedAt, feedPlan } from "./feed";

describe("feed helper", () => {
  it("splits a target by ratio", () => {
    expect(feedPlan(300, [1, 1, 1])).toEqual({ seed: 100, flour: 100, water: 100, total: 300 });
    const p = feedPlan(275, [1, 5, 5]);
    expect(p.seed).toBe(25);
    expect(p.flour).toBe(125);
    expect(p.water).toBe(125);
  });

  it("works back from the ready time", () => {
    const ready = new Date("2026-09-22T09:00:00.000Z");
    expect(feedAt(ready, 6).toISOString()).toBe("2026-09-22T03:00:00.000Z");
  });
});
