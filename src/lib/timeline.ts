import type { Plan, Preset, ProofType } from "./types";

export interface BulkRow {
  tempC: number;
  minMinutes: number;
  maxMinutes: number;
}

/** Guide values at 20–25 % inoculation. User-editable; a heuristic, not a clock. */
export const DEFAULT_BULK_TABLE: BulkRow[] = [
  { tempC: 20, minMinutes: 420, maxMinutes: 480 },
  { tempC: 22, minMinutes: 330, maxMinutes: 390 },
  { tempC: 24, minMinutes: 270, maxMinutes: 330 },
  { tempC: 26, minMinutes: 210, maxMinutes: 270 },
];

export interface BulkEstimate {
  minMinutes: number;
  maxMinutes: number;
  /** Multiplier applied for inoculation outside 20–25 %. 1 inside the band. */
  factor: number;
}

/**
 * Linear interpolation on temperature, clamped to the table's ends, then scaled
 * ~2 % per percentage point of inoculation outside 20–25 % (≈15 % longer at 15 %).
 */
export function bulkEstimate(tempC: number, inoculation: number, table: BulkRow[]): BulkEstimate {
  const rows = [...table].filter((r) => Number.isFinite(r.tempC)).sort((a, b) => a.tempC - b.tempC);
  if (rows.length === 0) return { minMinutes: 0, maxMinutes: 0, factor: 1 };
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  let min: number;
  let max: number;
  if (tempC <= first.tempC) {
    min = first.minMinutes;
    max = first.maxMinutes;
  } else if (tempC >= last.tempC) {
    min = last.minMinutes;
    max = last.maxMinutes;
  } else {
    let lo = first;
    let hi = last;
    for (let i = 0; i < rows.length - 1; i++) {
      if (tempC >= rows[i]!.tempC && tempC <= rows[i + 1]!.tempC) {
        lo = rows[i]!;
        hi = rows[i + 1]!;
        break;
      }
    }
    const t = hi.tempC === lo.tempC ? 0 : (tempC - lo.tempC) / (hi.tempC - lo.tempC);
    min = lo.minMinutes + t * (hi.minMinutes - lo.minMinutes);
    max = lo.maxMinutes + t * (hi.maxMinutes - lo.maxMinutes);
  }
  let factor = 1;
  if (inoculation < 0.2) factor = 1 + (0.2 - inoculation) * 100 * 0.02;
  else if (inoculation > 0.25) factor = 1 - (inoculation - 0.25) * 100 * 0.02;
  factor = Math.min(2, Math.max(0.5, factor));
  return { minMinutes: min * factor, maxMinutes: max * factor, factor };
}

export interface TimelineStep {
  id: string;
  label: string;
  start: Date;
  end: Date;
  minutes: number;
  defaultMinutes: number;
  note?: string;
}

export interface Lane {
  presetId: string;
  name: string;
  icon?: string;
  proof: ProofType;
  steps: TimelineStep[];
  /** Earliest and latest sensible bake start given the preset's proof range. */
  bakeWindow: { earliest: Date; latest: Date };
  bakeTempC: number;
  steam: boolean;
}

export interface Timeline {
  steps: TimelineStep[];
  /** Stretch-and-fold moments during bulk. */
  folds: Date[];
  lanes: Lane[];
  ovenWarnings: string[];
  bulk: BulkEstimate & { usedMinutes: number };
  end: Date;
}

export const FOLD_COUNT = 4;
export const FOLD_INTERVAL_MIN = 30;

const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/** §7 — the whole schedule from the start time. Pure; overrides cascade naturally. */
export function buildTimeline(plan: Plan, presets: Preset[], table: BulkRow[]): Timeline {
  const ov = plan.timelineOverrides ?? {};
  const dur = (id: string, def: number) => {
    const v = ov[id];
    return v !== undefined && Number.isFinite(v) && v >= 0 ? v : def;
  };
  const est = bulkEstimate(plan.settings.doughTempC, plan.settings.inoculation, table);
  const bulkDefault = Math.round((est.minMinutes + est.maxMinutes) / 2);

  const steps: TimelineStep[] = [];
  let cursor = new Date(plan.startTime);
  if (Number.isNaN(cursor.getTime())) cursor = new Date();
  const push = (id: string, label: string, def: number, note?: string) => {
    const minutes = dur(id, def);
    const step: TimelineStep = {
      id,
      label,
      start: cursor,
      end: addMin(cursor, minutes),
      minutes,
      defaultMinutes: def,
      note,
    };
    steps.push(step);
    cursor = step.end;
    return step;
  };

  if (plan.feedStarter) push("feed", "Feed starter", 360, "4–8 h until it peaks, then mix.");
  if (plan.autolyse) push("autolyse", "Autolyse", 45, "Flour plus most of the water. Rest.");
  push("mix", "Mix", 10, "Add starter and salt. Reserve ~20 g water for the salt.");
  const bulk = push(
    "bulk",
    "Bulk ferment",
    bulkDefault,
    "Target a 50–75 % rise, domed and jiggly. The clock is a guide.",
  );
  push("divide", "Divide & pre-shape", 15, "Weigh each piece from the division card.");
  const bench = push("bench", "Bench rest", 25);

  const folds: Date[] = [];
  for (let i = 1; i <= FOLD_COUNT; i++) {
    const t = addMin(bulk.start, i * FOLD_INTERVAL_MIN);
    if (t <= bulk.end) folds.push(t);
  }

  const lanes: Lane[] = [];
  for (const sel of plan.items) {
    const p = presets.find((x) => x.id === sel.presetId);
    if (!p || !(sel.count > 0) || lanes.some((l) => l.presetId === p.id)) continue;
    const laneSteps: TimelineStep[] = [];
    let c = bench.end;
    const lanePush = (id: string, label: string, def: number, note?: string) => {
      const minutes = dur(id, def);
      const step: TimelineStep = {
        id,
        label,
        start: c,
        end: addMin(c, minutes),
        minutes,
        defaultMinutes: def,
        note,
      };
      laneSteps.push(step);
      c = step.end;
      return step;
    };
    lanePush(`shape:${p.id}`, "Shape", 10, p.note);
    const proofLabel =
      p.proof === "cold"
        ? "Cold retard"
        : p.proof === "either"
          ? "Proof (room or fridge)"
          : "Proof";
    const shapeEnd = c;
    lanePush(`proof:${p.id}`, proofLabel, p.proofMinutes[0]);
    lanePush(
      `bake:${p.id}`,
      "Bake",
      p.bake.minutes[1],
      `${p.bake.tempC} °C, ${p.bake.minutes[0]}–${p.bake.minutes[1]} min${p.bake.steam ? ", steam" : ""}`,
    );
    lanes.push({
      presetId: p.id,
      name: p.name,
      icon: p.icon,
      proof: p.proof,
      steps: laneSteps,
      bakeWindow: {
        earliest: addMin(shapeEnd, p.proofMinutes[0]),
        latest: addMin(shapeEnd, p.proofMinutes[1]),
      },
      bakeTempC: p.bake.tempC,
      steam: p.bake.steam,
    });
  }

  const end = lanes.reduce(
    (latest, l) => (c(l).getTime() > latest.getTime() ? c(l) : latest),
    bench.end,
  );

  return {
    steps,
    folds,
    lanes,
    ovenWarnings: ovenConflicts(lanes),
    bulk: { ...est, usedMinutes: bulk.minutes },
    end,
  };

  function c(l: Lane): Date {
    return l.steps[l.steps.length - 1]?.end ?? bench.end;
  }
}

function bakeStep(l: Lane): TimelineStep | undefined {
  return l.steps.find((s) => s.id.startsWith("bake:"));
}

/** Overlapping bake slots. Suggests shortest bake first; cold-retarded items last. */
export function ovenConflicts(lanes: Lane[]): string[] {
  const out: string[] = [];
  const withBake = lanes.filter((l) => bakeStep(l));
  const clashing = new Set<Lane>();
  for (let i = 0; i < withBake.length; i++) {
    for (let j = i + 1; j < withBake.length; j++) {
      const a = bakeStep(withBake[i]!)!;
      const b = bakeStep(withBake[j]!)!;
      if (a.start < b.end && b.start < a.end) {
        clashing.add(withBake[i]!);
        clashing.add(withBake[j]!);
      }
    }
  }
  if (clashing.size === 0) return out;
  const order = [...clashing].sort((a, b) => {
    const coldA = a.proof === "cold" ? 1 : 0;
    const coldB = b.proof === "cold" ? 1 : 0;
    if (coldA !== coldB) return coldA - coldB;
    return bakeStep(a)!.minutes - bakeStep(b)!.minutes;
  });
  const first = order[0]!;
  let t = bakeStep(first)!.start;
  const seq = order.map((l) => {
    const s = bakeStep(l)!;
    const start = t;
    t = addMin(t, s.minutes);
    return `${l.name} ${fmtHM(start)}–${fmtHM(t)}`;
  });
  out.push(
    `Oven clash: ${order.map((l) => l.name).join(", ")} need the oven at the same time. Suggested order: ${seq.join(", then ")}.`,
  );
  return out;
}

function fmtHM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
