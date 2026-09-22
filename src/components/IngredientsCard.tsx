import type { BatchResult, Plan } from "../lib/types";
import { checkRow, fmtG, fmtPct, fmtSalt } from "../lib/format";
import { Warnings } from "./Warnings";

interface Props {
  plan: Plan;
  result: BatchResult;
  halfGramSalt: boolean;
  onHalfGram?: (v: boolean) => void;
}

export function IngredientsTable({
  result,
  halfGramSalt,
}: {
  result: BatchResult;
  halfGramSalt: boolean;
}) {
  const chk = checkRow(result, halfGramSalt);
  return (
    <table className="ingredients">
      <tbody>
        <tr>
          <td>Flour</td>
          <td className="v">{fmtG(result.addedFlour)}</td>
        </tr>
        <tr>
          <td>
            Water <span className="muted small">(keep ~20 g back for the salt)</span>
          </td>
          <td className="v">{fmtG(result.addedWater)}</td>
        </tr>
        <tr>
          <td>Starter</td>
          <td className="v">{fmtG(result.starter)}</td>
        </tr>
        <tr>
          <td>Salt</td>
          <td className="v">{fmtSalt(result.salt, halfGramSalt)}</td>
        </tr>
        <tr className="total">
          <td>Total dough</td>
          <td className="v">{fmtG(result.totalDough)}</td>
        </tr>
        <tr className="checkrow">
          <td>
            Check: ingredients add to {chk.sum} g{" "}
            <span className={chk.ok ? "ok" : "bad"}>{chk.ok ? "✓" : `✗ off by ${chk.diff} g`}</span>
          </td>
          <td className="v" style={{ fontSize: "0.85rem", fontWeight: 500 }}>
            {result.usableDough !== result.totalDough && `${fmtG(result.usableDough)} usable`}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function IngredientsCard({ plan, result, halfGramSalt, onHalfGram }: Props) {
  return (
    <section className="card">
      <header>
        <h2>Ingredients</h2>
        <span className="sub num">
          {fmtG(result.totalFlour)} total flour · {fmtPct(result.trueHydration)} true hydration
        </span>
      </header>
      <IngredientsTable result={result} halfGramSalt={halfGramSalt} />
      {plan.mode === "items" && (
        <p className="muted small" style={{ marginTop: 8 }}>
          Have <strong className="num">{fmtG(result.starter)}</strong> of active starter ready at
          mix time.
        </p>
      )}
      {onHalfGram && (
        <label className="check no-print" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={halfGramSalt}
            onChange={(e) => onHalfGram(e.target.checked)}
          />
          <span className="small">My scale reads 0.5 g (show salt to the half gram)</span>
        </label>
      )}
      <div style={{ marginTop: 10 }}>
        <Warnings items={result.warnings} />
      </div>
    </section>
  );
}
