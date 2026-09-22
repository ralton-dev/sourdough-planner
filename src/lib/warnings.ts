import type { AllocationLine, Ingredients, Plan, PlanWarning, Preset } from "./types";

export interface WarningInput extends Ingredients {
  allocation: AllocationLine[];
  spareOrShort: number;
  inoculationForAvailable?: number;
}

const pct = (f: number) => `${Math.round(f * 1000) / 10}%`;

/** §8 — soft validation. Never blocks; the plan still computes. */
export function collectWarnings(plan: Plan, presets: Preset[], r: WarningInput): PlanWarning[] {
  const out: PlanWarning[] = [];
  const s = plan.settings;

  const sensitive = r.allocation.filter(
    (l) => presets.find((p) => p.id === l.presetId)?.hydrationSensitive,
  );
  if (r.trueHydration > 0.8 && sensitive.length > 0) {
    const names = [...new Set(sensitive.map((l) => l.name.toLowerCase()))].join(" and ");
    out.push({
      level: "warn",
      code: "high-hydration",
      message: `High hydration (${pct(r.trueHydration)}) — ${names} will be slack to shape.`,
    });
  }

  if (s.inoculation < 0.1 || s.inoculation > 0.35) {
    out.push({
      level: "warn",
      code: "inoculation-range",
      message: `Inoculation ${pct(s.inoculation)} is outside the typical 10–35% range.`,
    });
  }

  if (s.salt < 0.018 || s.salt > 0.025) {
    out.push({
      level: "info",
      code: "salt-range",
      message: `Salt ${pct(s.salt)} is outside the usual 1.8–2.5%.`,
    });
  }

  for (const l of r.allocation) {
    if (l.belowMin) {
      const p = presets.find((x) => x.id === l.presetId);
      out.push({
        level: "warn",
        code: "below-min",
        message: `${l.name} at ${Math.round(l.weightEach)} g is below its ${p?.minWeight ?? "?"} g minimum. Drop a piece, unpin it, or lower the minimum in presets.`,
      });
    }
  }

  if (plan.mode === "starter" && r.spareOrShort < 0) {
    out.push({
      level: "warn",
      code: "short",
      message: `Not enough dough: short by ${Math.round(-r.spareOrShort)} g after every flex item hit its minimum.`,
    });
  }

  if (
    plan.mode === "items" &&
    plan.starterAvailable !== undefined &&
    plan.starterAvailable > 0 &&
    r.starter > plan.starterAvailable + 0.5
  ) {
    const alt = r.inoculationForAvailable;
    const remedy =
      alt !== undefined && Number.isFinite(alt) && alt > 0
        ? ` Drop inoculation to ${pct(alt)} to use what you have; a lower inoculation lengthens bulk fermentation.`
        : "";
    out.push({
      level: "warn",
      code: "starter-short",
      message: `This batch needs ${Math.round(r.starter)} g starter but only ${Math.round(plan.starterAvailable)} g is available.${remedy}`,
    });
  }

  return out;
}
