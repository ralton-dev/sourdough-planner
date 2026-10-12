import { useCallback, useEffect, useMemo, useState } from "react";
import { computePlan } from "./lib/calc";
import { buildTimeline, type BulkRow } from "./lib/timeline";
import type { Dough, Plan, Preset } from "./lib/types";
import {
  DEFAULT_SYNC,
  DEFAULT_UI,
  KEYS,
  exportBundle,
  isSyncMeta,
  load,
  loadAll,
  parseBundle,
  type SavedPlan,
  type UiPrefs,
} from "./lib/storage";
import type { Mergeable, Section, SyncMeta } from "./lib/sync";
import { usePersisted } from "./hooks";
import { useSync } from "./sync/useSync";
import { signinNotice, withoutSignin } from "./sync/logic";
import { SettingsCard } from "./components/SettingsCard";
import { ItemsCard } from "./components/ItemsCard";
import { IngredientsCard } from "./components/IngredientsCard";
import { DivisionCard } from "./components/DivisionCard";
import { NotesCard } from "./components/NotesCard";
import { TimelineCard } from "./components/TimelineCard";
import { SavedPlans } from "./components/SavedPlans";
import { PresetsPage } from "./components/PresetsPage";
import { KitchenMode } from "./components/KitchenMode";
import { Footer, type AccountMode } from "./components/Footer";
import { AccountMenu } from "./components/AccountMenu";
import { GuideButton, firstRun } from "./guide/tour";
import { Beacons } from "./guide/hints";

type View = "plan" | "presets";

const initial = loadAll();
// Read once, like the rest: when each section last changed here and the server version last seen.
const initialSync = load<SyncMeta>(KEYS.sync, DEFAULT_SYNC, isSyncMeta);
// `?signin=denied|error` from the sign-in callback: read once, then gone from the address bar.
const initialSignin = typeof location === "undefined" ? "" : signinNotice(location.search);
if (initialSignin) {
  history.replaceState(
    null,
    "",
    `${location.pathname}${withoutSignin(location.search)}${location.hash}`,
  );
}

export function App() {
  const [presets, putPresets] = useState<Preset[]>(initial.presets);
  const [doughs, putDoughs] = useState<Dough[]>(initial.doughs);
  const [plan, putPlan] = useState<Plan>(initial.plan);
  const [bulkTable, putBulkTable] = useState<BulkRow[]>(initial.bulkTable);
  const [savedPlans, putSavedPlans] = useState<SavedPlan[]>(initial.savedPlans);
  const [ui, putUi] = useState<UiPrefs>({ ...DEFAULT_UI, ...initial.ui });
  const [syncMeta, setSyncMeta] = useState<SyncMeta>(initialSync);
  const [view, setView] = useState<View>("plan");
  const [kitchen, setKitchen] = useState(false);
  const [signin, setSignin] = useState(initialSignin);

  // Every change a person makes goes through one of these six, which stamps its section with the
  // moment of the change (decision 46), so sync knows what is newer without diffing. The `put…`
  // setters underneath stamp nothing: only `apply` (a merged document, with its own times) uses
  // them directly.
  const touch = useCallback((...sections: Section[]) => {
    const now = new Date().toISOString();
    setSyncMeta((m) => {
      const updatedAt = { ...m.updatedAt };
      for (const s of sections) updatedAt[s] = now;
      return { ...m, updatedAt };
    });
  }, []);
  const setPresets = useCallback(
    (next: Preset[]) => {
      putPresets(next);
      touch("presets");
    },
    [touch],
  );
  const setDoughs = useCallback(
    (next: Dough[]) => {
      putDoughs(next);
      touch("doughs");
    },
    [touch],
  );
  const setPlan = useCallback(
    (next: Plan) => {
      putPlan(next);
      touch("plan");
    },
    [touch],
  );
  const setBulkTable = useCallback(
    (next: BulkRow[]) => {
      putBulkTable(next);
      touch("bulkTable");
    },
    [touch],
  );
  const setSavedPlans = useCallback(
    (next: SavedPlan[]) => {
      putSavedPlans(next);
      touch("savedPlans");
    },
    [touch],
  );
  const setUi = useCallback(
    (next: UiPrefs) => {
      putUi(next);
      touch("ui");
    },
    [touch],
  );

  /** A merged document from sync: every section and its change times as the merge left them. */
  const apply = useCallback((b: Mergeable) => {
    putPresets(b.presets);
    putDoughs(b.doughs);
    putBulkTable(b.bulkTable);
    putSavedPlans(b.savedPlans);
    putPlan(b.plan);
    putUi({ ...DEFAULT_UI, ...b.ui });
    setSyncMeta((m) => ({ ...m, updatedAt: { ...b.updatedAt } }));
  }, []);
  const setVersion = useCallback(
    (version: number) => setSyncMeta((m) => (m.version === version ? m : { ...m, version })),
    [],
  );

  usePersisted(KEYS.presets, presets);
  usePersisted(KEYS.doughs, doughs);
  usePersisted(KEYS.plan, plan);
  usePersisted(KEYS.bulkTable, bulkTable);
  usePersisted(KEYS.savedPlans, savedPlans);
  usePersisted(KEYS.ui, ui);
  usePersisted(KEYS.sync, syncMeta);

  const sync = useSync({
    data: { presets, doughs, bulkTable, savedPlans, plan, ui },
    meta: syncMeta,
    apply,
    setVersion,
  });
  const account: AccountMode = !sync.me?.enabled ? "off" : sync.me.user ? "in" : "out";
  const meKnown = sync.me !== null;

  // The walkthrough's first run (decision 49): on the plan page, never in kitchen mode, once
  // /api/me has answered so the account step is on the page when accounts are on.
  useEffect(() => {
    if (meKnown) firstRun({ view, kitchen });
  }, [view, kitchen, meKnown]);

  const result = useMemo(() => computePlan(plan, presets, doughs), [plan, presets, doughs]);
  // The timeline reads the result rather than repeating the maths (§5), so they never disagree.
  const timeline = useMemo(
    () => buildTimeline(plan, presets, bulkTable, doughs, result),
    [plan, presets, bulkTable, doughs, result],
  );

  const closeKitchen = useCallback(() => setKitchen(false), []);

  const doExport = () => {
    const text = exportBundle({
      presets,
      doughs,
      bulkTable,
      savedPlans,
      plan,
      ui,
      updatedAt: syncMeta.updatedAt,
    });
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
      // Settings come only from a file that has them (version 3); an older file leaves them be.
      const withUi = b.updatedAt.ui !== undefined;
      const ok = confirm(
        withUi
          ? "Replace presets, doughs, bulk table, saved plans, settings and the current plan with this file?"
          : "Replace presets, doughs, bulk table, saved plans and the current plan with this file?",
      );
      if (!ok) return;
      // An import is a change made now: each section it replaces is stamped now, not with the
      // file's own times, so the next sync carries it to the account instead of losing it to a
      // newer copy on the server.
      putPresets(b.presets);
      putDoughs(b.doughs);
      putBulkTable(b.bulkTable);
      putSavedPlans(b.savedPlans);
      putPlan(b.plan);
      if (withUi) putUi({ ...DEFAULT_UI, ...b.ui });
      touch(
        "presets",
        "doughs",
        "bulkTable",
        "savedPlans",
        "plan",
        ...(withUi ? (["ui"] as const) : []),
      );
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
        <AccountMenu me={sync.me} status={sync.status} line={sync.line} />
      </div>

      {signin && (
        <p className="signin-notice no-print" role="status">
          <span>{signin}</span>
          <button
            type="button"
            className="btn ghost"
            aria-label="Dismiss"
            onClick={() => setSignin("")}
          >
            ×
          </button>
        </p>
      )}

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
          account={account}
          syncLine={sync.line}
          syncNotice={sync.notice}
          onDismissNotice={sync.dismissNotice}
        />
      )}

      <Footer account={account} guide={<GuideButton />} />
      {!kitchen && <Beacons />}

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
