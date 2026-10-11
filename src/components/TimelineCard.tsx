import type { Plan, Preset } from "../lib/types";
import {
  FOLD_INTERVAL_MIN,
  MAX_FOLD_COUNT,
  type BulkRow,
  type DoughTrack,
  type Timeline,
  type TimelineStep,
} from "../lib/timeline";
import { fmtDayTime, fmtDuration, fmtRange, fmtTime } from "../lib/format";
import { FeedHelper } from "./FeedHelper";
import "./timeline.css";

interface Props {
  plan: Plan;
  presets: Preset[];
  timeline: Timeline;
  bulkTable: BulkRow[];
  onPlan: (next: Plan) => void;
  onBulkTable: (rows: BulkRow[]) => void;
  /** The starter the whole plan needs, summed over its mixes (`result.starter`): feed for it. */
  starterTotal: number;
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
export const isBulkStep = (step: TimelineStep): boolean =>
  step.id === "bulk" || step.id.startsWith("bulk@");

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
        aria-label={`${step.label} duration in minutes (${step.id})`}
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

function FoldCountInput({
  timeline,
  onChange,
}: {
  timeline: Timeline;
  onChange: (count: number | undefined) => void;
}) {
  const n = timeline.foldCount;
  const set = (v: number) => onChange(Math.min(MAX_FOLD_COUNT, Math.max(0, v)));
  return (
    <div className="fold-count">
      <span className="fold-count-label" id="fold-count-label">
        Stretch &amp; folds
      </span>
      <div className="stepper small" role="group" aria-labelledby="fold-count-label">
        <button type="button" onClick={() => set(n - 1)} aria-label="Fewer folds" disabled={n <= 0}>
          −
        </button>
        <input
          type="text"
          inputMode="numeric"
          value={n}
          aria-label="Stretch and fold sets"
          onChange={(e) => {
            if (e.target.value === "") return;
            const v = Number.parseInt(e.target.value, 10);
            if (Number.isInteger(v) && v >= 0) set(v);
          }}
        />
        <button
          type="button"
          onClick={() => set(n + 1)}
          aria-label="More folds"
          disabled={n >= MAX_FOLD_COUNT}
        >
          +
        </button>
      </div>
      {n !== timeline.defaultFoldCount && (
        <button
          type="button"
          className="btn ghost small"
          style={{ padding: "0 6px", minHeight: 0 }}
          onClick={() => onChange(undefined)}
          title={`Reset to ${timeline.defaultFoldCount}`}
          aria-label={`Reset to ${timeline.defaultFoldCount} folds`}
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
      {/* A fixed step's length follows other steps: an edit to it would be ignored. */}
      {onChange && !step.fixed ? <DurationInput step={step} onChange={onChange} /> : <div />}
      {children}
    </div>
  );
}

const MIXER_FOLDS =
  " The mixer built the strength: one early set of folds is plenty, none if you mixed to a full windowpane, then leave the dough alone.";

/**
 * Under a track's bulk step: its folds and the guide range. A split dough's folds are base folds,
 * so they keep the base's numbers, and its guide is what is left of the bulk once it is split off.
 * A fixed bulk (a main dough that only rests until its splits) is no bulk to guide: folds only.
 * The dough factor is named but not explained: the track does not say whether it came from the
 * sugar, the fat or the dough's own figure.
 */
function BulkDetails({
  track,
  step,
  timeline,
  plan,
}: {
  track: DoughTrack;
  step: TimelineStep;
  timeline: Timeline;
  plan: Plan;
}) {
  const { bulk, method } = track;
  // The batch folds every 30 min from the main dough's bulk start, so a split's fold is numbered
  // from there, even when the main dough's own list stops at the split.
  const baseStart =
    method === "split"
      ? timeline.tracks.find((t) => t.method === "base")?.steps[0]?.start
      : undefined;
  const foldNumber = (fold: Date, i: number) =>
    baseStart
      ? Math.round((fold.getTime() - baseStart.getTime()) / (FOLD_INTERVAL_MIN * 60_000))
      : i + 1;
  const factors = [
    ...(bulk.factor !== 1
      ? [
          `×${bulk.factor.toFixed(2)} for ${Math.round(plan.settings.inoculation * 100)}% inoculation`,
        ]
      : []),
    ...(bulk.doughFactor !== 1 ? [`×${bulk.doughFactor.toFixed(2)} for this dough`] : []),
  ];
  // A separate dough's own bulk note says how to read it (an enriched one does not rise like the
  // lean dough); the main dough and its splits keep the lean target.
  const target =
    method === "separate"
      ? "."
      : ". Go by the dough, not the clock: 50–75 % rise, domed and jiggly.";
  return (
    <>
      {track.folds.length > 0 && (
        <div className="folds">
          {track.folds.map((f, i) => (
            <span key={i}>
              fold {foldNumber(f, i)} · {fmtTime(f)}
            </span>
          ))}
        </div>
      )}
      {!step.fixed && (
        <div className="note" style={{ gridColumn: "2 / -1" }}>
          {/* Text nodes as the one-dough card had them, so the lean print does not move a pixel. */}
          Guide: {fmtRange(bulk.minMinutes, bulk.maxMinutes)}
          {method === "split" && " left"}
          {" at"} {plan.settings.doughTempC} °C
          {factors.length > 0 && ` (${factors.join(", ")}, a heuristic)`}
          {target}
          {plan.standMixer && MIXER_FOLDS}
        </div>
      )}
    </>
  );
}

export function TimelineCard({
  plan,
  timeline,
  bulkTable,
  onPlan,
  onBulkTable,
  starterTotal,
}: Props) {
  const start = new Date(plan.startTime);
  const setOverride = (id: string, minutes: number | undefined) => {
    const next = { ...(plan.timelineOverrides ?? {}) };
    if (minutes === undefined) delete next[id];
    else next[id] = minutes;
    onPlan({ ...plan, timelineOverrides: next });
  };
  const feedStep = timeline.steps.find((s) => s.id === "feed");
  const { inline, blocks } = placeTracks(timeline);
  const row = (s: TimelineStep, track?: DoughTrack) => (
    <StepRow key={s.id} step={s} ref={start} onChange={(m) => setOverride(s.id, m)}>
      {track && isBulkStep(s) && (
        <BulkDetails track={track} step={s} timeline={timeline} plan={plan} />
      )}
    </StepRow>
  );
  const lead = [
    ...timeline.steps.map((s) => row(s)),
    ...(inline ? inline.steps.map((s) => row(s, inline)) : []),
  ];

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
          {/* Only the main mix rests before the starter goes in; a separate mix never does. */}
          <span>{blocks.length > 0 ? "Autolyse (main dough)" : "Autolyse"}</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={!!plan.standMixer}
            onChange={(e) => onPlan({ ...plan, standMixer: e.target.checked })}
          />
          <span>Stand mixer</span>
        </label>
        <FoldCountInput timeline={timeline} onChange={(n) => onPlan({ ...plan, foldCount: n })} />
      </div>

      {feedStep && (
        <FeedHelper
          readyBy={feedStep.end}
          hours={feedStep.minutes / 60}
          targetGrams={Math.round(starterTotal)}
        />
      )}

      {lead.length > 0 && <div className="steps">{lead}</div>}

      {blocks.map((track) => {
        const badge = trackBadge(track);
        return (
          <div className="track" key={track.doughId}>
            <h3>
              {track.icon && <span>{track.icon}</span>}
              <span>{trackTitle(track)}</span>
              {badge && <span className="badge neutral">{badge}</span>}
            </h3>
            {track.reason && <p className="reason">{track.reason}</p>}
            <div className="steps">{track.steps.map((s) => row(s, track))}</div>
          </div>
        );
      })}

      {lead.length === 0 && blocks.length === 0 && (
        <p className="muted">Add some items to see the timeline.</p>
      )}

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
          <div className="lane" key={lane.key}>
            <h3>
              <span>{lane.icon}</span>
              <span>{lane.label}</span>
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
          kitchen. The target is always the dough: for the main dough, 50–75 % rise, domed and
          jiggly.
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
