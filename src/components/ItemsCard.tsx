import { useState } from "react";
import type { ItemSelection, Plan, Preset } from "../lib/types";
import { NumberField } from "./NumberField";

interface Props {
  plan: Plan;
  presets: Preset[];
  onChange: (next: Plan) => void;
}

export function ItemsCard({ plan, presets, onChange }: Props) {
  const [adding, setAdding] = useState("");
  const setItems = (items: ItemSelection[]) => onChange({ ...plan, items });
  const update = (i: number, patch: Partial<ItemSelection>) =>
    setItems(plan.items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => setItems(plan.items.filter((_, k) => k !== i));
  const unused = presets.filter((p) => !plan.items.some((it) => it.presetId === p.id));

  const add = (presetId: string) => {
    if (!presetId) return;
    setItems([...plan.items, { presetId, count: 1 }]);
    setAdding("");
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
      {plan.items.map((it, i) => {
        const p = presets.find((x) => x.id === it.presetId);
        if (!p) {
          return (
            <div className="item-row" key={`${it.presetId}-${i}`}>
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
        const flex = p.flexPriority > 0 && it.weightOverride === undefined;
        return (
          <div className="item-row" key={p.id}>
            <div>
              <div className="title">
                {p.icon} {p.name}{" "}
                {flex ? (
                  <span className="badge neutral">flex {p.flexPriority}</span>
                ) : (
                  <span className="badge neutral">fixed</span>
                )}
              </div>
              <div className="muted small">
                {p.defaultWeight} g default · {p.minWeight}–{p.maxWeight} g
              </div>
            </div>
            <div className="row">
              <div className="stepper" aria-label={`${p.name} count`}>
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
                  aria-label={`${p.name} count`}
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
          disabled={unused.length === 0}
          style={{ flex: 1 }}
        >
          <option value="">{unused.length === 0 ? "All presets added" : "Add an item…"}</option>
          {unused.map((p) => (
            <option key={p.id} value={p.id}>
              {p.icon} {p.name} ({p.defaultWeight} g)
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
