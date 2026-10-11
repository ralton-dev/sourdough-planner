import { useEffect } from "react";
import type { BatchResult, Plan } from "../lib/types";
import type { Lane, Timeline } from "../lib/timeline";
import { useWakeLock } from "../hooks";
import { fmtDayTime, fmtDuration } from "../lib/format";
import { IngredientsTable } from "./IngredientsCard";
import { Pieces } from "./DivisionCard";
import { doughColours, isBulkStep, timelineRows, type TimelineRow } from "./timelineRows";
import "./kitchen.css";

interface Props {
  plan: Plan;
  result: BatchResult;
  timeline: Timeline;
  halfGramSalt: boolean;
  onClose: () => void;
}

/**
 * Under a bake row, when its items can go in the oven: from the end of the shortest proof to the end
 * of the longest. One line when every item on the row shares it, else one per item, led by its name.
 */
function bakeWindows(ids: string[], laneOf: Map<string, Lane>, start: Date): string[] {
  const windows = ids.flatMap((id) => {
    const lane = id.startsWith("bake:") ? laneOf.get(id) : undefined;
    if (!lane) return [];
    const { earliest, latest } = lane.bakeWindow;
    return [{ lane, text: `${fmtDayTime(earliest, start)} – ${fmtDayTime(latest, start)}` }];
  });
  const [first] = windows;
  if (!first) return [];
  return windows.every((w) => w.text === first.text)
    ? [`Bake window ${first.text}`]
    : windows.map((w) => `${w.lane.label}: bake window ${w.text}`);
}

/**
 * The day's jobs in clock order (decision 25): every row of `timelineRows` with the lanes' shape,
 * proof and bake rows in, read-only. As the card's In order list: a gutter with a rail per dough
 * while its bulk runs, the doughs' dots before the label and their names under it when they change
 * from the row above, and a bracket down a run of rows whose hands-on steps clash.
 */
function JobList({ timeline, start }: { timeline: Timeline; start: Date }) {
  const { rows } = timelineRows(timeline, { lanes: true });
  const colours = doughColours(timeline);
  const slots = timeline.tracks.map((t) => t.doughId);
  const laneOf = new Map(timeline.lanes.flatMap((l) => l.steps.map((s) => [s.id, l] as const)));
  const index = new Map(rows.map((r, i) => [r.id, i] as const));

  // One bracket per stretch of rows from the first hands-on clash to the last that meets it.
  const spans: [number, number][] = [];
  rows.forEach((r, i) => {
    if (r.overlaps.length === 0) return;
    const at = [i, ...r.overlaps.map((id) => index.get(id) ?? i)];
    const from = Math.min(...at);
    const to = Math.max(...at);
    const last = spans[spans.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else spans.push([from, to]);
  });
  const spanOf = (i: number) => spans.find(([a, b]) => a <= i && i <= b);
  const tagKey = (r: TimelineRow) => r.doughs.map((d) => `${d.doughId}:${d.name}`).join("|");

  if (rows.length === 0) return <p className="note-planner">Add some items to see the timeline.</p>;
  return (
    <div className={spans.length > 0 ? "kitchen-rows bracketed" : "kitchen-rows"}>
      {rows.map((r, i) => {
        const ids = r.id.split("+");
        const bulk = r.kind === "step" && isBulkStep({ id: ids[0]! });
        const notes = [...(r.note?.split("\n") ?? []), ...bakeWindows(ids, laneOf, start)];
        const busy = r.overlaps.flatMap((id) => {
          const o = rows[index.get(id) ?? -1];
          return o ? [`${o.label} at ${fmtDayTime(o.start, start)}`] : [];
        });
        const span = spanOf(i);
        const named = r.doughs.length > 0 && (i === 0 || tagKey(r) !== tagKey(rows[i - 1]!));
        const cls = [
          "step",
          "kitchen-row",
          r.kind === "fold" && "fold",
          span && "bracket",
          span?.[0] === i && "from",
          span?.[1] === i && "to",
        ];
        return (
          <div className={cls.filter(Boolean).join(" ")} key={r.id}>
            <div className="rails" aria-hidden="true">
              {slots.map((id) => (
                <span
                  key={id}
                  className={
                    r.rails.includes(id)
                      ? `dough-rail dough-${colours.get(id) ?? 0}`
                      : "dough-rail off"
                  }
                />
              ))}
            </div>
            <div className="t">
              {fmtDayTime(r.start, start)}
              {r.kind === "step" && (
                <small>
                  {/* A bulk runs to a time, as on the card (§3); a fold is a moment. */}
                  {bulk ? `to ${fmtDayTime(r.end, start)}` : fmtDuration(r.minutes)}
                </small>
              )}
            </div>
            <div className="main">
              <div className="head">
                <div className="label">{r.label}</div>
                {r.doughs.length > 0 && (
                  <div className="tags">
                    {r.doughs.map((d) => (
                      <span
                        className={`dough-tag dough-${d.colour}`}
                        key={`${d.doughId}:${d.name}`}
                      >
                        {d.icon && <span>{d.icon}</span>}
                        <span className="name">{d.name}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {/* The names again, on a line of their own; the tags read them out. */}
              {named && (
                <div className="names" aria-hidden="true">
                  {r.doughs.map((d) => (
                    <span className={`dough-${d.colour}`} key={`${d.doughId}:${d.name}`}>
                      {d.name}
                    </span>
                  ))}
                </div>
              )}
              {(notes.length > 0 || busy.length > 0) && (
                <div className="notes">
                  {notes.map((n, j) => (
                    <div className="note-planner" key={j}>
                      {n}
                    </div>
                  ))}
                  {busy.length > 0 && (
                    <div className="note-planner">hands busy: also {busy.join(", ")}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Large, read-only view of the plan that keeps the screen awake. */
export function KitchenMode({ plan, result, timeline, halfGramSalt, onClose }: Props) {
  const lock = useWakeLock(true);
  const start = new Date(plan.startTime);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const notes = plan.notes?.trim();

  return (
    <div className="kitchen" role="dialog" aria-modal="true" aria-label="Kitchen mode">
      <header className="kitchen-head">
        <div className="title">
          <h1>{plan.name || "Today's bake"}</h1>
          {lock !== "off" && (
            <p className="note-planner">
              {lock === "on" ? "screen stays on" : "wake lock unsupported"}
            </p>
          )}
        </div>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </header>
      {notes && <p className="note-own kitchen-notes">{notes}</p>}

      <section className="kitchen-part">
        <h2>Ingredients</h2>
        <IngredientsTable result={result} halfGramSalt={halfGramSalt} />
      </section>

      <section className="kitchen-part">
        <h2>Division</h2>
        {result.allocation.length === 0 ? (
          <p className="note-planner">Add some items to see the split.</p>
        ) : (
          <Pieces result={result} />
        )}
      </section>

      <section className="kitchen-part">
        <h2>Timeline</h2>
        <JobList timeline={timeline} start={start} />
        {timeline.ovenWarnings.length > 0 && (
          <div className="stack kitchen-oven">
            {timeline.ovenWarnings.map((w, i) => (
              <div key={i} className="callout warn">
                {w}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
