import { useRef, useState } from "react";
import { LEAN_DOUGH_ID, type Dough, type Preset, type ProofType } from "../lib/types";
import { DEFAULT_PRESETS, clonePresets } from "../lib/presets";
import { newId } from "../lib/ids";
import { NumberField } from "./NumberField";
import { DoughsCard, doughTitle } from "./DoughsCard";

interface Props {
  presets: Preset[];
  onChange: (next: Preset[]) => void;
  onExport: () => void;
  onImport: (text: string) => void;
  /** The dough library and its setter, for the Doughs card and each preset's Dough select. */
  doughs: Dough[];
  onDoughs: (next: Dough[]) => void;
}

const blank = (): Preset => ({
  id: newId("preset"),
  name: "New item",
  icon: "🍞",
  defaultWeight: 300,
  minWeight: 200,
  maxWeight: 400,
  flexPriority: 0,
  proof: "room",
  proofMinutes: [60, 120],
  bake: { tempC: 230, minutes: [20, 25], steam: false },
  note: "",
});

export function PresetsPage({ presets, onChange, onExport, onImport, doughs, onDoughs }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // The lean dough is the Batch settings, never a library entry (decision 1).
  const library = doughs.filter((d) => d.id !== LEAN_DOUGH_ID);

  const update = (id: string, patch: Partial<Preset>) =>
    onChange(presets.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= presets.length) return;
    const next = [...presets];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const remove = (p: Preset) => {
    if (confirm(`Delete "${p.name}"? Plans using it will show it as unknown.`)) {
      onChange(presets.filter((x) => x.id !== p.id));
    }
  };
  const add = () => {
    const p = blank();
    onChange([...presets, p]);
    setOpen(p.id);
  };
  const reset = () => {
    if (confirm("Replace all presets with the defaults? Your edits will be lost.")) {
      onChange(clonePresets(DEFAULT_PRESETS));
      setOpen(null);
    }
  };

  return (
    <div className="grid">
      <section className="card">
        <header>
          <h2>Presets</h2>
          <div className="row">
            <button type="button" className="btn primary" onClick={add}>
              Add preset
            </button>
            <button type="button" className="btn" onClick={reset}>
              Reset to defaults
            </button>
          </div>
        </header>
        <div className="stack">
          {presets.map((p, i) => (
            <div className="preset-card" key={p.id}>
              <header>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ flex: 1, textAlign: "left", whiteSpace: "normal" }}
                  onClick={() => setOpen(open === p.id ? null : p.id)}
                  aria-expanded={open === p.id}
                >
                  <strong>
                    {p.icon} {p.name}
                  </strong>{" "}
                  <span className="muted small">
                    {p.defaultWeight} g · {p.minWeight}–{p.maxWeight} g ·{" "}
                    {p.flexPriority > 0 ? `flex ${p.flexPriority}` : "fixed"} · {p.proof}
                    {p.doughId && p.doughId !== LEAN_DOUGH_ID && (
                      <> · {doughName(p.doughId, library)}</>
                    )}
                  </span>
                </button>
                <div className="actions">
                  <button
                    type="button"
                    className="btn icon"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn icon"
                    aria-label="Move down"
                    disabled={i === presets.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn icon danger"
                    aria-label="Delete"
                    onClick={() => remove(p)}
                  >
                    ×
                  </button>
                </div>
              </header>
              {open === p.id && (
                <PresetForm preset={p} doughs={library} onChange={(patch) => update(p.id, patch)} />
              )}
            </div>
          ))}
        </div>
      </section>

      <DoughsCard doughs={library} presets={presets} onChange={onDoughs} />

      <section className="card">
        <header>
          <h2>Backup</h2>
          <span className="sub">
            Presets, doughs, bulk table, saved plans and the current plan as JSON.
          </span>
        </header>
        <div className="row">
          <button type="button" className="btn" onClick={onExport}>
            Export JSON
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              onImport(await f.text());
              e.target.value = "";
            }}
          />
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          Everything lives in this browser. Export before clearing site data or moving to another
          device.
        </p>
      </section>
    </div>
  );
}

/** A preset's dough as its summary names it: the library name, or "<id> (not found)". */
function doughName(id: string, doughs: Dough[]): string {
  return doughs.find((d) => d.id === id)?.name ?? `${id} (not found)`;
}

/** What a dough's bake override sets, for the line under a preset's bake (decision 12). */
function bakeOverride(d: Dough): string | undefined {
  const b = d.bake;
  const parts = [
    ...(b?.tempC !== undefined ? [`${b.tempC} °C`] : []),
    ...(b?.steam !== undefined ? [b.steam ? "steam" : "no steam"] : []),
    ...(b?.wash?.trim() ? [`wash: ${b.wash.trim()}`] : []),
  ];
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function PresetForm({
  preset: p,
  doughs,
  onChange,
}: {
  preset: Preset;
  /** The dough library, lean excluded: the select lists the main dough first, then these. */
  doughs: Dough[];
  onChange: (patch: Partial<Preset>) => void;
}) {
  const doughId = p.doughId || LEAN_DOUGH_ID;
  const dough = doughs.find((d) => d.id === doughId);
  const dangling = doughId !== LEAN_DOUGH_ID && !dough;
  const override = dough && bakeOverride(dough);
  return (
    <div className="stack" style={{ marginTop: 10 }}>
      <div className="fields">
        <div className="field">
          <label htmlFor={`${p.id}-name`}>Name</label>
          <input
            id={`${p.id}-name`}
            type="text"
            value={p.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`${p.id}-icon`}>Icon</label>
          <input
            id={`${p.id}-icon`}
            type="text"
            value={p.icon ?? ""}
            maxLength={4}
            onChange={(e) => onChange({ icon: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`${p.id}-dough`}>Dough</label>
          <select
            id={`${p.id}-dough`}
            value={doughId}
            onChange={(e) =>
              onChange({
                doughId: e.target.value === LEAN_DOUGH_ID ? undefined : e.target.value,
              })
            }
          >
            <option value={LEAN_DOUGH_ID}>Main dough</option>
            {doughs.map((d) => (
              <option key={d.id} value={d.id}>
                {doughTitle(d)}
              </option>
            ))}
            {dangling && <option value={doughId}>{doughId} (not found)</option>}
          </select>
          <div className="hint">
            {dangling
              ? "Not in the library: items plan on the main dough."
              : "Unless an item picks another."}
          </div>
        </div>
        <NumberField
          label="Default weight"
          value={p.defaultWeight}
          onChange={(v) => onChange({ defaultWeight: v ?? p.defaultWeight })}
          unit="g"
          min={1}
        />
        <NumberField
          label="Minimum"
          value={p.minWeight}
          onChange={(v) => onChange({ minWeight: v ?? p.minWeight })}
          unit="g"
          min={1}
        />
        <NumberField
          label="Maximum"
          value={p.maxWeight}
          onChange={(v) => onChange({ maxWeight: v ?? p.maxWeight })}
          unit="g"
          min={1}
        />
        <NumberField
          label="Flex priority"
          value={p.flexPriority}
          onChange={(v) => onChange({ flexPriority: v ?? 0 })}
          min={0}
          max={9}
          integer
          hint="0 = fixed. Higher absorbs surplus first."
        />
        <div className="field">
          <label htmlFor={`${p.id}-proof`}>Final proof</label>
          <select
            id={`${p.id}-proof`}
            value={p.proof}
            onChange={(e) => onChange({ proof: e.target.value as ProofType })}
          >
            <option value="room">Room</option>
            <option value="cold">Cold retard</option>
            <option value="either">Either</option>
          </select>
        </div>
        <NumberField
          label="Proof from"
          value={p.proofMinutes[0]}
          onChange={(v) => onChange({ proofMinutes: [v ?? 0, p.proofMinutes[1]] })}
          unit="min"
          min={0}
          integer
        />
        <NumberField
          label="Proof to"
          value={p.proofMinutes[1]}
          onChange={(v) => onChange({ proofMinutes: [p.proofMinutes[0], v ?? 0] })}
          unit="min"
          min={0}
          integer
        />
        <NumberField
          label="Bake temperature"
          value={p.bake.tempC}
          onChange={(v) => onChange({ bake: { ...p.bake, tempC: v ?? p.bake.tempC } })}
          unit="°C"
          min={100}
          max={500}
          integer
        />
        <NumberField
          label="Bake from"
          value={p.bake.minutes[0]}
          onChange={(v) => onChange({ bake: { ...p.bake, minutes: [v ?? 0, p.bake.minutes[1]] } })}
          unit="min"
          min={1}
          integer
        />
        <NumberField
          label="Bake to"
          value={p.bake.minutes[1]}
          onChange={(v) => onChange({ bake: { ...p.bake, minutes: [p.bake.minutes[0], v ?? 0] } })}
          unit="min"
          min={1}
          integer
        />
      </div>
      <div className="row">
        <label className="check">
          <input
            type="checkbox"
            checked={p.bake.steam}
            onChange={(e) => onChange({ bake: { ...p.bake, steam: e.target.checked } })}
          />
          <span>Steam</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={!!p.hydrationSensitive}
            onChange={(e) => onChange({ hydrationSensitive: e.target.checked })}
          />
          <span>Warn above 80 % hydration</span>
        </label>
      </div>
      {dough && override && (
        <p className="muted small">
          {`${dough.name} sets ${override}; the dough's bake wins over this preset's, and the bake times stay these.`}
        </p>
      )}
      <div className="field">
        <label htmlFor={`${p.id}-note`}>Handling note</label>
        <textarea
          id={`${p.id}-note`}
          value={p.note ?? ""}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </div>
    </div>
  );
}
