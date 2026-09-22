import type { Plan, Preset } from "../lib/types";
import type { BulkRow, Timeline, TimelineStep } from "../lib/timeline";
import { fmtDayTime, fmtDuration, fmtRange, fmtTime } from "../lib/format";
import { FeedHelper } from "./FeedHelper";

interface Props {
  plan: Plan;
  presets: Preset[];
  timeline: Timeline;
  bulkTable: BulkRow[];
  onPlan: (next: Plan) => void;
  onBulkTable: (rows: BulkRow[]) => void;
}

function DurationInput({
  step,
  onChange,
}: {
  step: TimelineStep;
  onChange: (minutes: number | undefined) => void;
}) {
  return (
    <div className="dur no-print">
      <input
        type="text"
        inputMode="numeric"
        value={step.minutes}
        aria-label={`${step.label} duration in minutes`}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          if (e.target.value === "") return;
          if (Number.isInteger(n) && n >= 0) onChange(n);
        }}
      />
      <span className="u">min</span>
      {step.minutes !== step.defaultMinutes && (
        <button
          type="button"
          className="btn ghost small"
          style={{ padding: "0 6px", minHeight: 0 }}
          onClick={() => onChange(undefined)}
          title={`Reset to ${step.defaultMinutes} min`}
        >
          ↺
        </button>
      )}
    </div>
  );
}

export function StepRow({
  step,
  ref,
  children,
  onChange,
}: {
  step: TimelineStep;
  ref: Date;
  children?: React.ReactNode;
  onChange?: (minutes: number | undefined) => void;
}) {
  return (
    <div className="step">
      <div className="t">
        {fmtDayTime(step.start, ref)}
        <small>{fmtDuration(step.minutes)}</small>
      </div>
      <div>
        <div className="label">{step.label}</div>
        {step.note && <div className="note">{step.note}</div>}
      </div>
      {onChange ? <DurationInput step={step} onChange={onChange} /> : <div />}
      {children}
    </div>
  );
}

export function TimelineCard({ plan, timeline, bulkTable, onPlan, onBulkTable }: Props) {
  const start = new Date(plan.startTime);
  const setOverride = (id: string, minutes: number | undefined) => {
    const next = { ...(plan.timelineOverrides ?? {}) };
    if (minutes === undefined) delete next[id];
    else next[id] = minutes;
    onPlan({ ...plan, timelineOverrides: next });
  };
  const feedStep = timeline.steps.find((s) => s.id === "feed");

  return (
    <section className="card print-page">
      <header>
        <h2>Timeline</h2>
        <span className="sub">
          {fmtDayTime(start)} → {fmtDayTime(timeline.end, start)}
        </span>
      </header>

      <div className="row no-print" style={{ marginBottom: 8 }}>
        <label className="check">
          <input
            type="checkbox"
            checked={!!plan.feedStarter}
            onChange={(e) => onPlan({ ...plan, feedStarter: e.target.checked })}
          />
          <span>Feed starter first</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={!!plan.autolyse}
            onChange={(e) => onPlan({ ...plan, autolyse: e.target.checked })}
          />
          <span>Autolyse</span>
        </label>
      </div>

      {feedStep && (
        <FeedHelper
          readyBy={feedStep.end}
          hours={feedStep.minutes / 60}
          targetGrams={plan.mode === "starter" ? (plan.starterWeight ?? 0) : undefined}
        />
      )}

      <div className="steps">
        {timeline.steps.map((s) => (
          <StepRow key={s.id} step={s} ref={start} onChange={(m) => setOverride(s.id, m)}>
            {s.id === "bulk" && (
              <>
                <div className="folds">
                  {timeline.folds.map((f, i) => (
                    <span key={i}>
                      fold {i + 1} · {fmtTime(f)}
                    </span>
                  ))}
                </div>
                <div className="note" style={{ gridColumn: "2 / -1" }}>
                  Guide: {fmtRange(timeline.bulk.minMinutes, timeline.bulk.maxMinutes)} at{" "}
                  {plan.settings.doughTempC} °C
                  {timeline.bulk.factor !== 1 &&
                    ` (×${timeline.bulk.factor.toFixed(2)} for ${Math.round(plan.settings.inoculation * 100)}% inoculation, a heuristic)`}
                  . Go by the dough, not the clock: 50–75 % rise, domed and jiggly.
                </div>
              </>
            )}
          </StepRow>
        ))}
      </div>

      {timeline.ovenWarnings.length > 0 && (
        <div className="stack" style={{ marginTop: 10 }}>
          {timeline.ovenWarnings.map((w, i) => (
            <div key={i} className="callout warn">
              {w}
            </div>
          ))}
        </div>
      )}

      <div className="lanes">
        {timeline.lanes.map((lane) => (
          <div className="lane" key={lane.presetId}>
            <h3>
              <span>{lane.icon}</span>
              <span>{lane.name}</span>
              <span className="badge neutral">{lane.proof}</span>
            </h3>
            {lane.steps.map((s) => (
              <StepRow key={s.id} step={s} ref={start} onChange={(m) => setOverride(s.id, m)} />
            ))}
            <div className="window muted">
              {lane.proof === "cold" ? "Bake between" : "Ready to bake between"}{" "}
              <strong className="num">{fmtDayTime(lane.bakeWindow.earliest, start)}</strong> and{" "}
              <strong className="num">{fmtDayTime(lane.bakeWindow.latest, start)}</strong>
              {lane.proof === "either" && " (room), or retard in the fridge and bake tomorrow."}
              <br />
              {lane.bakeTempC} °C{lane.steam ? ", steam" : ""}
            </div>
          </div>
        ))}
      </div>

      <details className="no-print" style={{ marginTop: 12 }}>
        <summary>Bulk fermentation guide table</summary>
        <p className="muted small" style={{ margin: "6px 0 10px" }}>
          A guide at 20–25 % inoculation, interpolated between rows. Edit it as you learn your
          kitchen. The target is always the dough: 50–75 % rise, domed and jiggly.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Dough °C</th>
              <th>Min (min)</th>
              <th>Max (min)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bulkTable.map((r, i) => (
              <tr key={i}>
                {(["tempC", "minMinutes", "maxMinutes"] as const).map((k) => (
                  <td key={k}>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={r[k]}
                      aria-label={`${k} row ${i + 1}`}
                      onChange={(e) => {
                        const n = Number.parseFloat(e.target.value);
                        if (Number.isNaN(n)) return;
                        onBulkTable(
                          bulkTable.map((row, j) => (j === i ? { ...row, [k]: n } : row)),
                        );
                      }}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="btn icon ghost"
                    aria-label="Remove row"
                    onClick={() => onBulkTable(bulkTable.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const last = bulkTable[bulkTable.length - 1];
              onBulkTable([
                ...bulkTable,
                last
                  ? {
                      tempC: last.tempC + 2,
                      minMinutes: last.minMinutes,
                      maxMinutes: last.maxMinutes,
                    }
                  : { tempC: 24, minMinutes: 270, maxMinutes: 330 },
              ]);
            }}
          >
            Add row
          </button>
        </div>
      </details>
    </section>
  );
}
