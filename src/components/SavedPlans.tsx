import { useState } from "react";
import type { Plan } from "../lib/types";
import type { SavedPlan } from "../lib/storage";
import { newId } from "../lib/ids";

interface Props {
  plan: Plan;
  saved: SavedPlan[];
  onSaved: (list: SavedPlan[]) => void;
  onLoad: (plan: Plan) => void;
}

export function SavedPlans({ plan, saved, onSaved, onLoad }: Props) {
  const [name, setName] = useState(plan.name ?? "");
  const save = () => {
    const n = name.trim() || `Bake ${new Date().toLocaleDateString()}`;
    const entry: SavedPlan = {
      id: newId("saved"),
      name: n,
      savedAt: new Date().toISOString(),
      plan: { ...plan, name: n },
    };
    onSaved([entry, ...saved.filter((s) => s.name !== n)]);
    setName(n);
  };
  return (
    <section className="card no-print">
      <header>
        <h2>Saved plans</h2>
      </header>
      <div className="row">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Weekend bake: 2 loaves + 2 pizzas + 4 rolls"
          aria-label="Plan name"
          style={{ flex: 1, minWidth: 160 }}
        />
        <button type="button" className="btn primary" onClick={save}>
          Save current
        </button>
      </div>
      {saved.length > 0 && (
        <div className="stack" style={{ marginTop: 10 }}>
          {saved.map((s) => (
            <div className="row between" key={s.id}>
              <div>
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div className="muted small">
                  {s.plan.mode === "starter"
                    ? `${s.plan.starterWeight ?? 0} g starter`
                    : "from items"}{" "}
                  · {s.plan.items.reduce((n, i) => n + i.count, 0)} pieces · saved{" "}
                  {new Date(s.savedAt).toLocaleDateString()}
                </div>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    onLoad({
                      ...s.plan,
                      id: newId("plan"),
                      startTime: new Date().toISOString(),
                    })
                  }
                >
                  Load
                </button>
                <button
                  type="button"
                  className="btn ghost danger"
                  onClick={() => {
                    if (confirm(`Delete "${s.name}"?`)) onSaved(saved.filter((x) => x.id !== s.id));
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
