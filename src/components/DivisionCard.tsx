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
 * One piece: how many at what finished weight and, when it carries add-ins, what is dough and
 * what is add-in (decision 6). The parts are rounded so they add up to the weight shown.
 */
function Piece({ line: l, label }: { line: AllocationLine; label: string }) {
  const piece = Math.round(l.pieceEach);
  const dough = Math.round(l.doughEach);
  const addIns = piece - dough;
  // Tick box off: the planned weight is the dough and the add-ins ride on top.
  const onTop = l.pieceEach !== l.weightEach;
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
        <div className="muted small num">
          {/* Each part wraps as one: a narrow piece would break "94 g add-ins" at its hyphen. */}
          <span className="nowrap">{dough} g dough</span> +{" "}
          <span className="nowrap">{addIns} g add-ins</span>
          {onTop && (
            <>
              {" "}
              <span className="nowrap">= {piece} g</span>
            </>
          )}
        </div>
      )}
      <div className="muted small num">
        {fmtG(l.count * l.pieceEach)} total
        {l.adjusted && (
          <>
            {" "}
            · <span className="badge">adjusted</span>{" "}
            <span className="muted nowrap">
              from {Math.round(l.baseWeight)} g{onTop && " dough"}
            </span>
          </>
        )}
        {l.pinned && !l.adjusted && (
          <>
            {" "}
            · <span className="badge neutral">pinned</span>
          </>
        )}
        {l.belowMin && (
          <>
            {" "}
            · <span className="badge bad">below min</span>
          </>
        )}
      </div>
    </div>
  );
}

const METHOD: Record<DoughResult["method"], string | undefined> = {
  base: undefined,
  split: "split",
  separate: "separate mix",
};

/**
 * The pieces, grouped by dough under a heading each with what its pieces use of what it holds. A
 * lean plan's one group shows as it always has, with no heading. Pieces on lean are named in full,
 * so a line whose dough has gone reads "Loaf (dough x not found)".
 */
export function Pieces({ result }: { result: BatchResult }) {
  const groups = byDough(result);
  // Line keys are unique: calc merges two rows on one key, or keys the later ones #2, #3.
  const piece = (l: AllocationLine) => (
    <Piece key={l.key} line={l} label={l.doughId === LEAN_DOUGH_ID ? lineLabel(l) : l.name} />
  );
  const [only] = groups;
  if (groups.length <= 1 && (!only || only.doughId === LEAN_DOUGH_ID)) {
    return <div className="pieces">{result.allocation.map(piece)}</div>;
  }
  return (
    <>
      {groups.map((g) => {
        // Lean is named "Main dough" by the lib, never by its first line, which may be on a dough
        // that has gone. Any other dough without a result (no flour) is named by its lines.
        const name =
          g.doughId === LEAN_DOUGH_ID
            ? leanDough().name
            : (g.dough?.name ?? g.lines[0]?.doughName ?? "");
        const how = g.dough && METHOD[g.dough.method];
        return (
          <div key={g.doughId} className="piece-group">
            <h3>
              {g.dough?.icon && `${g.dough.icon} `}
              {name}{" "}
              <span className="muted small num" style={{ fontWeight: 400 }}>
                · {how && `${how} · `}
                {fmtG(usedOf(g.lines))} of {fmtG(g.dough?.usable ?? 0)}
              </span>
            </h3>
            <div className="pieces">{g.lines.map(piece)}</div>
          </div>
        );
      })}
    </>
  );
}

export function DivisionCard({ plan, result }: Props) {
  // Finished pieces against what the doughs hold, dough for dough: never piece grams against mix
  // totals, which leave out a split's add-ins (§4).
  const used = usedOf(result.allocation);
  const usable = result.doughs.reduce((n, d) => n + d.usable, 0);
  const addIns = result.allocation.some((l) => l.additionsEach > 0);
  return (
    <section className="card">
      <header>
        <h2>Division</h2>
        <span className="sub num">
          {fmtG(used)} of {fmtG(usable)}
          {plan.mode === "starter" &&
            result.spareOrShort > 0 &&
            ` · ${fmtG(result.spareOrShort)} spare`}
          {plan.mode === "starter" &&
            result.spareOrShort < 0 &&
            ` · short ${fmtG(-result.spareOrShort)}`}
          {addIns &&
            (plan.weightsIncludeAdditions === false
              ? " · add-ins on top of planned weights"
              : " · planned weights include add-ins")}
        </span>
      </header>
      {result.allocation.length === 0 ? (
        <p className="muted">Add some items to see the split.</p>
      ) : (
        <Pieces result={result} />
      )}
      {result.suggestions.length > 0 && (
        <div className="stack" style={{ marginTop: 10 }}>
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
