import { describe, expect, it } from "vitest";
import { DEFAULT_PRESETS } from "./presets";
import { exportBundle, parseBundle, newPlan } from "./storage";
import { DEFAULT_BULK_TABLE } from "./timeline";

describe("export / import", () => {
  it("round-trips a bundle", () => {
    const plan = newPlan();
    const text = exportBundle({
      presets: DEFAULT_PRESETS,
      bulkTable: DEFAULT_BULK_TABLE,
      savedPlans: [],
      plan,
    });
    const back = parseBundle(text);
    expect(back.presets).toEqual(DEFAULT_PRESETS);
    expect(back.plan.id).toBe(plan.id);
  });

  it("rejects foreign JSON", () => {
    expect(() => parseBundle('{"hello":1}')).toThrow(/Not a sourdough-planner export/);
  });
});
