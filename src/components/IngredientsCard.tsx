import { ENRICHMENTS, INCLUSIONS } from "../lib/doughs";
import {
  LEAN_DOUGH_ID,
  type AdditionLine,
  type BatchResult,
  type DoughResult,
  type MixResult,
  type Plan,
  type SplitAt,
} from "../lib/types";
import { checkRow, fmtG, fmtPct, fmtSalt, joinAnd } from "../lib/format";
import { doughColour } from "./DivisionCard";
import { Warnings } from "./Warnings";
import "./ingredients.css";

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

/**
 * Where a split dough leaves the main dough (`DoughResult.splitAt`), as calc's reason words it;
 * "at fold 1" never breaks across a line.
 */
const SPLIT_AT: Record<SplitAt, string> = {
  mix: "at the end of the mix",
  fold1: "at\u00a0fold\u00a01",
  fold2: "at\u00a0fold\u00a02",
};

/**
 * Holding ~20 g of water back for the salt is worth saying only when that is a tenth of the water
 * or less: 200 g or more, on a plain mix. The timeline's mix note keeps the same rule
 * (`RESERVE_FROM_WATER_G` and `plainMixNote` in timeline.ts), so the card and the step agree.
 */
const RESERVE_FROM_WATER_G = 200;

const isTangzhong = (a: AdditionLine) =>
  a.kind === "tangzhong-flour" || a.kind === "tangzhong-liquid";

/** Grams inside a sentence, the number and its unit kept on one line. */
const gramsInText = (g: number) => fmtG(g).replace(" ", "\u00a0");

/** Whole grams, as every other line; two decimals under a gram (a high-intensity sweetener). */
const fmtAmount = (g: number) => (g > 0 && g < 1 ? `${g.toFixed(2)} g` : fmtG(g));

/** "Tangzhong water" reads "Water" under the tangzhong heading. */
const tangzhongPart = (label: string) => {
  const rest = label.replace(/^tangzhong\s+/i, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
};

/** Whether any piece is made from the main dough as it is (the rule the timeline shares). */
const leanHasPieces = (result: BatchResult) =>
  result.allocation.some((l) => l.doughId === LEAN_DOUGH_ID && l.count > 0);

/**
 * A mix keeps water back for the salt when it is plain (no enrichment line; a sweetness alone
 * leaves it plain) and has the water. A separate mix is judged by its dough's lines, as the
 * timeline judges it; the main mix has none.
 */
function reservesWater(mix: MixResult, own: DoughResult | undefined): boolean {
  const lines = own?.additions ?? mix.additions;
  const enriched = lines.some((a) => a.kind in ENRICHMENTS && a.grams > 0);
  return !enriched && mix.addedWater >= RESERVE_FROM_WATER_G;
}

/** An add-in's note is the baker's own, unless it is the planner's stock note for its kind. */
function plannersNote(a: AdditionLine): boolean {
  const stock: Record<string, { note?: string } | undefined> = INCLUSIONS;
  return a.note !== undefined && a.note === stock[a.kind]?.note;
}

/**
 * A split that takes the whole main dough, by the timeline's rule (`isWholeBase` in timeline.ts):
 * nothing plain is made from the main dough, and the split's portion is all of it to the half
 * gram or the split is the one dough the mix holds.
 */
function takesAll(d: DoughResult, mix: MixResult, leanPieces: boolean): boolean {
  if (leanPieces) return false;
  const only = mix.doughIds.length === 1 && mix.doughIds[0] === d.doughId;
  return only || (d.portion ?? 0) >= mix.totalDough - 0.5;
}

/**
 * The splits a main dough feeds, in words: each through `part`, joined with "and", and the split
 * point said once at the end when they share it, else after each.
 */
function splitsInWords(splits: DoughResult[], part: (d: DoughResult, i: number) => string): string {
  const at = splits.map((d) => (d.splitAt ? SPLIT_AT[d.splitAt] : undefined));
  const shared = at.every((x) => x === at[0]);
  const parts = splits.map((d, i) => {
    const words = part(d, i);
    const own = at[i];
    return shared || !own ? words : `${words} ${own}`;
  });
  return shared && at[0] ? `${joinAnd(parts)} ${at[0]}` : joinAnd(parts);
}

/**
 * What becomes of the main dough, under its table, said only when some of it stays plain: as
 * pieces (what its splits take of it), or as spare from the starter. When its splits take all of
 * it, each split's own line says how much, and one split's heading says it is all of it.
 */
function mainDoughFate(result: BatchResult, splits: DoughResult[]): string | undefined {
  const leanPieces = leanHasPieces(result);
  const lean = result.doughs.find((d) => d.method === "base");
  const spareG = !leanPieces && lean && lean.usable >= 1 ? lean.usable : 0;
  if (splits.length === 0) {
    return spareG > 0 ? `Nothing is made from it yet: ${gramsInText(spareG)} spare.` : undefined;
  }
  if (!leanPieces && spareG === 0) return undefined;
  const taken = splitsInWords(
    splits,
    (d, i) => `${gramsInText(d.portion ?? 0)} ${i === 0 ? "goes to" : "to"} ${d.name}`,
  );
  return `of which ${taken}${spareG > 0 ? ` · ${gramsInText(spareG)} spare` : ""}.`;
}

/** A dough's notes as written, line breaks kept: the baker's own words. */
const Notes = ({ text }: { text?: string }) =>
  text?.trim() ? <p className="note-own">{text.trim()}</p> : null;

/** A line of a mix or a split: its name, when it goes in, any note, and its grams. */
function AdditionRow({ line }: { line: AdditionLine }) {
  const when = ADD_AT[line.addAt];
  return (
    <tr>
      <td>
        {line.label}
        {when && (
          <>
            {" "}
            <span className="note-planner">({when})</span>
          </>
        )}
        {line.note && (
          <div className={plannersNote(line) ? "note-planner" : "note-own"}>{line.note}</div>
        )}
      </td>
      <td className="v">{fmtAmount(line.grams)}</td>
    </tr>
  );
}

/**
 * One mix as weighed: flour and water as they go into the bowl (after any tangzhong), starter,
 * salt and the mix's own lines, then the check across both columns (§5.4: the lines shown, the
 * tangzhong's included, add up to the total on the section's heading row).
 */
function MixTable({
  mix,
  own,
  halfGramSalt,
}: {
  mix: MixResult;
  own?: DoughResult;
  halfGramSalt: boolean;
}) {
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
            {reservesWater(mix, own) && (
              <>
                {" "}
                <span className="note-planner">(keep ~20&nbsp;g back for the&nbsp;salt)</span>
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
        <tr className="checkrow">
          <td colSpan={2}>
            Check: ingredients add to {chk.sum} g{" "}
            <span className={chk.ok ? "ok" : "bad"}>{chk.ok ? "✓" : `✗ off by ${chk.diff} g`}</span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * Decision 20: the paste is made first, so it opens its mix's section, in the dough's colour. Its
 * two lines lead the mix's additions and are not on the dough's result; the flour and water lines
 * of the table below are what is left after them.
 */
function TangzhongBlock({ mix, colour }: { mix: MixResult; colour: number }) {
  const flour = mix.additions.find((a) => a.kind === "tangzhong-flour");
  const liquid = mix.additions.find((a) => a.kind === "tangzhong-liquid");
  if (!flour || !liquid) return null;
  const note = flour.note ?? liquid.note;
  return (
    <div className={`subsection dough-${colour}`}>
      <h4 className="head">Tangzhong, make first</h4>
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
      {note && <p className="note-planner">{note}</p>}
    </div>
  );
}

/**
 * A split dough inside the main dough's section, in its colour: where it leaves (its heading),
 * how much of the main dough it takes, what is worked in, what that makes (a result, not weighed,
 * so smaller), and the dough's notes. `all`: it takes the whole main dough, so there is no
 * portion to weigh.
 */
function SplitSection({
  dough,
  all,
  colour,
}: {
  dough: DoughResult;
  all: boolean;
  colour: number;
}) {
  return (
    <div className={`subsection dough-${colour}`}>
      <h4 className="head">
        {dough.icon && `${dough.icon} `}
        {dough.name}
        {/* The dot stays with the name; the line may break after it. */}
        {"\u00a0"}
        <span className="where">
          · split off{dough.splitAt ? ` ${SPLIT_AT[dough.splitAt]}` : ""}
        </span>
      </h4>
      <p className="note-planner">
        {all ? (
          "All of the main dough."
        ) : (
          <>
            Take <strong className="num nowrap">{fmtG(dough.portion ?? 0)}</strong> of the main
            dough.
          </>
        )}
      </p>
      {dough.additions.length > 0 && (
        <table className="ingredients">
          <tbody>
            {dough.additions.map((a, i) => (
              <AdditionRow key={`${a.kind}-${i}`} line={a} />
            ))}
            <tr className="with-add-ins">
              <td>With add-ins</td>
              <td className="v">{fmtG(dough.mass)}</td>
            </tr>
          </tbody>
        </table>
      )}
      <Notes text={dough.notes} />
    </div>
  );
}

/**
 * One mixing bowl as a section (decision 30). Its heading row: icon, name, a badge for a separate
 * mix, and its figures: the dough it makes and, when some is lost, what is usable. Under it the
 * mix: the planner's lines, any tangzhong, the weighed lines, then for the main dough what becomes
 * of it, for a separate dough its notes. The main dough's splits follow the mix.
 */
function MixSection({
  mix,
  result,
  halfGramSalt,
  several,
}: {
  mix: MixResult;
  result: BatchResult;
  halfGramSalt: boolean;
  several: boolean;
}) {
  const base = mix.id === "base";
  const own = base ? undefined : result.doughs.find((d) => d.doughId === mix.id);
  const splits = base
    ? result.doughs.filter((d) => d.method === "split" && d.mixId === mix.id)
    : [];
  const leanPieces = leanHasPieces(result);
  // Decision 26, as every card colours a dough: the main dough neutral, the rest by library place.
  const colour = own ? (doughColour(result, own.doughId) ?? 0) : 0;
  // A main dough nobody bakes as it is (its splits take it) has no usable figure of its own.
  const usable = (!base || leanPieces) && fmtG(mix.usableDough) !== fmtG(mix.totalDough);
  const fate = base ? mainDoughFate(result, splits) : undefined;
  return (
    <div className={`section dough-${colour}${base ? "" : " separate-mix"}`}>
      <div className="head">
        <h3>
          {own?.icon && `${own.icon} `}
          {mix.label}
        </h3>
        {!base && <span className="badge neutral">separate mix</span>}
        <span className="figures">
          <span className="nowrap">{fmtG(mix.totalDough)}</span>
          {usable && (
            <>
              {" · "}
              <span className="nowrap">{fmtG(mix.usableDough)} usable</span>
            </>
          )}
        </span>
      </div>
      {/* The mix itself, apart from the splits after it: one unit, so a section that has to break
          across a page can break before a split and nowhere inside what goes into the bowl. */}
      <div className="mix">
        {/* The card header gives the one mix's flour and hydration; several give their own. */}
        {several && (
          <p className="note-planner num">
            <span className="nowrap">{fmtG(mix.totalFlour)} flour</span>
            {" · "}
            <span className="nowrap">{fmtPct(mix.trueHydration)} true hydration</span>
          </p>
        )}
        {own?.reason && <p className="note-planner">{own.reason}</p>}
        <TangzhongBlock mix={mix} colour={colour} />
        <MixTable mix={mix} own={own} halfGramSalt={halfGramSalt} />
        {fate && <p className="note-planner">{fate}</p>}
        <Notes text={own?.notes} />
      </div>
      {splits.map((d) => (
        <SplitSection
          key={d.doughId}
          dough={d}
          all={takesAll(d, mix, leanPieces)}
          colour={doughColour(result, d.doughId) ?? 0}
        />
      ))}
    </div>
  );
}

/**
 * Every mix as a section of its own (§4), the splits inside the main dough's. Kitchen mode
 * renders this too, so everything it shows comes from the result.
 */
export function IngredientsTable({
  result,
  halfGramSalt,
}: {
  result: BatchResult;
  halfGramSalt: boolean;
}) {
  if (result.mixes.length === 0) return <p className="note-planner">Nothing to mix yet.</p>;
  const several = result.mixes.length > 1;
  return (
    <div className="ingredient-mixes">
      {result.mixes.map((mix) => (
        <MixSection
          key={mix.id}
          mix={mix}
          result={result}
          halfGramSalt={halfGramSalt}
          several={several}
        />
      ))}
    </div>
  );
}

/**
 * The first thing the bake needs, so it opens the card: the active starter, and with several
 * mixes, which go in one after another, how it divides between them.
 */
function StarterLine({ result }: { result: BatchResult }) {
  const per = result.mixes.map(
    (m) => `${gramsInText(m.starter)} for ${m.id === "base" ? "the main dough" : m.label}`,
  );
  return (
    <p className="note-planner starter">
      Have <strong className="num">{fmtG(result.starter)}</strong> of active starter ready
      {per.length > 1 ? ` by the first mix: ${joinAnd(per)}.` : " at mix time."}
    </p>
  );
}

export function IngredientsCard({ plan, result, halfGramSalt, onHalfGram }: Props) {
  // The main dough's true hydration (the batch settings); without one, the only mix's.
  const base = result.mixes.find((m) => m.id === "base");
  const shown = base ?? (result.mixes.length === 1 ? result.mixes[0] : undefined);
  const several = result.mixes.length > 1;
  const warned = result.warnings.length > 0;
  return (
    <section className="card ingredients-card">
      <header>
        <h2>Ingredients</h2>
        <span className="sub num">
          <span className="nowrap">{fmtG(result.totalFlour)} total flour</span>
          {shown && (
            <>
              {" · "}
              <span className="nowrap">{fmtPct(shown.trueHydration)} true hydration</span>
              {base && several ? " (main dough)" : ""}
            </>
          )}
        </span>
      </header>
      {plan.mode === "items" && result.mixes.length > 0 && <StarterLine result={result} />}
      <IngredientsTable result={result} halfGramSalt={halfGramSalt} />
      {/* The scale toggle is not printed: a footer holding only it is not printed either. */}
      {(onHalfGram || warned) && (
        <footer className={warned ? "card-footer" : "card-footer no-print"}>
          {onHalfGram && (
            <label className="check no-print">
              <input
                type="checkbox"
                checked={halfGramSalt}
                onChange={(e) => onHalfGram(e.target.checked)}
              />
              <span className="small">My scale reads 0.5 g (show salt to the half gram)</span>
            </label>
          )}
          <Warnings items={result.warnings} />
        </footer>
      )}
    </section>
  );
}
