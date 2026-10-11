import {
  LEAN_DOUGH_ID,
  type AdditionLine,
  type BatchResult,
  type DoughResult,
  type MixResult,
  type Plan,
} from "../lib/types";
import { checkRow, fmtG, fmtPct, fmtSalt } from "../lib/format";
import { Warnings } from "./Warnings";

interface Props {
  plan: Plan;
  result: BatchResult;
  halfGramSalt: boolean;
  onHalfGram?: (v: boolean) => void;
}

/** When a line goes in, after its name; nothing for the mix itself or, in a split, the split. */
const ADD_AT: Record<AdditionLine["addAt"], string | undefined> = {
  mix: undefined,
  "after-mix": "after the mix",
  fold1: "at fold 1",
  fold2: "at fold 2",
  lamination: "at lamination",
  shape: "at shaping",
  split: undefined,
};

const isTangzhong = (a: AdditionLine) =>
  a.kind === "tangzhong-flour" || a.kind === "tangzhong-liquid";

/** Whole grams, as every other line; two decimals under a gram (a high-intensity sweetener). */
const fmtAmount = (g: number) => (g > 0 && g < 1 ? `${g.toFixed(2)} g` : fmtG(g));

/** "Tangzhong water" reads "Water" under the tangzhong heading. */
const tangzhongPart = (label: string) => {
  const rest = label.replace(/^tangzhong\s+/i, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
};

/** A lean plan's one mix: shown exactly as before doughs existed, with no heading. */
function leanOnly(result: BatchResult): boolean {
  const [only, ...rest] = result.mixes;
  return (
    rest.length === 0 && only?.id === "base" && only.doughIds.every((id) => id === LEAN_DOUGH_ID)
  );
}

function AdditionRow({ line }: { line: AdditionLine }) {
  const when = ADD_AT[line.addAt];
  return (
    <tr>
      <td>
        {line.label}
        {when && (
          <>
            {" "}
            <span className="muted small">({when})</span>
          </>
        )}
        {line.note && <div className="muted small">{line.note}</div>}
      </td>
      <td className="v">{fmtAmount(line.grams)}</td>
    </tr>
  );
}

/**
 * One mix as weighed: flour and water as they go into the bowl (after any tangzhong), starter,
 * salt, the mix's own lines, the total, and its check row (§5.4: the lines shown, the tangzhong's
 * included, add up to the total shown).
 */
function MixTable({ mix, halfGramSalt }: { mix: MixResult; halfGramSalt: boolean }) {
  const chk = checkRow(mix, halfGramSalt);
  return (
    <table className="ingredients">
      <tbody>
        <tr>
          <td>Flour</td>
          <td className="v">{fmtG(mix.addedFlour)}</td>
        </tr>
        <tr>
          <td>
            Water
            {mix.addedWater >= 20 && (
              <>
                {" "}
                <span className="muted small">(keep ~20 g back for the salt)</span>
              </>
            )}
          </td>
          <td className="v">{fmtG(mix.addedWater)}</td>
        </tr>
        <tr>
          <td>Starter</td>
          <td className="v">{fmtG(mix.starter)}</td>
        </tr>
        <tr>
          <td>Salt</td>
          <td className="v">{fmtSalt(mix.salt, halfGramSalt)}</td>
        </tr>
        {mix.additions
          .filter((a) => !isTangzhong(a))
          .map((a, i) => (
            <AdditionRow key={`${a.kind}-${i}`} line={a} />
          ))}
        <tr className="total">
          <td>Total dough</td>
          <td className="v">{fmtG(mix.totalDough)}</td>
        </tr>
        <tr className="checkrow">
          <td>
            Check: ingredients add to {chk.sum} g{" "}
            <span className={chk.ok ? "ok" : "bad"}>{chk.ok ? "✓" : `✗ off by ${chk.diff} g`}</span>
          </td>
          <td className="v" style={{ fontSize: "0.85rem", fontWeight: 500 }}>
            {mix.usableDough !== mix.totalDough && `${fmtG(mix.usableDough)} usable`}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * Decision 20: the paste is made first. Its two lines lead the mix's additions and are not on the
 * dough's result; the flour and water lines of the table below are what is left after them.
 */
function TangzhongBlock({ mix }: { mix: MixResult }) {
  const flour = mix.additions.find((a) => a.kind === "tangzhong-flour");
  const liquid = mix.additions.find((a) => a.kind === "tangzhong-liquid");
  if (!flour || !liquid) return null;
  const note = flour.note ?? liquid.note;
  return (
    <div className="callout info" style={{ margin: "8px 0" }}>
      <strong>Tangzhong — make first</strong>
      <table className="ingredients">
        <tbody>
          {[flour, liquid].map((a) => (
            <tr key={a.kind}>
              <td>{tangzhongPart(a.label)}</td>
              <td className="v">{fmtAmount(a.grams)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="small">{note}</p>}
    </div>
  );
}

/** A dough's notes as written, line breaks kept, under its mix or its split. */
const Notes = ({ text }: { text?: string }) =>
  text?.trim() ? <p className="muted small plan-notes">{text.trim()}</p> : null;

/**
 * A split dough under the main dough it comes out of: the portion to take, what is worked into it
 * (its lines are not in the main dough's total), what that makes, and the dough's notes.
 */
function SplitBlock({ dough }: { dough: DoughResult }) {
  return (
    <div className="split-block">
      <h3>
        {dough.icon && `${dough.icon} `}
        {dough.name}
      </h3>
      <p className="small">{dough.reason}</p>
      <table className="ingredients">
        <tbody>
          <tr>
            <td>Portion of main dough</td>
            <td className="v">{fmtG(dough.portion ?? 0)}</td>
          </tr>
          {dough.additions.map((a, i) => (
            <AdditionRow key={`${a.kind}-${i}`} line={a} />
          ))}
          <tr className="total">
            <td>Total dough</td>
            <td className="v">{fmtG(dough.mass)}</td>
          </tr>
        </tbody>
      </table>
      <Notes text={dough.notes} />
    </div>
  );
}

/**
 * One mixing bowl under its heading: the main dough with the splits that come out of it, or a
 * dough mixed separately with its reason, its tangzhong first, its lines and its notes.
 */
function MixBlock({
  mix,
  result,
  halfGramSalt,
}: {
  mix: MixResult;
  result: BatchResult;
  halfGramSalt: boolean;
}) {
  const own = mix.id === "base" ? undefined : result.doughs.find((d) => d.doughId === mix.id);
  const splits = result.doughs.filter((d) => d.method === "split" && d.mixId === mix.id);
  // In print each child of a .mix-block stays whole: this one holds the heading with its table.
  return (
    <div className="mix-block">
      <div>
        <h3>
          {own?.icon && `${own.icon} `}
          {mix.label}
        </h3>
        {/* The card header gives the one mix's figures; several mixes each give their own. */}
        {result.mixes.length > 1 && (
          <p className="muted small num">
            {fmtG(mix.totalFlour)} flour · {fmtPct(mix.trueHydration)} true hydration
          </p>
        )}
        {own && <p className="small">{own.reason}</p>}
        <TangzhongBlock mix={mix} />
        <MixTable mix={mix} halfGramSalt={halfGramSalt} />
        <Notes text={own?.notes} />
      </div>
      {splits.map((d) => (
        <SplitBlock key={d.doughId} dough={d} />
      ))}
    </div>
  );
}

/**
 * One table per mix (§4). A lean plan's single mix shows as it always has; any other plan heads
 * each mix with its dough and why it is mixed that way.
 */
export function IngredientsTable({
  result,
  halfGramSalt,
}: {
  result: BatchResult;
  halfGramSalt: boolean;
}) {
  if (result.mixes.length === 0) return <p className="muted">Nothing to mix yet.</p>;
  if (leanOnly(result)) {
    return (
      <>
        {result.mixes.map((mix) => (
          <MixTable key={mix.id} mix={mix} halfGramSalt={halfGramSalt} />
        ))}
      </>
    );
  }
  return (
    <>
      {result.mixes.map((mix) => (
        <MixBlock key={mix.id} mix={mix} result={result} halfGramSalt={halfGramSalt} />
      ))}
    </>
  );
}

export function IngredientsCard({ plan, result, halfGramSalt, onHalfGram }: Props) {
  // The main dough's true hydration (the batch settings); without one, the only mix's.
  const base = result.mixes.find((m) => m.id === "base");
  const shown = base ?? (result.mixes.length === 1 ? result.mixes[0] : undefined);
  const others = result.mixes.length > 1;
  // Several mixes go in one after another, so the whole of the starter is out by the first.
  const starterWhen = others ? `for the first mix (${result.mixes[0]?.label})` : "at mix time";
  return (
    <section className="card">
      <header>
        <h2>Ingredients</h2>
        <span className="sub num">
          {fmtG(result.totalFlour)} total flour
          {shown &&
            ` · ${fmtPct(shown.trueHydration)} true hydration${base && others ? " (main dough)" : ""}`}
        </span>
      </header>
      <IngredientsTable result={result} halfGramSalt={halfGramSalt} />
      {plan.mode === "items" && (
        <p className="muted small" style={{ marginTop: 8 }}>
          Have <strong className="num">{fmtG(result.starter)}</strong>
          {` of active starter ready ${starterWhen}.`}
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
