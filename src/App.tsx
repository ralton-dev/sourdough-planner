import { useCallback, useMemo, useState } from "react";
import { computePlan } from "./lib/calc";
import { buildTimeline, type BulkRow } from "./lib/timeline";
import type { Dough, Plan, Preset } from "./lib/types";
import {
  DEFAULT_UI,
  KEYS,
  exportBundle,
  loadAll,
  parseBundle,
  type SavedPlan,
  type UiPrefs,
} from "./lib/storage";
import { usePersisted } from "./hooks";
import { SettingsCard } from "./components/SettingsCard";
import { ItemsCard } from "./components/ItemsCard";
import { IngredientsCard } from "./components/IngredientsCard";
import { DivisionCard } from "./components/DivisionCard";
import { NotesCard } from "./components/NotesCard";
import { TimelineCard } from "./components/TimelineCard";
import { SavedPlans } from "./components/SavedPlans";
import { PresetsPage } from "./components/PresetsPage";
import { KitchenMode } from "./components/KitchenMode";
import { Footer } from "./components/Footer";

type View = "plan" | "presets";

const initial = loadAll();

export function App() {
  const [presets, setPresets] = useState<Preset[]>(initial.presets);
  const [doughs, setDoughs] = useState<Dough[]>(initial.doughs);
  const [plan, setPlan] = useState<Plan>(initial.plan);
  const [bulkTable, setBulkTable] = useState<BulkRow[]>(initial.bulkTable);
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>(initial.savedPlans);
  const [ui, setUi] = useState<UiPrefs>({ ...DEFAULT_UI, ...initial.ui });
  const [view, setView] = useState<View>("plan");
  const [kitchen, setKitchen] = useState(false);

  usePersisted(KEYS.presets, presets);
  usePersisted(KEYS.doughs, doughs);
  usePersisted(KEYS.plan, plan);
  usePersisted(KEYS.bulkTable, bulkTable);
  usePersisted(KEYS.savedPlans, savedPlans);
  usePersisted(KEYS.ui, ui);

  const result = useMemo(() => computePlan(plan, presets, doughs), [plan, presets, doughs]);
  // The timeline reads the result rather than repeating the maths (§5), so they never disagree.
  const timeline = useMemo(
    () => buildTimeline(plan, presets, bulkTable, doughs, result),
    [plan, presets, bulkTable, doughs, result],
  );

  const closeKitchen = useCallback(() => setKitchen(false), []);

  const doExport = () => {
    const text = exportBundle({ presets, doughs, bulkTable, savedPlans, plan });
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sourdough-planner-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = (text: string) => {
    try {
      const b = parseBundle(text);
      const ok = confirm(
        "Replace presets, doughs, bulk table, saved plans and the current plan with this file?",
      );
      if (!ok) return;
      setPresets(b.presets);
      setDoughs(b.doughs);
      setBulkTable(b.bulkTable);
      setSavedPlans(b.savedPlans);
      setPlan(b.plan);
      setView("plan");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Import failed.");
    }
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <img className="logo" src="/favicon.svg" alt="" />
          <h1>Sourdough Planner</h1>
        </div>
        <nav className="nav" aria-label="Sections">
          <button
            type="button"
            aria-current={view === "plan" ? "page" : undefined}
            onClick={() => setView("plan")}
          >
            Plan
          </button>
          <button
            type="button"
            aria-current={view === "presets" ? "page" : undefined}
            onClick={() => setView("presets")}
          >
            Presets
          </button>
          <button type="button" onClick={() => setKitchen(true)}>
            Kitchen
          </button>
          <button type="button" onClick={() => window.print()} className="no-print">
            Print
          </button>
        </nav>
      </div>

      {view === "plan" ? (
        <div className="grid">
          <div className="grid two no-print">
            <SettingsCard plan={plan} onChange={setPlan} />
            <ItemsCard plan={plan} presets={presets} doughs={doughs} onChange={setPlan} />
          </div>
          <div className="grid two">
            <IngredientsCard
              plan={plan}
              result={result}
              halfGramSalt={ui.halfGramSalt}
              onHalfGram={(v) => setUi({ ...ui, halfGramSalt: v })}
            />
            <DivisionCard plan={plan} result={result} />
          </div>
          <NotesCard plan={plan} onChange={setPlan} />
          <TimelineCard
            plan={plan}
            presets={presets}
            timeline={timeline}
            bulkTable={bulkTable}
            onPlan={setPlan}
            onBulkTable={setBulkTable}
            starterTotal={result.starter}
          />
          <SavedPlans
            plan={plan}
            presets={presets}
            saved={savedPlans}
            onSaved={setSavedPlans}
            onLoad={setPlan}
          />
        </div>
      ) : (
        <PresetsPage
          presets={presets}
          onChange={setPresets}
          doughs={doughs}
          onDoughs={setDoughs}
          onExport={doExport}
          onImport={doImport}
        />
      )}

      <Footer />

      {kitchen && (
        <KitchenMode
          plan={plan}
          result={result}
          timeline={timeline}
          halfGramSalt={ui.halfGramSalt}
          onClose={closeKitchen}
        />
      )}
    </div>
  );
}
