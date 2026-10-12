// The guide's red pin (PLAN-accounts §7): every target the copy names renders as a `data-guide`
// attribute, exactly once, on the cards it lives on, built from the busy fixture the way App.tsx
// builds them. Failing until G2 adds the attributes; C2 adds the two in WAVE_3_TARGETS.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { computePlan } from "../lib/calc";
import { cloneDoughs } from "../lib/doughs";
import { clonePresets } from "../lib/presets";
import { isPlan } from "../lib/storage";
import { DEFAULT_BULK_TABLE, buildTimeline } from "../lib/timeline";
import { DivisionCard } from "../components/DivisionCard";
import { DoughsCard } from "../components/DoughsCard";
import { IngredientsCard } from "../components/IngredientsCard";
import { ItemsCard } from "../components/ItemsCard";
import { TimelineCard } from "../components/TimelineCard";
import { STATES } from "../../scripts/screens/states.mjs";
import { WAVE_3_TARGETS, targetsInCopy } from "./copy";

const noop = () => {};

/** The busy plan's cards, as App.tsx renders them on the plan page, and the Doughs card. */
function markup(): string {
  const plan: unknown = STATES.busy.plan;
  if (!isPlan(plan)) throw new Error("the busy fixture is not a plan");
  const presets = clonePresets();
  const doughs = cloneDoughs();
  const bulkTable = DEFAULT_BULK_TABLE.map((r) => ({ ...r }));
  const result = computePlan(plan, presets, doughs);
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
    // Every dough starts closed, so its Tangzhong part is not in this markup: G2 decides how the
    // test reaches `doughs.tangzhong` (an opened dough form), see the G1 report.
    createElement(DoughsCard, { doughs, presets, onChange: noop }),
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

  it.fails("every target the copy names renders exactly once", () => {
    const html = markup();
    const wanted = targetsInCopy().filter((t) => !WAVE_3_TARGETS.includes(t));
    expect(wanted.length).toBeGreaterThan(0);
    for (const target of wanted) {
      expect(count(html, target), `data-guide="${target}"`).toBe(1);
    }
  });
});
