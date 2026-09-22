import { useEffect } from "react";
import type { BatchResult, Plan } from "../lib/types";
import type { Timeline } from "../lib/timeline";
import { useWakeLock } from "../hooks";
import { fmtDayTime, fmtDuration, fmtTime } from "../lib/format";
import { IngredientsTable } from "./IngredientsCard";
import { Pieces } from "./DivisionCard";

interface Props {
  plan: Plan;
  result: BatchResult;
  timeline: Timeline;
  halfGramSalt: boolean;
  onClose: () => void;
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

      <h2>Ingredients</h2>
      <IngredientsTable result={result} halfGramSalt={halfGramSalt} />

      <h2>Division</h2>
      <Pieces result={result} />

      <h2>Timeline</h2>
      <div className="steps">
        {timeline.steps.map((s) => (
          <div className="step" key={s.id}>
            <div className="t">
              {fmtDayTime(s.start, start)}
              <small>{fmtDuration(s.minutes)}</small>
            </div>
            <div>
              <div className="label">{s.label}</div>
              {s.note && <div className="note">{s.note}</div>}
              {s.id === "bulk" && timeline.folds.length > 0 && (
                <div className="note">
                  Folds at {timeline.folds.map((f) => fmtTime(f)).join(", ")}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {timeline.lanes.map((lane) => (
        <div key={lane.presetId}>
          <h2>
            {lane.icon} {lane.name}
          </h2>
          <div className="steps">
            {lane.steps.map((s) => (
              <div className="step" key={s.id}>
                <div className="t">
                  {fmtDayTime(s.start, start)}
                  <small>{fmtDuration(s.minutes)}</small>
                </div>
                <div>
                  <div className="label">{s.label}</div>
                  {s.note && <div className="note">{s.note}</div>}
                </div>
              </div>
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
