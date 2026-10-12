// The guide's red pin (PLAN-accounts §7): every target the copy names renders as a `data-guide`
// attribute, exactly once, on the cards it lives on, built from the busy fixture the way App.tsx
// builds them, plus an opened dough form (the Tangzhong part lives only there), the Presets page
// (the Doughs card and the Backup card) and the account menu signed in.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { computePlan } from "../lib/calc";
import { cloneDoughs } from "../lib/doughs";
import { clonePresets } from "../lib/presets";
import { isPlan } from "../lib/storage";
import { DEFAULT_BULK_TABLE, buildTimeline } from "../lib/timeline";
import { DivisionCard } from "../components/DivisionCard";
import { AccountMenu } from "../components/AccountMenu";
import { DoughForm } from "../components/DoughsCard";
import { IngredientsCard } from "../components/IngredientsCard";
import { ItemsCard } from "../components/ItemsCard";
import { PresetsPage } from "../components/PresetsPage";
import { TimelineCard } from "../components/TimelineCard";
import { STATES } from "../../scripts/screens/states.mjs";
import { WAVE_3_TARGETS, targetsInCopy } from "./copy";

const noop = () => {};

/**
 * A fixture's plan cards, as App.tsx renders them on the plan page, the Doughs card, and the Soft
 * sandwich dough's form opened as the card opens it.
 */
function markup(state: keyof typeof STATES = "busy"): string {
  const plan: unknown = STATES[state].plan;
  if (!isPlan(plan)) throw new Error(`the ${state} fixture is not a plan`);
  const presets = clonePresets();
  const doughs = cloneDoughs();
  const bulkTable = DEFAULT_BULK_TABLE.map((r) => ({ ...r }));
  const result = computePlan(plan, presets, doughs);
  const softSandwich = doughs.find((d) => d.id === "soft-sandwich");
  if (!softSandwich) throw new Error("no Soft sandwich dough in the defaults");
  const timeline = buildTimeline(plan, presets, bulkTable, doughs, result);
  const cards: ReactElement[] = [
    createElement(ItemsCard, { plan, presets, doughs, onChange: noop }),
    createElement(IngredientsCard, { plan, result, halfGramSalt: false, onHalfGram: noop }),
    createElement(DivisionCard, { plan, result }),
    createElement(TimelineCard, {
      plan,
      presets,
      timeline,
      bulkTable,
      onPlan: noop,
      onBulkTable: noop,
      starterTotal: result.starter,
    }),
    // The Presets page holds the Doughs card and the Backup card. Every dough starts closed on the
    // card, so the Tangzhong part is reached by its form.
    createElement(PresetsPage, {
      presets,
      onChange: noop,
      onExport: noop,
      onImport: noop,
      doughs,
      onDoughs: noop,
      account: "in",
      syncLine: "Signed in as Ben, synced 21:14.",
    }),
    createElement(DoughForm, { dough: softSandwich, presets, onChange: noop }),
    createElement(AccountMenu, {
      me: { enabled: true, user: { name: "Ben", email: null } },
      status: { kind: "synced", at: "2026-10-12T20:14:00.000Z" },
      line: "Signed in as Ben, synced 21:14.",
    }),
  ];
  return cards.map((c) => renderToStaticMarkup(c)).join("\n");
}

const count = (html: string, target: string) => html.split(`data-guide="${target}"`).length - 1;

describe("guide targets", () => {
  it("the busy fixture renders all five cards and the controls the targets go on", () => {
    const html = markup();
    for (const title of ["Items", "Ingredients", "Division", "Timeline", "Doughs"]) {
      expect(html).toContain(`<h2>${title}</h2>`);
    }
    expect(html).toContain("Planned weights include add-ins"); // items.addins
    expect(html).toContain("split off"); // ingredients.split
    expect(html).toContain('aria-label="Timeline view"'); // timeline.view
  });

  it("every target the copy names renders exactly once", () => {
    const html = markup();
    const wanted = targetsInCopy().filter((t) => !WAVE_3_TARGETS.includes(t));
    expect(wanted.length).toBeGreaterThan(0);
    for (const target of wanted) {
      expect(count(html, target), `data-guide="${target}"`).toBe(1);
    }
  });

  it("the split target is on the first split only, on the stress plan too", () => {
    const html = markup("stress");
    expect(html.split("· split off").length - 1).toBeGreaterThan(1); // several splits
    expect(count(html, "ingredients.split")).toBe(1);
  });

  it("a card's ? is a button that names its card and does not print", () => {
    const html = markup();
    for (const title of ["Items", "Ingredients", "Division", "Timeline", "Doughs"]) {
      expect(html).toContain(`<h2>${title}</h2><button type="button" class="guide-q no-print"`);
      expect(html).toContain(`aria-label="About ${title}"`);
    }
  });
});
