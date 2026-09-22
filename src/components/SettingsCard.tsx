import type { Mode, Plan, Settings } from "../lib/types";
import { toLocalInput } from "../lib/format";
import { NumberField } from "./NumberField";

interface Props {
  plan: Plan;
  onChange: (next: Plan) => void;
}

export function SettingsCard({ plan, onChange }: Props) {
  const s = plan.settings;
  const setS = (patch: Partial<Settings>) => onChange({ ...plan, settings: { ...s, ...patch } });
  const setMode = (mode: Mode) => onChange({ ...plan, mode });

  return (
    <section className="card">
      <header>
        <h2>Batch</h2>
        <div className="toggle" role="group" aria-label="Planning mode">
          <button
            type="button"
            aria-pressed={plan.mode === "starter"}
            onClick={() => setMode("starter")}
          >
            From starter
          </button>
          <button
            type="button"
            aria-pressed={plan.mode === "items"}
            onClick={() => setMode("items")}
          >
            From items
          </button>
        </div>
      </header>
      <div className="stack">
        <p className="muted small">
          {plan.mode === "starter"
            ? "You have this much starter; the app sizes the batch and splits it across your items."
            : "You want these items; the app sizes the batch and tells you how much starter to have ready."}
        </p>
        <div className="fields">
          {plan.mode === "starter" ? (
            <NumberField
              label="Starter on hand"
              value={plan.starterWeight}
              onChange={(v) => onChange({ ...plan, starterWeight: v ?? 0 })}
              unit="g"
              min={0}
              max={5000}
            />
          ) : (
            <NumberField
              label="Starter available (optional)"
              value={plan.starterAvailable}
              onChange={(v) => onChange({ ...plan, starterAvailable: v })}
              unit="g"
              min={0}
              max={5000}
              allowEmpty
              placeholder="warn if short"
            />
          )}
          <NumberField
            label="Hydration"
            value={s.hydration}
            onChange={(v) => setS({ hydration: v ?? 0.75 })}
            scale={100}
            unit="%"
            min={50}
            max={110}
            hint="True hydration, starter included"
          />
          <NumberField
            label="Inoculation"
            value={s.inoculation}
            onChange={(v) => setS({ inoculation: v ?? 0.25 })}
            scale={100}
            unit="%"
            min={1}
            max={100}
            hint="Starter ÷ added flour"
          />
          <NumberField
            label="Starter hydration"
            value={s.starterHydration}
            onChange={(v) => setS({ starterHydration: v ?? 1 })}
            scale={100}
            unit="%"
            min={40}
            max={200}
          />
          <NumberField
            label="Salt"
            value={s.salt}
            onChange={(v) => setS({ salt: v ?? 0.02 })}
            scale={100}
            unit="%"
            min={0}
            max={5}
          />
          <NumberField
            label="Bench loss"
            value={s.benchLoss}
            onChange={(v) => setS({ benchLoss: v ?? 0 })}
            scale={100}
            unit="%"
            min={0}
            max={20}
          />
          <NumberField
            label="Dough temperature"
            value={s.doughTempC}
            onChange={(v) => setS({ doughTempC: v ?? 24 })}
            unit="°C"
            min={10}
            max={35}
            hint="Drives the bulk estimate"
          />
          <div className="field">
            <label htmlFor="start-time">Start time</label>
            <input
              id="start-time"
              type="datetime-local"
              value={toLocalInput(new Date(plan.startTime))}
              onChange={(e) => {
                const d = new Date(e.target.value);
                if (!Number.isNaN(d.getTime())) onChange({ ...plan, startTime: d.toISOString() });
              }}
            />
            <div className="hint">
              <button
                type="button"
                className="btn ghost small"
                style={{ padding: "2px 6px", minHeight: 0 }}
                onClick={() => onChange({ ...plan, startTime: new Date().toISOString() })}
              >
                Set to now
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
