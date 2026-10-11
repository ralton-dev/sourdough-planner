import { Fragment, type ReactNode } from "react";
import {
  LEAN_DOUGH_ID,
  type AllocationLine,
  type BatchResult,
  type DoughResult,
  type Plan,
} from "../lib/types";
import { leanDough } from "../lib/doughs";
import { fmtG, lineLabel } from "../lib/format";
import "./division.css";

interface Props {
  plan: Plan;
  result: BatchResult;
}

/** The pieces made from one dough, and what that dough holds (none in a plan with no flour). */
interface Group {
  doughId: string;
  dough?: DoughResult;
  lines: AllocationLine[];
}

/** Lean, then the doughs split off it, then those mixed separately: the ingredients card's order. */
const RANK: Record<DoughResult["method"], number> = { base: 0, split: 1, separate: 2 };

/**
 * Lines grouped by the dough they are made from, in the order the doughs are mixed and divided,
 * each rank in library order; last, any dough the result does not hold (a plan with no flour).
 */
function byDough(result: BatchResult): Group[] {
  const groups = result.doughs.map((dough): Group => ({
    doughId: dough.doughId,
    dough,
    lines: [],
  }));
  for (const l of result.allocation) {
    let g = groups.find((x) => x.doughId === l.doughId);
    if (!g) {
      g = { doughId: l.doughId, lines: [] };
      groups.push(g);
    }
    g.lines.push(l);
  }
  const rank = (g: Group) => (g.doughId === LEAN_DOUGH_ID ? 0 : g.dough ? RANK[g.dough.method] : 3);
  return groups.filter((g) => g.lines.length > 0).sort((a, b) => rank(a) - rank(b));
}

/** What the pieces on a dough weigh, finished, against what that dough holds (§4). */
const usedOf = (lines: AllocationLine[]) => lines.reduce((n, l) => n + l.count * l.pieceEach, 0);

/**
 * Decision 26: a dough's colour, for its `dough-N` class. The main dough is 0 (neutral); every
 * other dough takes 1 to 5 by its place among the result's doughs that are not the base (library
 * order, as the timeline's tracks), wrapping after five. Undefined for a dough the result does not
 * hold (a plan with no flour), which then has no colour of its own.
 */
export function doughColour(result: BatchResult, doughId: string): number | undefined {
  if (doughId === LEAN_DOUGH_ID) return 0;
  const i = result.doughs
    .filter((d) => d.method !== "base")
    .findIndex((d) => d.doughId === doughId);
  return i < 0 ? undefined : (i % 5) + 1;
}

/** The parts that apply, with " · " between them. */
function Dotted({ parts }: { parts: ReactNode[] }) {
  const shown = parts.filter((p) => p !== false && p !== null && p !== undefined && p !== "");
  return (
    <>
      {shown.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          {p}
        </Fragment>
      ))}
    </>
  );
}

/**
 * One piece: how many at what finished weight; when it carries add-ins, what is dough and what is
 * add-in (decision 6), rounded so the parts add up to the weight shown; what the line comes to
 * when it is more than one piece; and what the planner did to its weight.
 */
function Piece({ line: l, label }: { line: AllocationLine; label: string }) {
  const piece = Math.round(l.pieceEach);
  const dough = Math.round(l.doughEach);
  const addIns = piece - dough;
  // Tick box off: the planned weight is the dough and the add-ins ride on top.
  const onTop = l.pieceEach !== l.weightEach;
  const flags: ReactNode[] = [
    l.adjusted && (
      <>
        <span className="badge neutral">adjusted</span>{" "}
        <span className="nowrap">
          from {Math.round(l.baseWeight)} g{onTop && " dough"}
        </span>
      </>
    ),
    l.pinned && !l.adjusted && <span className="badge neutral">pinned</span>,
    l.belowMin && <span className="badge bad">below min</span>,
  ];
  return (
    <div className={`piece${l.adjusted ? " adjusted" : ""}${l.belowMin ? " bad" : ""}`}>
      <div className="name">
        <span>{l.icon}</span>
        <span>{label}</span>
      </div>
      <div className="big">
        {l.count} × {piece}
        <small> g</small>
      </div>
      {l.additionsEach > 0 && addIns > 0 && (
        <div className="note-planner num">
          {/* Each part wraps as one: a narrow piece would break "94 g add-ins" at its hyphen. */}
          <span className="nowrap">{dough} g dough</span> +{" "}
          <span className="nowrap">{addIns} g add-ins</span>
        </div>
      )}
      {l.count > 1 && (
        <div className="note-planner num nowrap">{fmtG(l.count * l.pieceEach)} total</div>
      )}
      {flags.some(Boolean) && (
        <div className="note-planner">
          <Dotted parts={flags} />
        </div>
      )}
    </div>
  );
}

const METHOD: Record<DoughResult["method"], string | undefined> = {
  base: undefined,
  split: "split",
  separate: "separate mix",
};

/**
 * The pieces, a section per dough (decision 30): its tag in its colour, how it is made, and what
 * its pieces use of what it holds when the two differ. A lean plan's one group shows as it always
 * has, with no heading. Pieces on lean are named in full, so a line whose dough has gone reads
 * "Loaf (dough x not found)". Kitchen mode shows these too, so its rules are scoped to its root.
 */
export function Pieces({ result }: { result: BatchResult }) {
  const groups = byDough(result);
  // Line keys are unique: calc merges two rows on one key, or keys the later ones #2, #3.
  const piece = (l: AllocationLine) => (
    <Piece key={l.key} line={l} label={l.doughId === LEAN_DOUGH_ID ? lineLabel(l) : l.name} />
  );
  const [only] = groups;
  if (groups.length <= 1 && (!only || only.doughId === LEAN_DOUGH_ID)) {
    return (
      <div className="division-pieces">
        <div className="pieces">{result.allocation.map(piece)}</div>
      </div>
    );
  }
  return (
    <div className="division-pieces">
      {groups.map((g) => {
        // Lean is named "Main dough" by the lib, never by its first line, which may be on a dough
        // that has gone. Any other dough without a result (no flour) is named by its lines.
        const name =
          g.doughId === LEAN_DOUGH_ID
            ? leanDough().name
            : (g.dough?.name ?? g.lines[0]?.doughName ?? "");
        const how = g.dough && METHOD[g.dough.method];
        const colour = doughColour(result, g.doughId);
        const used = fmtG(usedOf(g.lines));
        const holds = fmtG(g.dough?.usable ?? 0);
        // Each figure once: what the pieces use of what the dough holds when those differ; else
        // what its lines come to, when it has several and the card's total covers more than it.
        const figures =
          used !== holds
            ? `${used} of ${holds}`
            : g.lines.length > 1 && groups.length > 1
              ? used
              : undefined;
        return (
          <div
            key={g.doughId}
            className={colour === undefined ? "section" : `section dough-${colour}`}
          >
            <div className="head">
              <h3 className="dough-tag">
                {g.dough?.icon && `${g.dough.icon} `}
                {name}
              </h3>
              {how && <span className="badge neutral">{how}</span>}
              {figures && <span className="figures nowrap">{figures}</span>}
            </div>
            <div className="pieces">{g.lines.map(piece)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function DivisionCard({ plan, result }: Props) {
  // Finished pieces against what the doughs hold, dough for dough: never piece grams against mix
  // totals, which leave out a split's add-ins (§4).
  const used = fmtG(usedOf(result.allocation));
  const usable = fmtG(result.doughs.reduce((n, d) => n + d.usable, 0));
  const addIns = result.allocation.some((l) => l.additionsEach > 0);
  const starter = plan.mode === "starter";
  // Each figure once: what the pieces use of what the doughs hold when those differ; else what
  // the pieces come to, unless a single line says so itself. With no pieces, the spare says it.
  const lines = result.allocation.length;
  let total: string | undefined;
  if (lines > 0 && used !== usable) total = `${used} of ${usable}`;
  else if (lines > 1) total = used;
  const sub: ReactNode[] = [
    total && <span className="nowrap">{total}</span>,
    starter && result.spareOrShort > 0 && (
      <span className="nowrap">{fmtG(result.spareOrShort)} spare</span>
    ),
    starter && result.spareOrShort < 0 && (
      <span className="nowrap">short {fmtG(-result.spareOrShort)}</span>
    ),
    addIns &&
      (plan.weightsIncludeAdditions === false
        ? "add-ins on top of planned weights"
        : "planned weights include add-ins"),
  ];
  return (
    <section className="card division">
      <header>
        <h2>Division</h2>
        {sub.some(Boolean) && (
          <span className="sub num">
            <Dotted parts={sub} />
          </span>
        )}
      </header>
      {result.allocation.length === 0 ? (
        <p className="muted">Add some items to see the split.</p>
      ) : (
        <Pieces result={result} />
      )}
      {result.suggestions.length > 0 && (
        <div className="stack suggestions">
          {result.suggestions.map((s, i) => (
            <div key={i} className={`callout ${result.spareOrShort < 0 ? "warn" : "info"}`}>
              {s}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
