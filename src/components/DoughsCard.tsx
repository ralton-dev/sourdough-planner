import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ENRICHMENTS,
  INCLUSIONS,
  NO_SUGAR,
  SWEETENERS,
  bulkFactorFor,
  cloneDoughs,
  defaultBulkFactor,
  effectiveMethod,
  enrichmentAddAt,
  positive,
  separateReasons,
  splitAtFor,
  type EnrichmentInfo,
  type InclusionInfo,
  type Range,
  type SweetChoice,
  type SweetenerInfo,
} from "../lib/doughs";
import { fmtPctRange, joinAnd } from "../lib/format";
import { newId } from "../lib/ids";
import {
  LEAN_DOUGH_ID,
  type Dough,
  type DoughMethod,
  type Enrichment,
  type EnrichmentAddAt,
  type EnrichmentKind,
  type Inclusion,
  type InclusionAddAt,
  type InclusionKind,
  type Preset,
  type SplitAt,
  type SweetKind,
  type Sweetness,
} from "../lib/types";
import { NumberField } from "./NumberField";
import "./doughs.css";

interface Props {
  /** The dough library, in library order. The lean dough is never in it (decision 1). */
  doughs: Dough[];
  /** The preset library: a dough's delete confirm names the presets it is the default of. */
  presets: Preset[];
  onChange: (next: Dough[]) => void;
}

/** Percentages as the plan's cards print them (decision 35): a thin space before the sign. */
const PCT = "\u2009%";

/** Decision 9, where the hydration and salt fields are greyed out. */
const SPLIT_INHERITS =
  "Split doughs inherit the main dough's hydration and salt: you cannot change either after mixing. Choose Mix separately to give this dough its own, or a tangzhong.";

/** A separate mix's own hydration (decision 5): what counts towards it. */
const OWN_HYDRATION =
  "True hydration: the water in the starter, milk, egg, butter and honey counts towards it. Blank uses the main dough's.";

/** Decision 11, under a split dough's split point. */
const SPLIT_AT_HINT =
  "Fold 1 is 30 min into bulk and fold 2 is 60, whatever the fold count. Everything in this dough goes in at the split, except add-ins that go in at shaping.";

/** Decision 3, for a split dough with no enrichments yet: what a split can carry. */
const SPLIT_ENRICHMENTS =
  "Butter and oil go in at the split; egg, egg yolk and milk need a mix of their own.";

/** Decision 20: the tangzhong's hint. */
const TANGZHONG_HINT =
  "Cook 5–10 % of the flour with five times its weight of liquid to 65 °C. Softer, moister, keeps longer; wants ~75 % true hydration. The planner takes the flour and liquid out of the mix and puts a make-it-first step on the timeline.";

/** R4 "For the planner" 5: the label check under every sweetener. */
const LABEL_CHECK =
  "Go by the bulking agent on the label, not the sweetener on the front: one bulked with dextrose or maltodextrin is sugar (choose Sugar), one bulked with erythritol is Erythritol.";

const METHOD_LABEL: Record<DoughMethod, string> = {
  auto: "Auto",
  split: "Split off",
  separate: "Mix separately",
};

/** As `DoughResult.reason` names the split point. */
const SPLIT_AT_TEXT: Record<SplitAt, string> = {
  mix: "the end of the mix",
  fold1: "fold 1",
  fold2: "fold 2",
};

/** Decision 11: fold 1 and fold 2 are 30 and 60 min into bulk, whatever the fold count. */
const SPLIT_AT_OPTION: Record<SplitAt, string> = {
  mix: "End of the mix",
  fold1: "Fold 1 (30 min)",
  fold2: "Fold 2 (60 min)",
};

const ENRICHMENT_AT: Record<EnrichmentAddAt, string> = {
  mix: "With the mix",
  "after-mix": "After the mix",
};

const INCLUSION_AT: Record<InclusionAddAt, string> = {
  mix: "At the mix",
  fold1: "Fold 1 (30 min)",
  fold2: "Fold 2 (60 min)",
  lamination: "Laminated in",
  shape: "At shaping",
};

const CHOICE_LABEL: Record<SweetChoice, string> = {
  none: NO_SUGAR.label,
  sugar: "Sugar",
  sweetener: "Sweetener",
};
const CHOICES: SweetChoice[] = ["none", "sugar", "sweetener"];

const ENRICHMENT_KINDS = Object.keys(ENRICHMENTS) as EnrichmentKind[];
const INCLUSION_KINDS = Object.keys(INCLUSIONS) as InclusionKind[];
const SWEETENER_LIST: SweetenerInfo[] = Object.values(SWEETENERS);

/** A fraction of flour as the editor writes it: "8 %", "0.02 g per 100 g"; junk reads as 0. */
function pctText(frac: number, unit = PCT): string {
  return `${Number((positive(frac) * 100).toFixed(2))}${unit}`;
}

/** "Typical: 5–20 %." from a table's range. */
function typical(range: Range, unit = PCT): string {
  return `Typical: ${fmtPctRange(range, unit)}.`;
}

/** Where a sweetness starts: the low end of its typical range, or half the cap of an "up to". */
function startAmount(info: SweetenerInfo): number {
  const [lo, hi] = info.typical;
  return lo > 0 ? lo : hi / 2;
}

/** Drops the keys a cleared field left undefined, so a dough stores only what is set. */
function tidy<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function blankDough(): Dough {
  return { id: newId("dough"), name: "New dough", method: "auto", enrichments: [], inclusions: [] };
}

export function doughTitle(d: Pick<Dough, "icon" | "name">): string {
  return d.icon ? `${d.icon} ${d.name}` : d.name;
}

const enrichmentLabel = (kind: EnrichmentKind) => ENRICHMENTS[kind]?.label ?? kind;
const sweetenerLabel = (kind: SweetKind) => SWEETENERS[kind]?.label ?? kind;
const inclusionLabel = (kind: InclusionKind) => INCLUSIONS[kind]?.label ?? kind;

/** Mid-sentence case: "Mature cheddar" → "mature cheddar", but "BBQ onions" stays. */
function lowerFirst(s: string): string {
  const [first = "", second = ""] = s;
  return second && second === second.toLowerCase() ? first.toLowerCase() + s.slice(1) : s;
}

/** An add-in as a summary names it: "Jalapeño, fresh, diced" → "jalapeño", else its kind. */
function addInName(x: Inclusion): string {
  const name = (x.name ?? "")
    .replace(/\s*\([^)]*\)/g, "")
    .split(",")[0]
    ?.trim();
  return lowerFirst(name || inclusionLabel(x.kind));
}

/** A note's first line, cut at a word near `max` characters, with "…" when there is more. */
function firstWords(text: string, max = 60): string {
  const all = text.trim();
  const line = all.split("\n")[0]?.trim() ?? "";
  if (line.length <= max) return line.length < all.length ? `${line} …` : line;
  const cut = line.slice(0, max);
  const space = line[max] === " " ? max : cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/**
 * The live "Will be" line: the method the dough will get and why, in the words the plan prints
 * (`DoughResult.reason`, and `split-needs-mix` for a forced split that cannot carry its contents).
 */
function methodLine(d: Dough): { text: string; warn: boolean } {
  const reasons = separateReasons(d);
  const own = reasons.filter((r) => r.startsWith("own ")).map((r) => r.slice(4));
  const liquids = reasons.filter((r) => !r.startsWith("own ") && r !== "tangzhong");
  const has = liquids.length === 1 ? "has" : "have";
  if (effectiveMethod(d) === "separate") {
    const why = [
      ...(liquids.length > 0 ? [`${joinAnd(liquids)} ${has} to go in with the water`] : []),
      ...(reasons.includes("tangzhong") ? ["the tangzhong goes in with the liquids"] : []),
      ...(own.length > 0 ? [`it has its own ${joinAnd(own)}`] : []),
    ];
    return {
      text:
        why.length > 0
          ? `Will be: mixed separately — ${why.join("; ")}.`
          : "Will be: mixed separately, as set.",
      warn: false,
    };
  }
  const at = SPLIT_AT_TEXT[splitAtFor(d)] ?? SPLIT_AT_TEXT.fold1;
  if (reasons.length > 0) {
    const but = [
      ...(liquids.length > 0
        ? [`${joinAnd(liquids)} ${has} to go in with the water at the mix`]
        : []),
      ...(reasons.includes("tangzhong") ? ["a tangzhong goes in with the liquids at the mix"] : []),
      ...(own.length > 0
        ? [`its own ${joinAnd(own)} ${own.length === 1 ? "needs" : "need"} a mix of its own`]
        : []),
    ];
    return {
      text: `Will be: split off at ${at}, as set — but ${but.join(", and ")}. The plan will warn: set the method to Auto or Mix separately.`,
      warn: true,
    };
  }
  const what = [
    ...d.enrichments
      .filter((e) => positive(e.pct) > 0)
      .map((e) => enrichmentLabel(e.kind).toLowerCase()),
    ...(d.sweetness && positive(d.sweetness.pct) > 0
      ? [sweetenerLabel(d.sweetness.kind).toLowerCase()]
      : []),
    ...d.inclusions
      .filter((x) => positive(x.pct) > 0)
      .map((x) => inclusionLabel(x.kind).toLowerCase()),
  ];
  const into =
    what.length > 0
      ? `${joinAnd([...new Set(what)])} worked into a portion of the main dough`
      : "a portion of the main dough";
  return { text: `Will be: split off at ${at} — ${into}.`, warn: false };
}

/** A sweetness's amount: "6 %", or "0.03 g per 100 g" for a high-intensity sweetener. */
function sweetAmount(sw: Sweetness): string {
  return SWEETENERS[sw.kind]?.perHundredGrams ? pctText(sw.pct, " g per 100 g") : pctText(sw.pct);
}

/** The list entry's line while closed: where it splits or its own hydration, then what is in it. */
function summary(d: Dough): string {
  const parts: string[] = [];
  if (effectiveMethod(d) === "split") parts.push(`at ${SPLIT_AT_TEXT[splitAtFor(d)] ?? "fold 1"}`);
  else if (d.hydration !== undefined) parts.push(`${pctText(d.hydration)} hydration`);
  for (const e of d.enrichments) {
    if (positive(e.pct) === 0) continue;
    parts.push(`${enrichmentLabel(e.kind).toLowerCase()} ${pctText(e.pct)}`);
  }
  const sw = d.sweetness;
  if (sw && positive(sw.pct) > 0)
    parts.push(`${sweetenerLabel(sw.kind).toLowerCase()} ${sweetAmount(sw)}`);
  for (const x of d.inclusions) {
    if (positive(x.pct) === 0) continue;
    parts.push(`${addInName(x)} ${pctText(x.pct)}`);
  }
  if (d.tangzhong && positive(d.tangzhong.flourPct) > 0) {
    parts.push(`tangzhong ${pctText(d.tangzhong.flourPct)}`);
  }
  const factor = bulkFactorFor(d);
  if (factor !== 1) parts.push(`bulk ×${factor.toFixed(2)}`);
  return parts.join(" · ");
}

/*
 * The form's sections, each summarised in a line while closed (after its title): what the baker
 * would find inside, from the dough's values.
 */

function basicsSummary(d: Dough, warn: boolean): string {
  if (effectiveMethod(d) === "split") {
    const at = `split off at ${SPLIT_AT_TEXT[splitAtFor(d)] ?? "fold 1"}`;
    return warn ? `${at}, as set; the plan will warn` : at;
  }
  if (d.hydration === undefined && d.salt === undefined) {
    return "mixed separately, the main dough's hydration and salt";
  }
  const h =
    d.hydration !== undefined ? `${pctText(d.hydration)} hydration` : "the main dough's hydration";
  const s = d.salt !== undefined ? `${pctText(d.salt)} salt` : "the main dough's salt";
  return `mixed separately, ${h}, ${s}`;
}

function enrichmentsSummary(d: Dough): string {
  const parts = d.enrichments.map(
    (e) => `${enrichmentLabel(e.kind).toLowerCase()} ${pctText(e.pct)}`,
  );
  return parts.length > 0 ? parts.join(", ") : "none";
}

function sweetnessSummary(d: Dough): string {
  const sw = d.sweetness;
  return sw
    ? `${sweetenerLabel(sw.kind).toLowerCase()} ${sweetAmount(sw)}`
    : NO_SUGAR.label.toLowerCase();
}

function inclusionsSummary(d: Dough): string {
  const parts = d.inclusions.map((x) => `${addInName(x)} ${pctText(x.pct)}`);
  return parts.length > 0 ? parts.join(", ") : "none";
}

function tangzhongSummary(d: Dough): string {
  const tz = d.tangzhong;
  return tz
    ? `${pctText(tz.flourPct)} of the flour at 1:${Number(positive(tz.ratio).toFixed(2))}`
    : "none";
}

function bakeSummary(d: Dough): string {
  const b = d.bake;
  const guide = defaultBulkFactor(d);
  const parts = [
    ...(d.bulkFactor !== undefined
      ? [`bulk ×${bulkFactorFor(d).toFixed(2)}`]
      : guide !== 1
        ? [`bulk ×${guide.toFixed(2)} by the guide`]
        : []),
    ...(b?.tempC !== undefined ? [`${b.tempC} °C`] : []),
    ...(b?.steam !== undefined ? [b.steam ? "steam" : "no steam"] : []),
    ...(b?.wash?.trim() ? [`wash: ${lowerFirst(b.wash.trim())}`] : []),
  ];
  return parts.length > 0 ? parts.join(", ") : "as the preset";
}

function notesSummary(d: Dough): string {
  return d.notes?.trim() ? firstWords(d.notes) : "none";
}

/**
 * The dough library on the Presets page (decision 17): one entry per variation on the main dough,
 * opened into the form that edits it. The main dough itself is the plan's Batch settings and never
 * appears here (decision 1).
 */
export function DoughsCard({ doughs, presets, onChange }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const list = doughs.filter((d) => d.id !== LEAN_DOUGH_ID);

  const update = (next: Dough) => onChange(list.map((d) => (d.id === next.id ? next : d)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const remove = (d: Dough) => {
    const users = presets.filter((p) => p.doughId === d.id).map((p) => p.name);
    const message = [
      `Delete "${d.name}"?`,
      ...(users.length > 0 ? [`It is the default dough of ${joinAnd(users)}.`] : []),
      `${users.length > 0 ? "Those presets and any plan" : "Any plan"} that uses it will fall back to the main dough, with a warning that the dough is not in the library.`,
    ].join(" ");
    if (confirm(message)) onChange(list.filter((x) => x.id !== d.id));
  };
  const add = () => {
    const d = blankDough();
    onChange([...list, d]);
    setOpen(d.id);
  };
  const reset = () => {
    if (
      confirm(
        "Replace all doughs with the defaults? Your edits will be lost, and presets and plans that use a dough you added will fall back to the main dough.",
      )
    ) {
      onChange(cloneDoughs());
      setOpen(null);
    }
  };

  return (
    <section className="card doughs-card">
      <header>
        <h2>Doughs</h2>
        <div className="row">
          <button type="button" className="btn primary" onClick={add}>
            Add dough
          </button>
          <button type="button" className="btn" onClick={reset}>
            Reset to defaults
          </button>
        </div>
      </header>
      <div className="stack">
        <p className="note-planner">
          Variations on the main dough, which is the Batch settings on the Plan page. Pick one for
          an item on the Plan page, or make it a preset's default above.
        </p>
        {list.length === 0 && (
          <p className="note-planner">No doughs. Add one, or reset to the defaults.</p>
        )}
        {list.map((d, i) => {
          const isOpen = open === d.id;
          return (
            <div className="preset-card" key={d.id}>
              <header>
                <button
                  type="button"
                  className="btn ghost entry-open"
                  onClick={() => setOpen(isOpen ? null : d.id)}
                  aria-expanded={isOpen}
                >
                  <strong>{doughTitle(d)}</strong>{" "}
                  <span className="badge neutral">
                    {effectiveMethod(d) === "split" ? "split" : "separate mix"}
                  </span>
                  {!isOpen && (
                    <>
                      {" "}
                      <span className="note-planner">{summary(d)}</span>
                    </>
                  )}
                </button>
                <div className="actions">
                  <button
                    type="button"
                    className="btn icon"
                    aria-label={`Move ${d.name} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn icon"
                    aria-label={`Move ${d.name} down`}
                    disabled={i === list.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn icon danger"
                    aria-label={`Delete ${d.name}`}
                    onClick={() => remove(d)}
                  >
                    ×
                  </button>
                </div>
              </header>
              {isOpen && <DoughForm dough={d} presets={presets} onChange={update} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * A part of the dough form under a heading that opens and closes it; closed, the heading carries
 * the part's summary, so a dough opens on Basics and one line per other part. Whether a part is
 * open is the form's own state, never stored: it starts closed (Basics open) and resets when the
 * dough is closed.
 */
function Section({
  title,
  summary,
  initiallyOpen = false,
  children,
}: {
  title: string;
  summary: string;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const id = useId();
  return (
    <div className="part">
      <h3>
        <button
          type="button"
          className="part-toggle"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen(!open)}
        >
          <span>
            <span className="part-title">{open ? title : `${title}:`}</span>
            {!open && <span className="part-summary"> {summary}</span>}
          </span>
        </button>
      </h3>
      {open && (
        <div className="part-body" id={id}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Grows the box to its text where the browser cannot (no `field-sizing: content`). */
function fitToText(el: HTMLTextAreaElement | null) {
  if (!el || CSS.supports?.("field-sizing", "content")) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}

/** The dough's notes (decision 18): the Notes card's box, growing with what is written. */
function NotesBox({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => fitToText(ref.current), [value]);
  useEffect(() => {
    const refit = () => fitToText(ref.current);
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, []);
  return (
    <textarea
      ref={ref}
      className="notes-input"
      rows={3}
      aria-label="Notes"
      placeholder="What you did and how it went"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function DoughForm({
  dough: d,
  presets,
  onChange,
}: {
  dough: Dough;
  presets: Preset[];
  onChange: (next: Dough) => void;
}) {
  const id = useId();
  const split = effectiveMethod(d) === "split";
  const line = methodLine(d);
  const set = (patch: Partial<Dough>) => onChange(tidy({ ...d, ...patch }));
  const setBake = (patch: NonNullable<Dough["bake"]>) => {
    const bake = tidy({ ...d.bake, ...patch });
    set({ bake: Object.keys(bake).length > 0 ? bake : undefined });
  };
  const setEnrichment = (i: number, next: Enrichment) =>
    set({ enrichments: d.enrichments.map((e, k) => (k === i ? next : e)) });
  const setInclusion = (i: number, next: Inclusion) =>
    set({ inclusions: d.inclusions.map((x, k) => (k === i ? next : x)) });

  const users = presets.filter((p) => p.doughId === d.id).map((p) => p.name);
  const kinds = d.enrichments.map((e) => e.kind);
  const nextKind = ENRICHMENT_KINDS.find((k) => !kinds.includes(k));
  const guide = defaultBulkFactor(d);
  const steam = d.bake?.steam;
  const tz = d.tangzhong;

  return (
    <div className="entry-form dough-form">
      <Section title="Basics" summary={basicsSummary(d, line.warn)} initiallyOpen>
        <div className="basics">
          <div className="field f-name">
            <label htmlFor={`${id}-name`}>Name</label>
            <input
              id={`${id}-name`}
              type="text"
              value={d.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className="field f-icon">
            <label htmlFor={`${id}-icon`}>Icon</label>
            <input
              id={`${id}-icon`}
              type="text"
              value={d.icon ?? ""}
              maxLength={4}
              onChange={(e) => set({ icon: e.target.value || undefined })}
            />
          </div>
          <div className="field f-method">
            <label htmlFor={`${id}-method`}>Method</label>
            <select
              id={`${id}-method`}
              value={d.method}
              onChange={(e) => set({ method: e.target.value as DoughMethod })}
            >
              {(Object.keys(METHOD_LABEL) as DoughMethod[]).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
          <p className={line.warn ? "callout warn" : "callout info"} role="status">
            {line.text}
          </p>
          {split && (
            <div className="field f-split">
              <label htmlFor={`${id}-split`}>Split off at</label>
              <select
                id={`${id}-split`}
                value={splitAtFor(d)}
                onChange={(e) => set({ splitAt: e.target.value as SplitAt })}
              >
                {(Object.keys(SPLIT_AT_OPTION) as SplitAt[]).map((s) => (
                  <option key={s} value={s}>
                    {SPLIT_AT_OPTION[s]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <fieldset
            disabled={split}
            aria-label="Hydration and salt"
            className="fieldset-reset f-hs"
          >
            <div className="pair">
              <NumberField
                label="Hydration"
                value={d.hydration}
                onChange={(v) => set({ hydration: v })}
                scale={100}
                unit="%"
                min={40}
                max={110}
                allowEmpty
                placeholder="main"
              />
              <NumberField
                label="Salt"
                value={d.salt}
                onChange={(v) => set({ salt: v })}
                scale={100}
                unit="%"
                min={0}
                max={5}
                allowEmpty
                placeholder="main"
              />
            </div>
          </fieldset>
        </div>
        {split ? (
          <>
            <p className="note-planner">{SPLIT_AT_HINT}</p>
            <p className="note-planner">{SPLIT_INHERITS}</p>
          </>
        ) : (
          <p className="note-planner">{OWN_HYDRATION}</p>
        )}
        {split && (d.hydration !== undefined || d.salt !== undefined) && (
          <button
            type="button"
            className="btn ghost small"
            onClick={() => set({ hydration: undefined, salt: undefined })}
          >
            Clear its own hydration and salt
          </button>
        )}
        {users.length > 0 && <p className="note-planner">The default dough of {joinAnd(users)}.</p>}
      </Section>

      <Section title="Enrichments" summary={enrichmentsSummary(d)}>
        {d.enrichments.length > 0 && (
          <div className="fieldrows enr">
            {d.enrichments.map((e, i) => (
              <EnrichmentRow
                key={i}
                enrichment={e}
                split={split}
                taken={kinds.filter((_, k) => k !== i)}
                onChange={(next) => setEnrichment(i, next)}
                onRemove={() => set({ enrichments: d.enrichments.filter((_, k) => k !== i) })}
              />
            ))}
          </div>
        )}
        {d.enrichments.length === 0 && split && <p className="note-planner">{SPLIT_ENRICHMENTS}</p>}
        <button
          type="button"
          className="btn"
          disabled={!nextKind}
          onClick={() => {
            if (!nextKind) return;
            const start = ENRICHMENTS[nextKind].typical[0];
            set({ enrichments: [...d.enrichments, { kind: nextKind, pct: start }] });
          }}
        >
          Add an enrichment
        </button>
      </Section>

      <Section title="Sweetness" summary={sweetnessSummary(d)}>
        <SweetnessFields
          sweetness={d.sweetness}
          separate={!split}
          onChange={(sweetness) => set({ sweetness })}
        />
      </Section>

      <Section title="Add-ins" summary={inclusionsSummary(d)}>
        {d.inclusions.length > 0 && (
          <div className="fieldrows inc">
            {d.inclusions.map((x, i) => (
              <InclusionRow
                key={i}
                inclusion={x}
                split={split}
                onChange={(next) => setInclusion(i, next)}
                onRemove={() => set({ inclusions: d.inclusions.filter((_, k) => k !== i) })}
              />
            ))}
          </div>
        )}
        {d.inclusions.length === 0 && (
          <p className="note-planner">Cheese, chilli, olives, seeds, nuts, fruit…</p>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => {
            const kind = INCLUSION_KINDS[0] ?? "other";
            const start = INCLUSIONS[kind]?.typical ?? 0.1;
            set({ inclusions: [...d.inclusions, { kind, name: "", pct: start }] });
          }}
        >
          Add an add-in
        </button>
      </Section>

      {(!split || tz) && (
        <Section title="Tangzhong" summary={tangzhongSummary(d)}>
          <label className="check">
            <input
              type="checkbox"
              checked={!!tz}
              onChange={(e) =>
                set({ tangzhong: e.target.checked ? { flourPct: 0.05, ratio: 5 } : undefined })
              }
            />
            <span>Cook part of the flour first</span>
          </label>
          {tz && (
            <div className="flow">
              <div className="w-num">
                <NumberField
                  label="Flour"
                  value={tz.flourPct}
                  onChange={(v) => set({ tangzhong: { ...tz, flourPct: v ?? tz.flourPct } })}
                  scale={100}
                  unit="%"
                  min={0}
                  max={20}
                />
              </div>
              <div className="w-num">
                <NumberField
                  label="Liquid to flour"
                  value={tz.ratio}
                  onChange={(v) => set({ tangzhong: { ...tz, ratio: v ?? tz.ratio } })}
                  unit=": 1"
                  min={1}
                  max={10}
                />
              </div>
            </div>
          )}
          <p className="note-planner">{TANGZHONG_HINT}</p>
        </Section>
      )}

      <Section title="Bulk and bake" summary={bakeSummary(d)}>
        <div className="flow">
          <div className="w-num">
            <NumberField
              label="Bulk factor"
              value={d.bulkFactor}
              onChange={(v) => set({ bulkFactor: v })}
              unit="×"
              min={0.5}
              max={3}
              allowEmpty
              placeholder={guide.toFixed(2)}
            />
          </div>
          <div className="w-num">
            <NumberField
              label="Bake temperature"
              value={d.bake?.tempC}
              onChange={(v) => setBake({ tempC: v })}
              unit="°C"
              min={100}
              max={500}
              integer
              allowEmpty
              placeholder="preset's"
            />
          </div>
          <div className="field w-fit">
            <label htmlFor={`${id}-steam`}>Steam</label>
            <select
              id={`${id}-steam`}
              value={steam === undefined ? "" : steam ? "on" : "off"}
              onChange={(e) =>
                setBake({ steam: e.target.value === "" ? undefined : e.target.value === "on" })
              }
            >
              <option value="">As the preset</option>
              <option value="on">Steam</option>
              <option value="off">No steam</option>
            </select>
          </div>
          <div className="field w-text">
            <label htmlFor={`${id}-wash`}>Wash</label>
            <input
              id={`${id}-wash`}
              type="text"
              value={d.bake?.wash ?? ""}
              placeholder="none"
              onChange={(e) => setBake({ wash: e.target.value || undefined })}
            />
          </div>
        </div>
        <p className="note-planner">
          The bulk factor multiplies this dough's bulk time. Blank uses a guide from its sugar and
          fat, ×{guide.toFixed(2)} here: a heuristic. The temperature, steam and wash win over the
          preset's; the bake times stay the preset's.
        </p>
      </Section>

      <Section title="Notes" summary={notesSummary(d)}>
        <NotesBox value={d.notes ?? ""} onChange={(text) => set({ notes: text || undefined })} />
      </Section>
    </div>
  );
}

function EnrichmentRow({
  enrichment: e,
  split,
  taken,
  onChange,
  onRemove,
}: {
  enrichment: Enrichment;
  split: boolean;
  /** Kinds other rows already have: one row per kind. */
  taken: EnrichmentKind[];
  onChange: (next: Enrichment) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const info: EnrichmentInfo | undefined = ENRICHMENTS[e.kind];
  const defaultAt = enrichmentAddAt({ kind: e.kind, pct: e.pct });
  const butter = e.kind === "butter";
  return (
    <div className={butter ? "fieldrow" : "fieldrow no-at"}>
      <div className="field c-kind">
        <label htmlFor={`${id}-kind`}>Enrichment</label>
        <select
          id={`${id}-kind`}
          value={e.kind}
          onChange={(ev) => {
            const kind = ev.target.value as EnrichmentKind;
            onChange({ kind, pct: ENRICHMENTS[kind].typical[0] });
          }}
        >
          {!info && <option value={e.kind}>{e.kind} (unknown)</option>}
          {ENRICHMENT_KINDS.filter((k) => k === e.kind || !taken.includes(k)).map((k) => (
            <option key={k} value={k}>
              {ENRICHMENTS[k].label}
            </option>
          ))}
        </select>
      </div>
      <div className="c-amount">
        <NumberField
          label="Amount"
          value={e.pct}
          onChange={(v) => onChange({ ...e, pct: v ?? e.pct })}
          scale={100}
          unit="%"
          min={0}
          max={200}
        />
      </div>
      {butter && split && (
        // Decision 11: a split dough's butter goes in at the split, so the field is fixed and its
        // group greys it, as it does hydration and salt. A text field, not a select: Chrome fades
        // a disabled select again on its own, on screen and in print.
        <fieldset disabled className="fieldset-reset field c-at">
          <label htmlFor={`${id}-at`}>Goes in</label>
          <input id={`${id}-at`} type="text" value="At the split" readOnly />
        </fieldset>
      )}
      {butter && !split && (
        <div className="field c-at">
          <label htmlFor={`${id}-at`}>Goes in</label>
          <select
            id={`${id}-at`}
            value={e.addAt ?? ""}
            onChange={(ev) =>
              onChange(
                tidy({
                  ...e,
                  addAt: (ev.target.value || undefined) as EnrichmentAddAt | undefined,
                }),
              )
            }
          >
            <option value="">{ENRICHMENT_AT[defaultAt]} (default)</option>
            {(Object.keys(ENRICHMENT_AT) as EnrichmentAddAt[]).map((a) => (
              <option key={a} value={a}>
                {ENRICHMENT_AT[a]}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="note-planner c-hint">{info ? `${typical(info.typical)} ${info.hint}` : ""}</p>
      <button
        type="button"
        className="btn icon ghost danger c-remove"
        aria-label={`Remove ${enrichmentLabel(e.kind).toLowerCase()}`}
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  );
}

function SweetnessFields({
  sweetness: sw,
  separate,
  onChange,
}: {
  sweetness?: Sweetness;
  /** The no-sugar hint is about enriched doughs, which mix separately: a split never gets it. */
  separate: boolean;
  onChange: (next: Sweetness | undefined) => void;
}) {
  const id = useId();
  const info: SweetenerInfo | undefined = sw ? SWEETENERS[sw.kind] : undefined;
  const choice: SweetChoice = sw ? (info?.choice ?? "sweetener") : "none";
  const perHundred = !!info?.perHundredGrams;
  const start = (next: SweetenerInfo) => onChange({ kind: next.kind, pct: startAmount(next) });
  const pick = (c: SweetChoice) => {
    if (c === choice) return;
    const first = SWEETENER_LIST.find((s) => s.choice === c);
    if (c === "none" || !first) onChange(undefined);
    else start(first);
  };
  return (
    <>
      <div className="row" role="radiogroup" aria-label="Sweetness">
        {CHOICES.map((c) => (
          <label className="check" key={c}>
            <input
              type="radio"
              name={`${id}-choice`}
              value={c}
              checked={choice === c}
              onChange={() => pick(c)}
            />
            <span>{CHOICE_LABEL[c]}</span>
          </label>
        ))}
      </div>
      {sw && (
        <div className="flow">
          <div className="field w-fit">
            <label htmlFor={`${id}-kind`}>Which {CHOICE_LABEL[choice].toLowerCase()}</label>
            <select
              id={`${id}-kind`}
              value={sw.kind}
              onChange={(e) => {
                const next = SWEETENERS[e.target.value as SweetKind];
                if (next) start(next);
              }}
            >
              {!info && <option value={sw.kind}>{sw.kind} (not on the list)</option>}
              {SWEETENER_LIST.filter((s) => s.choice === choice).map((s) => (
                <option key={s.kind} value={s.kind}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-num">
            <NumberField
              label={perHundred ? "Grams per 100 g flour" : "Amount"}
              value={sw.pct}
              onChange={(v) => onChange({ ...sw, pct: v ?? sw.pct })}
              scale={100}
              unit={perHundred ? "g" : "%"}
              min={0}
              max={perHundred ? 1 : 50}
            />
          </div>
        </div>
      )}
      {sw && info && (
        <p className="note-planner">
          {typical(info.typical, perHundred ? " g per 100 g flour" : PCT)} {info.hint}
        </p>
      )}
      {sw && choice === "sweetener" && <p className="note-planner">{LABEL_CHECK}</p>}
      {!sw && separate && <p className="note-planner">{NO_SUGAR.hint}</p>}
    </>
  );
}

function InclusionRow({
  inclusion: x,
  split,
  onChange,
  onRemove,
}: {
  inclusion: Inclusion;
  split: boolean;
  onChange: (next: Inclusion) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const info: InclusionInfo | undefined = INCLUSIONS[x.kind];
  const setAt = (v: string) =>
    onChange(tidy({ ...x, addAt: (v || undefined) as InclusionAddAt | undefined }));
  // The kind's note prints when the Note field is empty (its placeholder shows it); once the baker
  // writes their own, the hint keeps the kind's advice in view.
  const hint = [
    ...(info?.typical !== undefined ? [typical([info.typical, info.typical])] : []),
    ...(info?.note && x.note?.trim() ? [info.note] : []),
  ].join(" ");
  return (
    <div className="fieldrow">
      <div className="field c-kind">
        <label htmlFor={`${id}-kind`}>Add-in</label>
        <select
          id={`${id}-kind`}
          value={x.kind}
          onChange={(ev) => {
            const kind = ev.target.value as InclusionKind;
            const t = INCLUSIONS[kind]?.typical;
            onChange({ ...x, kind, pct: t ?? x.pct });
          }}
        >
          {!info && <option value={x.kind}>{x.kind} (unknown)</option>}
          {INCLUSION_KINDS.map((k) => (
            <option key={k} value={k}>
              {INCLUSIONS[k].label}
            </option>
          ))}
        </select>
      </div>
      <div className="field c-name">
        <label htmlFor={`${id}-name`}>Name</label>
        <input
          id={`${id}-name`}
          type="text"
          value={x.name ?? ""}
          placeholder={inclusionLabel(x.kind)}
          onChange={(ev) => onChange({ ...x, name: ev.target.value })}
        />
      </div>
      <div className="c-amount">
        <NumberField
          label="Amount"
          value={x.pct}
          onChange={(v) => onChange({ ...x, pct: v ?? x.pct })}
          scale={100}
          unit="%"
          min={0}
          max={200}
        />
      </div>
      <div className="field c-at">
        <label htmlFor={`${id}-at`}>Goes in</label>
        {split ? (
          // Decision 11: in a split dough everything goes in at the split, except at shaping.
          <select
            id={`${id}-at`}
            value={x.addAt === "shape" ? "shape" : ""}
            onChange={(ev) => setAt(ev.target.value)}
          >
            <option value="">At the split</option>
            <option value="shape">{INCLUSION_AT.shape}</option>
          </select>
        ) : (
          <select id={`${id}-at`} value={x.addAt ?? ""} onChange={(ev) => setAt(ev.target.value)}>
            <option value="">{INCLUSION_AT[info?.addAt ?? "fold1"]} (default)</option>
            {(Object.keys(INCLUSION_AT) as InclusionAddAt[]).map((a) => (
              <option key={a} value={a}>
                {INCLUSION_AT[a]}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="c-soak">
        <NumberField
          label="Soaker water"
          value={x.soakerWaterPct}
          onChange={(v) => onChange(tidy({ ...x, soakerWaterPct: v }))}
          scale={100}
          unit="%"
          min={0}
          max={300}
          allowEmpty
          placeholder="none"
        />
      </div>
      <div className="field c-note">
        <label htmlFor={`${id}-note`}>Note</label>
        <input
          id={`${id}-note`}
          type="text"
          value={x.note ?? ""}
          placeholder={info?.note ?? ""}
          onChange={(ev) => onChange(tidy({ ...x, note: ev.target.value || undefined }))}
        />
      </div>
      <p className="note-planner c-hint">{hint}</p>
      <button
        type="button"
        className="btn icon ghost danger c-remove"
        aria-label={`Remove ${addInName(x)}`}
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  );
}
