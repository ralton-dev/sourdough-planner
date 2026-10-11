import {
  FOLD_INTERVAL_MIN,
  type DoughTrack,
  type Timeline,
  type TimelineStep,
} from "../lib/timeline";
import { LEAN_DOUGH_ID } from "../lib/types";

// PLAN-redesign §3: the In order model. Pure, so the card (R4) and kitchen mode (R5) read the
// same list; `timelineRows.test.ts` pins it against buildTimeline.

/** A dough on a row: its name, icon and colour (decision 26: 0 is the main dough, 1–5 the rest). */
export interface DoughTag {
  doughId: string;
  name: string;
  icon?: string;
  colour: number;
}

export interface TimelineRow {
  /** A step row keeps its step id (so lengths stay editable and overrides apply); a fold row is
   *  `fold:<n>@<doughId>`; a merged row joins its ids with "+" in track order. */
  id: string;
  kind: "step" | "fold";
  start: Date;
  end: Date;
  minutes: number;
  /** From the step; a fixed step has no length of its own (decision 24 keeps the lib's flag). A
   *  merged row is fixed when any of its steps is. */
  fixed?: boolean;
  /** From the step; a merged row's when its steps share one, else none. */
  defaultMinutes?: number;
  label: string; // the step's label; "Fold 2" for folds, numbered from that dough's bulk start
  /** The step's note. A merged row whose steps say different things carries each one on its own
   *  line ("\n"), led by the name of the dough or item it is for: "Pizza: Ball tightly…". */
  note?: string;
  /** Every dough on the row, track order; colour 0 is the main dough (decision 26). A lane row's
   *  tag is named by the lane (`lane.label`). The starter feed is for every dough and has none. */
  doughs: DoughTag[];
  /** Ids of other hands-on spans that intersect this row's span, and only on hands-on rows:
   *  mix, split, divide, shape and the tangzhong cook. Bulks (fixed or not), feeds, autolyse,
   *  proofs, bench rests and bakes are not hands-on, and folds are moments, so none of those
   *  carry or cause an overlap. Empty for most rows. */
  overlaps: string[];
  /** Doughs whose bulk is running at this row's start, for the gutter rails. */
  rails: string[];
}
export interface TimelineRows {
  /** false for a lean plan: one base track and nothing else (decision 24). */
  multi: boolean;
  rows: TimelineRow[];
  /** When `lanes` was asked for: shape/proof/bake rows merged in; a lane row's tag carries
   *  `name: lane.label` ("Loaf (Jalapeño cheddar)"), `doughId: lane.doughId` and that dough's
   *  colour, so two lanes shaping at the same minute merge into one row with two tags. */
}

/** "Main dough" for the base track, as its mix is labelled; any other dough by its own name. */
export function trackTitle(track: DoughTrack): string {
  return track.method === "base" ? "Main dough" : track.name;
}

/** The method badge on a track's heading, in the items card's words; the main dough has none. */
export function trackBadge(track: DoughTrack): string | undefined {
  if (track.method === "split") return "split";
  if (track.method === "separate") return "separate mix";
  return undefined;
}

/**
 * Where the tracks go under the common steps. The base track on its own (every all-lean plan)
 * carries straight on in the same list with no heading, exactly as the card read before there were
 * tracks; any other set of tracks gets a block each, the main dough's included.
 */
export function placeTracks(timeline: Timeline): { inline?: DoughTrack; blocks: DoughTrack[] } {
  const [only, ...more] = timeline.tracks;
  return only?.method === "base" && more.length === 0
    ? { inline: only, blocks: [] }
    : { blocks: timeline.tracks };
}

/** A track's bulk step: `bulk` on the base track, `bulk@<dough id>` on every other. */
export const isBulkStep = (step: Pick<TimelineStep, "id">): boolean =>
  step.id === "bulk" || step.id.startsWith("bulk@");

/**
 * Decision 26: the main dough is colour 0; every other dough takes 1–5 by its place among the
 * tracks that are not the main dough, wrapping after five. The tracks follow `result.doughs` (library
 * order), so this is the colour the other cards give the same dough.
 */
export function doughColours(timeline: Timeline): Map<string, number> {
  const colours = new Map<string, number>([[LEAN_DOUGH_ID, 0]]);
  let i = 0;
  for (const t of timeline.tracks) {
    colours.set(t.doughId, t.method === "base" ? 0 : (i++ % 5) + 1);
  }
  return colours;
}

/**
 * A track's folds as the batch numbers them: from its own bulk start for the main dough and a
 * separate dough; for a split, from the main dough's bulk start, so its first fold after the split
 * is fold 2 when it leaves at fold 1 (the batch folds every 30 min whoever holds the dough).
 */
export function foldNumbers(track: DoughTrack, timeline: Timeline): number[] {
  const baseStart =
    track.method === "split"
      ? timeline.tracks.find((t) => t.method === "base")?.steps[0]?.start
      : undefined;
  return track.folds.map((fold, i) =>
    baseStart
      ? Math.round((fold.getTime() - baseStart.getTime()) / (FOLD_INTERVAL_MIN * 60_000))
      : i + 1,
  );
}

/** Steps that take the baker's hands for their length (§3); a fold is a moment, not a span. */
const HANDS_ON = /^(mix|split|divide|shape|tangzhong)(?=$|[@:+])/;

/** One step or fold before merging: its row, the tag it brings and where it came from. */
interface Part {
  row: TimelineRow;
  tag?: DoughTag;
  /** Its place in today's order: prefix, tracks in order (steps, then folds), then lanes. */
  order: number;
}

/**
 * Every step and fold of every dough as one list in clock order (decision 24, §3). Ties keep
 * today's order (prefix, main dough, the other tracks in `tracks` order, then lanes) except that a
 * fold sorts after any step starting the same minute. Rows with the same label, start and end
 * merge into one carrying every dough: the doughs fold together, divide together.
 */
export function timelineRows(timeline: Timeline, opts?: { lanes?: boolean }): TimelineRows {
  const colours = doughColours(timeline);
  const trackTag = (t: DoughTrack): DoughTag => ({
    doughId: t.doughId,
    name: trackTitle(t),
    icon: t.icon,
    colour: colours.get(t.doughId) ?? 0,
  });
  const byId = new Map(timeline.tracks.map((t) => [t.doughId, t] as const));
  const main = timeline.tracks.find((t) => t.method === "base");

  const parts: Part[] = [];
  const add = (s: TimelineStep, tag: DoughTag | undefined) =>
    parts.push({
      row: {
        id: s.id,
        kind: "step",
        start: s.start,
        end: s.end,
        minutes: s.minutes,
        fixed: s.fixed,
        defaultMinutes: s.defaultMinutes,
        label: s.label,
        note: s.note,
        doughs: tag ? [tag] : [],
        overlaps: [],
        rails: [],
      },
      tag,
      order: parts.length,
    });

  // The common prefix: a tangzhong is its dough's, the autolyse and the shared mix the main
  // dough's; the starter feed is for every dough, so it carries no tag.
  for (const s of timeline.steps) {
    const own = s.id.split("@")[1];
    const track = own ? byId.get(own) : s.id === "mix" || s.id === "autolyse" ? main : undefined;
    add(s, track && trackTag(track));
  }
  for (const t of timeline.tracks) {
    const tag = trackTag(t);
    for (const s of t.steps) add(s, tag);
    const numbers = foldNumbers(t, timeline);
    t.folds.forEach((fold, i) => {
      const n = numbers[i]!;
      parts.push({
        row: {
          id: `fold:${n}@${t.doughId}`,
          kind: "fold",
          start: fold,
          end: fold,
          minutes: 0,
          label: `Fold ${n}`,
          doughs: [tag],
          overlaps: [],
          rails: [],
        },
        tag,
        order: parts.length,
      });
    });
  }
  if (opts?.lanes) {
    for (const lane of timeline.lanes) {
      const tag: DoughTag = {
        doughId: lane.doughId,
        name: lane.label,
        icon: lane.icon,
        colour: colours.get(lane.doughId) ?? 0,
      };
      for (const s of lane.steps) add(s, tag);
    }
  }

  parts.sort(
    (a, b) =>
      a.row.start.getTime() - b.row.start.getTime() ||
      Number(a.row.kind === "fold") - Number(b.row.kind === "fold") ||
      a.order - b.order,
  );

  // Merge: one row per (label, start, end), its parts in the order they sorted (track order).
  const groups = new Map<string, Part[]>();
  for (const p of parts) {
    const key = `${p.row.label}\u0000${p.row.start.getTime()}\u0000${p.row.end.getTime()}`;
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }
  const rows = [...groups.values()].map(merge);

  const bulks = timeline.tracks.flatMap((t) => {
    const bulk = t.steps.find(isBulkStep);
    return bulk ? [{ doughId: t.doughId, bulk }] : [];
  });
  const handsOn = (r: TimelineRow) => r.kind === "step" && r.minutes > 0 && HANDS_ON.test(r.id);
  for (const r of rows) {
    r.rails = bulks
      .filter(({ bulk }) => bulk.start <= r.start && r.start < bulk.end)
      .map(({ doughId }) => doughId);
    if (!handsOn(r)) continue;
    r.overlaps = rows
      .filter((o) => o !== r && handsOn(o) && o.start < r.end && r.start < o.end)
      .map((o) => o.id);
  }

  return { multi: placeTracks(timeline).blocks.length > 0, rows };
}

/** One row from the parts that share a label and a span (§3). */
function merge(group: Part[]): TimelineRow {
  const [first, ...rest] = group;
  if (rest.length === 0) return first!.row;
  const rows = group.map((p) => p.row);
  const defaults = new Set(rows.map((r) => r.defaultMinutes));
  const notes = rows.map((r) => r.note);
  const same = notes.every((n) => n === notes[0]);
  const note = same
    ? notes[0]
    : group
        .filter((p) => p.row.note)
        .map((p) => (p.tag ? `${p.tag.name}: ${p.row.note}` : p.row.note))
        .join("\n");
  return {
    ...first!.row,
    id: rows.map((r) => r.id).join("+"),
    fixed: rows.some((r) => r.fixed) || undefined,
    defaultMinutes: defaults.size === 1 ? rows[0]!.defaultMinutes : undefined,
    note: note || undefined,
    doughs: rows.flatMap((r) => r.doughs),
  };
}
