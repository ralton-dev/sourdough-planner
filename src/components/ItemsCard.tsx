import { useId, useState } from "react";
import {
  LEAN_DOUGH_ID,
  type Dough,
  type ItemSelection,
  type Plan,
  type Preset,
} from "../lib/types";
import { effectiveMethod, findDough, lineKey, positive, resolveDoughId } from "../lib/doughs";
import { lineLabel } from "../lib/format";
import { NumberField } from "./NumberField";
import "./items.css";

interface Props {
  plan: Plan;
  presets: Preset[];
  /** The dough library; the lean dough is never in it (decision 1). */
  doughs: Dough[];
  onChange: (next: Plan) => void;
}

/** The dough a preset's lines start on: its own, else lean (decision 2). A blank id is unset. */
const defaultDoughOf = (p: Preset): string => p.doughId || LEAN_DOUGH_ID;

/** Inclusions or soaker water: what a piece can weigh on top of its dough (decision 6). */
const hasAddIns = (d: Dough | undefined): boolean =>
  !!d && d.inclusions.some((x) => positive(x.pct) > 0 || positive(x.soakerWaterPct) > 0);

/** An item row: its preset, if it still exists, and its dough as computePlan resolves it. */
type Row =
  | { it: ItemSelection; p?: undefined }
  | { it: ItemSelection; p: Preset; doughId: string; dough: Dough | undefined };

export function ItemsCard({ plan, presets, doughs, onChange }: Props) {
  const [adding, setAdding] = useState("");
  const uid = useId();
  const setItems = (items: ItemSelection[]) => onChange({ ...plan, items });
  const update = (i: number, patch: Partial<ItemSelection>) =>
    setItems(plan.items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => setItems(plan.items.filter((_, k) => k !== i));

  const library = doughs.filter((d) => d.id !== LEAN_DOUGH_ID);
  // The lean dough is the batch settings; the lib names it "Main dough", as every card does.
  const doughName = (id: string) => findDough(id, doughs)?.name ?? `${id} (not found)`;
  const optionLabel = (id: string) => {
    const icon = findDough(id, doughs)?.icon;
    return icon ? `${icon} ${doughName(id)}` : doughName(id);
  };

  // Each row's dough as computePlan resolves it, and the doughs each preset is already on:
  // a preset can be added once per dough (decision 2), so its lines never share a key.
  const rows = plan.items.map((it): Row => {
    const p = presets.find((x) => x.id === it.presetId);
    if (!p) return { it };
    const doughId = resolveDoughId(it, p);
    return { it, p, doughId, dough: findDough(doughId, doughs) };
  });
  const usedBy = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.p) continue;
    const used = usedBy.get(r.p.id) ?? new Set<string>();
    used.add(r.doughId);
    usedBy.set(r.p.id, used);
  }
  const isFree = (presetId: string, doughId: string) => !usedBy.get(presetId)?.has(doughId);
  /** The first dough a preset is not on yet: its own, then lean, then library order. */
  const nextDough = (p: Preset): string | undefined =>
    [defaultDoughOf(p), LEAN_DOUGH_ID, ...library.map((d) => d.id)].find((id) => isFree(p.id, id));
  const addable = presets.flatMap((p) => {
    const doughId = nextDough(p);
    return doughId === undefined ? [] : [{ p, doughId }];
  });

  const add = (presetId: string) => {
    const p = presets.find((x) => x.id === presetId);
    const doughId = p && nextDough(p);
    if (!p || doughId === undefined) return;
    const line: ItemSelection =
      doughId === defaultDoughOf(p) ? { presetId, count: 1 } : { presetId, count: 1, doughId };
    setItems([...plan.items, line]);
    setAdding("");
  };

  /** The preset's own dough is stored as no `doughId`, so the line follows the preset. */
  const setDough = (i: number, p: Preset, doughId: string) => {
    const it = plan.items[i];
    if (!it) return;
    const next: ItemSelection = { ...it };
    if (doughId === defaultDoughOf(p)) delete next.doughId;
    else next.doughId = doughId;
    setItems(plan.items.map((x, k) => (k === i ? next : x)));
  };

  /** Decision 6: undefined reads as ticked, so ticking deletes the key and no saved plan moves. */
  const setWeightsIncludeAdditions = (on: boolean) => {
    const next: Plan = { ...plan };
    if (on) delete next.weightsIncludeAdditions;
    else next.weightsIncludeAdditions = false;
    onChange(next);
  };
  const showAddInsBox = rows.some((r) => r.p !== undefined && hasAddIns(r.dough));
  const hintId = `${uid}-add-ins`;

  // Row keys are line keys. Two rows can still reach one key (a row on its preset's own dough
  // beside a row naming that dough): calc merges them or keys the later #2, #3, but both rows stay
  // in the plan, so they are keyed here the way calc keys them.
  const seen = new Map<string, number>();
  const rowKey = (key: string) => {
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? key : `${key}#${n}`;
  };

  return (
    <section className="card">
      <header>
        <h2>Items</h2>
        <span className="sub">
          {plan.mode === "starter"
            ? "Flex items absorb the surplus. Set a weight to pin one."
            : "Each piece at its preset weight unless you set one."}
        </span>
      </header>
      {plan.items.length === 0 && <p className="muted">No items yet. Add one below.</p>}
      {rows.map((row, i) => {
        if (!row.p) {
          return (
            <div className="item-row" key={rowKey(`${row.it.presetId}-${i}`)}>
              <div>
                <div className="title">Unknown preset</div>
                <div className="muted small">This preset was deleted.</div>
              </div>
              <button type="button" className="btn danger" onClick={() => remove(i)}>
                Remove
              </button>
            </div>
          );
        }
        const { it, p, doughId, dough } = row;
        const key = lineKey(p.id, doughId);
        // Named as every message names the line: "Loaf", "Loaf (Jalapeño cheddar)", "Loaf (dough x
        // not found)". A dough missing from the library computes as lean (decision 2).
        const label = lineLabel({
          name: p.name,
          presetId: p.id,
          key,
          doughId: dough ? doughId : LEAN_DOUGH_ID,
          doughName: dough ? dough.name : doughName(doughId),
        });
        const flex = p.flexPriority > 0 && it.weightOverride === undefined;
        const options = [LEAN_DOUGH_ID, ...library.map((d) => d.id)].filter(
          (id) => id === doughId || isFree(p.id, id),
        );
        if (!options.includes(doughId)) options.push(doughId);
        // Only when there is a choice: never without a library, unless a dough has gone and lean
        // is free to take the line back.
        const showSelect = options.length > 1;
        let doughBadge: React.ReactNode = null;
        if (!dough) {
          doughBadge = <span className="badge bad">dough not found</span>;
        } else if (doughId !== LEAN_DOUGH_ID) {
          const how = effectiveMethod(dough) === "split" ? "split" : "separate mix";
          doughBadge = (
            <span className="badge">
              {how}: {dough.name}
            </span>
          );
        }
        return (
          <div className="item-row" key={rowKey(key)}>
            <div>
              <div className="title">
                {p.icon} {p.name}{" "}
                {flex ? (
                  <span className="badge neutral">flex {p.flexPriority}</span>
                ) : (
                  <span className="badge neutral">fixed</span>
                )}
                {doughBadge && <> {doughBadge}</>}
              </div>
              <div className="muted small">
                {p.defaultWeight} g default · {p.minWeight}–{p.maxWeight} g
              </div>
              {showSelect && (
                <select
                  value={doughId}
                  onChange={(e) => setDough(i, p, e.target.value)}
                  aria-label={`Dough for ${label}`}
                >
                  {options.map((id) => (
                    <option key={id} value={id}>
                      {optionLabel(id)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="row">
              <div className="stepper" aria-label={`${label} count`}>
                <button
                  type="button"
                  onClick={() => (it.count <= 1 ? remove(i) : update(i, { count: it.count - 1 }))}
                  aria-label="Fewer"
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={it.count}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    if (Number.isInteger(n) && n >= 0) update(i, { count: Math.min(99, n) });
                  }}
                  aria-label={`${label} count`}
                />
                <button
                  type="button"
                  onClick={() => update(i, { count: Math.min(99, it.count + 1) })}
                  aria-label="More"
                >
                  +
                </button>
              </div>
            </div>
            <div className="override">
              <NumberField
                label="Weight each"
                value={it.weightOverride}
                onChange={(v) => update(i, { weightOverride: v })}
                unit="g"
                min={1}
                max={5000}
                allowEmpty
                placeholder={String(p.defaultWeight)}
              />
              {it.weightOverride !== undefined && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => update(i, { weightOverride: undefined })}
                >
                  Unpin
                </button>
              )}
            </div>
          </div>
        );
      })}
      <div className="row" style={{ marginTop: 12 }}>
        <select
          value={adding}
          onChange={(e) => add(e.target.value)}
          aria-label="Add an item"
          disabled={addable.length === 0}
          style={{ flex: 1, minWidth: 0 }}
        >
          <option value="">{addable.length === 0 ? "All presets added" : "Add an item…"}</option>
          {addable.map(({ p, doughId }) => {
            // Say where the piece will land, unless that is lean for a preset on lean anyway, or a
            // dough the library has lost (the row says so once it is added).
            const plain = doughId === LEAN_DOUGH_ID && defaultDoughOf(p) === LEAN_DOUGH_ID;
            const on = !plain && findDough(doughId, doughs) ? ` · ${doughName(doughId)}` : "";
            return (
              <option key={p.id} value={p.id}>
                {p.icon} {p.name} ({p.defaultWeight} g){on}
              </option>
            );
          })}
        </select>
      </div>
      {showAddInsBox && (
        <div style={{ marginTop: 10 }}>
          <label className="check">
            <input
              type="checkbox"
              checked={plan.weightsIncludeAdditions !== false}
              onChange={(e) => setWeightsIncludeAdditions(e.target.checked)}
              aria-describedby={hintId}
            />
            <span>Planned weights include add-ins</span>
          </label>
          <p className="muted small" id={hintId}>
            Ticked, a 600 g jalapeño loaf is 600 g finished with 506 g of dough in it. Unticked, it
            is 600 g of dough with the add-ins on top.
          </p>
        </div>
      )}
    </section>
  );
}
