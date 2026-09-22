import type { BatchResult, Plan } from "../lib/types";
import { fmtG } from "../lib/format";

interface Props {
  plan: Plan;
  result: BatchResult;
}

export function Pieces({ result }: { result: BatchResult }) {
  return (
    <div className="pieces">
      {result.allocation.map((l) => (
        <div
          key={l.presetId}
          className={`piece${l.adjusted ? " adjusted" : ""}${l.belowMin ? " bad" : ""}`}
        >
          <div className="name">
            <span>{l.icon}</span>
            <span>{l.name}</span>
          </div>
          <div className="big">
            {l.count} × {Math.round(l.weightEach)}
            <small> g</small>
          </div>
          <div className="muted small num">
            {fmtG(l.subtotal)} total
            {l.adjusted && (
              <>
                {" "}
                · <span className="badge">adjusted</span>{" "}
                <span className="muted">from {Math.round(l.baseWeight)} g</span>
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
      ))}
    </div>
  );
}

export function DivisionCard({ plan, result }: Props) {
  const used = result.allocation.reduce((n, l) => n + l.subtotal, 0);
  return (
    <section className="card">
      <header>
        <h2>Division</h2>
        <span className="sub num">
          {fmtG(used)} of {fmtG(result.usableDough)}
          {plan.mode === "starter" &&
            result.spareOrShort > 0 &&
            ` · ${fmtG(result.spareOrShort)} spare`}
          {plan.mode === "starter" &&
            result.spareOrShort < 0 &&
            ` · short ${fmtG(-result.spareOrShort)}`}
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
