import { useEffect } from "react";
import type { BatchResult, Plan } from "../lib/types";
import type { Timeline, TimelineStep } from "../lib/timeline";
import { useWakeLock } from "../hooks";
import { fmtDayTime, fmtDuration, fmtTime } from "../lib/format";
import { IngredientsTable } from "./IngredientsCard";
import { Pieces } from "./DivisionCard";
import { isBulkStep, placeTracks, trackBadge, trackTitle } from "./TimelineCard";

interface Props {
  plan: Plan;
  result: BatchResult;
  timeline: Timeline;
  halfGramSalt: boolean;
  onClose: () => void;
}

/** One step, read-only; a bulk step lists its track's folds under its note. */
function Step({ step, start, folds }: { step: TimelineStep; start: Date; folds?: Date[] }) {
  return (
    <div className="step">
      <div className="t">
        {fmtDayTime(step.start, start)}
        <small>{fmtDuration(step.minutes)}</small>
      </div>
      <div>
        <div className="label">{step.label}</div>
        {step.note && <div className="note">{step.note}</div>}
        {folds && folds.length > 0 && (
          <div className="note">Folds at {folds.map((f) => fmtTime(f)).join(", ")}</div>
        )}
      </div>
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

  // The same layout as the timeline card: the main dough alone carries on under the common steps.
  const { inline, blocks } = placeTracks(timeline);
  const lead = [
    ...timeline.steps.map((s) => <Step key={s.id} step={s} start={start} />),
    ...(inline?.steps.map((s) => (
      <Step key={s.id} step={s} start={start} folds={isBulkStep(s) ? inline.folds : undefined} />
    )) ?? []),
  ];
  const notes = plan.notes?.trim();

  return (
    <div className="kitchen" role="dialog" aria-modal="true" aria-label="Kitchen mode">
      <div className="close">
        <h1>{plan.name || "Today's bake"}</h1>
        <div className="row">
          <span className="muted small">
            {lock === "on"
              ? "screen stays on"
              : lock === "unsupported"
                ? "wake lock unsupported"
                : ""}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {notes && <p className="plan-notes">{notes}</p>}

      <h2>Ingredients</h2>
      <IngredientsTable result={result} halfGramSalt={halfGramSalt} />

      <h2>Division</h2>
      <Pieces result={result} />

      <h2>Timeline</h2>
      {lead.length > 0 && <div className="steps">{lead}</div>}
      {blocks.map((track) => {
        const badge = trackBadge(track);
        return (
          <div key={track.doughId}>
            <h2>
              {track.icon && `${track.icon} `}
              {trackTitle(track)}
              {badge && (
                <>
                  {" "}
                  <span className="badge neutral">{badge}</span>
                </>
              )}
            </h2>
            {track.reason && <p className="muted">{track.reason}</p>}
            <div className="steps">
              {track.steps.map((s) => (
                <Step
                  key={s.id}
                  step={s}
                  start={start}
                  folds={isBulkStep(s) ? track.folds : undefined}
                />
              ))}
            </div>
          </div>
        );
      })}
      {lead.length === 0 && blocks.length === 0 && (
        <p className="muted">Add some items to see the timeline.</p>
      )}
      {timeline.lanes.map((lane) => (
        <div key={lane.key}>
          <h2>
            {lane.icon} {lane.label}
          </h2>
          <div className="steps">
            {lane.steps.map((s) => (
              <Step key={s.id} step={s} start={start} />
            ))}
          </div>
          <p className="muted">
            Bake window {fmtDayTime(lane.bakeWindow.earliest, start)} –{" "}
            {fmtDayTime(lane.bakeWindow.latest, start)}
          </p>
        </div>
      ))}
      {timeline.ovenWarnings.map((w, i) => (
        <div key={i} className="callout warn" style={{ marginTop: 12 }}>
          {w}
        </div>
      ))}
    </div>
  );
}
