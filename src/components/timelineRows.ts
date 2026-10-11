import type { Timeline } from "../lib/timeline";

// PLAN-redesign §3: the In order model. R1 ships the types and a stub; R4 implements it.

export interface TimelineRow {
  /** A step row keeps its step id (so lengths stay editable and overrides apply); a fold row is
   *  `fold:<n>@<doughId>`; a merged row joins its ids with "+" in track order. */
  id: string;
  kind: "step" | "fold";
  start: Date;
  end: Date;
  minutes: number;
  /** From the step; a fixed step has no length of its own (decision 24 keeps the lib's flag). */
  fixed?: boolean;
  defaultMinutes?: number;
  label: string; // the step's label; "Fold 2" for folds, numbered from that dough's bulk start
  note?: string;
  /** Every dough on the row, track order; colour 0 is the main dough (decision 26). */
  doughs: { doughId: string; name: string; icon?: string; colour: number }[];
  /** Ids of hands-on rows (a step with minutes > 0 that is not a bulk and not fixed) whose span
   *  intersects this row's, excluding itself. Empty for most rows. */
  overlaps: string[];
  /** Doughs whose bulk is running at this row's start, for the gutter rails. */
  rails: string[];
}
export interface TimelineRows {
  /** false for a lean plan: one base track and nothing else (decision 24). */
  multi: boolean;
  rows: TimelineRow[];
  /** When `lanes` was asked for: shape/proof/bake rows tagged by `lane.label`, merged in. */
}

/**
 * Every step and fold of every dough as one list in clock order (decision 24). A stub that returns
 * nothing, so the pins in `timelineRows.test.ts` fail on content until R4 implements §3.
 */
export const timelineRows: (
  timeline: Timeline,
  opts?: { lanes?: boolean },
) => TimelineRows = () => ({ multi: false, rows: [] });
