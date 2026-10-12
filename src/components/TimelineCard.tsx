import { useState } from "react";
import type { Plan, Preset } from "../lib/types";
import {
  MAX_FOLD_COUNT,
  type BulkRow,
  type DoughTrack,
  type Timeline,
  type TimelineStep,
} from "../lib/timeline";
import { fmtDayTime, fmtDuration, fmtRange, fmtTime } from "../lib/format";
import { load } from "../lib/storage";
import { usePersisted } from "../hooks";
import { FeedHelper } from "./FeedHelper";
import {
  doughColours,
  foldNumbers,
  isBulkStep,
  placeTracks,
  timelineRows,
  trackBadge,
  trackTitle,
  type TimelineRow,
} from "./timelineRows";
import "./timeline.css";
import { HintButton } from "../guide/hints";

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

/**
 * Decision 33: the view this browser last chose, "order" or "dough". Its own key, so it stays out
 * of the export bundle and `UiPrefs`; `KEYS` would hold it, but the lib is frozen (decision 31).
 */
const VIEW_KEY = "sourdough.v1.timelineView";
type View = "order" | "dough";
const isView = (v: unknown): v is View => v === "order" || v === "dough";

/** By dough: the main dough, then the doughs split off it, then the separate mixes (§4). */
const RANK: Record<DoughTrack["method"], number> = { base: 0, split: 1, separate: 2 };

/** What a length box edits: a step, or an In order row (a merged row edits each of its steps). */
interface Length {
  id: string;
  label: string;
  minutes: number;
  defaultMinutes?: number;
}

function DurationInput({
  step,
  onChange,
}: {
  step: Length;
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
          className="btn ghost small reset"
          onClick={() => onChange(undefined)}
          title={
            step.defaultMinutes === undefined
              ? "Reset to the default lengths"
              : `Reset to ${step.defaultMinutes} min`
          }
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
          className="btn ghost small reset"
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
 * A track's bulk guide: the range (for a split, what is left of it once it is split off), what
 * scaled it, and what to go by. The dough factor is named but not explained: the track does not
 * say whether it came from the sugar, the fat or the dough's own figure.
 */
function bulkGuide(track: DoughTrack, plan: Plan): string {
  const { bulk, method } = track;
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
  return [
    `Guide: ${fmtRange(bulk.minMinutes, bulk.maxMinutes)}`,
    method === "split" ? " left" : "",
    ` at ${plan.settings.doughTempC} °C`,
    factors.length > 0 ? ` (${factors.join(", ")}, a heuristic)` : "",
    target,
    plan.standMixer ? MIXER_FOLDS : "",
  ].join("");
}

/**
 * Under a track's bulk step in the By dough view: its folds, numbered as the batch counts them,
 * and the guide. A fixed bulk (a main dough that only rests until its splits) is no bulk to
 * guide: folds only.
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
  const numbers = foldNumbers(track, timeline);
  return (
    <>
      {track.folds.length > 0 && (
        <div className="folds">
          {track.folds.map((f, i) => (
            <span key={i}>
              fold {numbers[i]} · {fmtTime(f)}
            </span>
          ))}
        </div>
      )}
      {!step.fixed && <div className="note guide">{bulkGuide(track, plan)}</div>}
    </>
  );
}

/**
 * The In order list (§4): every row of `timelineRows` in clock order. A gutter carries a rail per
 * dough while its bulk runs; a run of rows whose hands-on steps clash is bracketed, and each such
 * row says what else needs the baker's hands then. Lengths edit the same step ids as By dough.
 */
function OrderList({
  timeline,
  plan,
  start,
  onLength,
}: {
  timeline: Timeline;
  plan: Plan;
  start: Date;
  onLength: (ids: string[], minutes: number | undefined) => void;
}) {
  const { rows } = timelineRows(timeline);
  const colours = doughColours(timeline);
  const slots = timeline.tracks.map((t) => t.doughId);
  const trackOf = new Map(timeline.tracks.flatMap((t) => t.steps.map((s) => [s.id, t] as const)));
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

  return (
    <div className={spans.length > 0 ? "order bracketed" : "order"}>
      {rows.map((r, i) => {
        const ids = r.id.split("+");
        const bulk = r.kind === "step" && isBulkStep({ id: ids[0]! });
        const guides =
          bulk && !r.fixed
            ? [...new Set(ids.flatMap((id) => trackOf.get(id) ?? []))].map((t) =>
                bulkGuide(t, plan),
              )
            : [];
        const notes = [...(r.note?.split("\n") ?? []), ...new Set(guides)];
        const busy = r.overlaps.flatMap((id) => {
          const o = rows[index.get(id) ?? -1];
          return o ? [`${o.label} at ${fmtDayTime(o.start, start)}`] : [];
        });
        const span = spanOf(i);
        // On a phone a dough is named only when it changes from the row above (§4).
        const named = r.doughs.length > 0 && (i === 0 || tagKey(r) !== tagKey(rows[i - 1]!));
        const cls = [
          "step",
          "order-row",
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
                  {/* A bulk runs to a time; how long is the guide's to say (§3). */}
                  {bulk ? `to ${fmtDayTime(r.end, start)}` : fmtDuration(r.minutes)}
                </small>
              )}
            </div>
            <div className="main">
              {/* A fixed step's length follows other steps; a fold is a moment. First, so that on
                  a phone it can sit right of the label with the notes running on under it. */}
              {r.kind === "step" && !r.fixed && (
                <DurationInput step={r} onChange={(m) => onLength(ids, m)} />
              )}
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
              {/* The names again, for a phone's line under the label; the tags read them out. */}
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

export function TimelineCard({
  plan,
  timeline,
  bulkTable,
  onPlan,
  onBulkTable,
  starterTotal,
}: Props) {
  const start = new Date(plan.startTime);
  const [view, setView] = useState<View>(() => load(VIEW_KEY, "order", isView));
  usePersisted(VIEW_KEY, view);
  const setOverrides = (ids: string[], minutes: number | undefined) => {
    const next = { ...(plan.timelineOverrides ?? {}) };
    for (const id of ids) {
      if (minutes === undefined) delete next[id];
      else next[id] = minutes;
    }
    onPlan({ ...plan, timelineOverrides: next });
  };
  const setOverride = (id: string, minutes: number | undefined) => setOverrides([id], minutes);
  const feedStep = timeline.steps.find((s) => s.id === "feed");
  const { inline, blocks } = placeTracks(timeline);
  // Decision 24: the main dough on its own reads as one list with no choice of view; any other
  // plan opens In order unless this browser chose By dough.
  const multi = blocks.length > 0;
  const inOrder = multi && view === "order";
  // Only the main mix rests before the starter goes in; a separate mix never does.
  const mainMix = timeline.steps.some((s) => s.id === "mix");
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
  const byDough = [...blocks].sort((a, b) => RANK[a.method] - RANK[b.method]);

  return (
    <section className="card print-page timeline-card" data-guide="timeline">
      <header>
        <h2>Timeline</h2>
        <HintButton card="timeline" />
        <span className="sub">
          {fmtDayTime(start)} → {fmtDayTime(timeline.end, start)}
        </span>
        {multi && (
          <div
            className="toggle"
            role="group"
            aria-label="Timeline view"
            data-guide="timeline.view"
          >
            <button type="button" aria-pressed={inOrder} onClick={() => setView("order")}>
              In order
            </button>
            <button type="button" aria-pressed={!inOrder} onClick={() => setView("dough")}>
              By dough
            </button>
          </div>
        )}
      </header>

      <div className="row no-print options">
        <label className="check">
          <input
            type="checkbox"
            checked={!!plan.feedStarter}
            onChange={(e) => onPlan({ ...plan, feedStarter: e.target.checked })}
          />
          <span>Feed starter first</span>
        </label>
        {mainMix && (
          <label className="check">
            <input
              type="checkbox"
              checked={!!plan.autolyse}
              onChange={(e) => onPlan({ ...plan, autolyse: e.target.checked })}
            />
            <span>{multi ? "Autolyse (main dough)" : "Autolyse"}</span>
          </label>
        )}
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

      {inOrder ? (
        <OrderList timeline={timeline} plan={plan} start={start} onLength={setOverrides} />
      ) : (
        <>
          {lead.length > 0 && <div className="steps">{lead}</div>}

          {byDough.map((track) => {
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
        </>
      )}

      {lead.length === 0 && blocks.length === 0 && (
        <p className="muted">Add some items to see the timeline.</p>
      )}

      {timeline.ovenWarnings.length > 0 && (
        <div className="stack oven">
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

      <details className="no-print bulk-table">
        <summary>Bulk fermentation guide table</summary>
        <p className="note-planner">
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
        <div className="row add-row">
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
