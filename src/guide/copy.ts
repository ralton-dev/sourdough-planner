// Every word the guide says, in one place (decision 50), each keyed by the `data-guide` target it
// points at (decision 48). The walkthrough reads TOUR, the `?` on each card reads HINTS, the
// beacons read BEACONS; src/guide/targets.test.ts reads all three and checks that each target
// renders. Wording changes are an edit here and nowhere else.

/** The elements the guide may point at (decision 48). Nothing else is a target. */
export const GUIDE_TARGETS = [
  "items",
  "items.addins",
  "ingredients",
  "ingredients.split",
  "division",
  "timeline",
  "timeline.view",
  "doughs",
  "doughs.tangzhong",
  "backup",
  "account",
] as const;

export type GuideTarget = (typeof GUIDE_TARGETS)[number];

/** The CSS selector for a target: `[data-guide="items"]`. */
export const guideSelector = (target: GuideTarget): string => `[data-guide="${target}"]`;

/**
 * Targets the targets test skips. Empty since wave 3 put `backup` on the Presets page's Backup
 * card (`PresetsPage.tsx`) and `account` on the account menu (`AccountMenu.tsx`).
 */
export const WAVE_3_TARGETS: readonly GuideTarget[] = [];

/** One step of the walkthrough: what it lights and what its popover says. */
export interface TourStep {
  target: GuideTarget;
  title: string;
  body: string;
}

/**
 * The walkthrough (decision 49): six steps, all on the plan page. A step whose target is not on
 * the page is left out when the tour starts: the view toggle needs more than one dough, and the
 * account menu shows only when accounts are on.
 */
export const TOUR: readonly TourStep[] = [
  {
    target: "items",
    title: "What you are baking",
    body: "Add an item, say how many, and pick the dough each line is made from. Each piece weighs what its preset says unless you set a weight on the line.",
  },
  {
    target: "ingredients",
    title: "What goes in each bowl",
    body: "The main dough comes first. A split is a portion of it taken out at the end of the mix or at a fold, with butter or add-ins worked in, so it sits inside the main dough's section. Doughs with egg, milk or a tangzhong get a section of their own.",
  },
  {
    target: "division",
    title: "How to cut it",
    body: "What each piece weighs and how many to cut, grouped by the dough it comes from.",
  },
  {
    target: "timeline",
    title: "When to do what",
    body: "Clock times from the first step to the oven. Change a step's length in its box and the times after it follow.",
  },
  {
    target: "timeline.view",
    title: "In order or by dough",
    body: "With more than one dough, read the bake as one list in clock order, or as a track per dough.",
  },
  {
    target: "account",
    title: "Your planner, on every device",
    body: "Signed in, your presets, doughs and saved plans follow you. Signed out, they stay on this device.",
  },
];

/** A "show me" link on a hint card: it lights one element with a line of its own. */
export interface ShowMe {
  target: GuideTarget;
  /** What it shows, to follow "Show me": the link reads "Show me the add-ins tick box". */
  label: string;
  /** The one-line popover on the element it lights. */
  body: string;
}

/** A hint card: the `?` on a card lights the card and says this (decision 49). */
export interface Hint {
  target: GuideTarget;
  title: string;
  /** Two or three sentences. */
  body: string;
  showMe: readonly ShowMe[];
}

/** The cards with a `?`. */
export type HintCard = "items" | "ingredients" | "division" | "timeline" | "doughs" | "backup";

export const HINTS: Readonly<Record<HintCard, Hint>> = {
  items: {
    target: "items",
    title: "Items",
    body: "Each line is a preset, such as a loaf or a roll, made from a dough. The line starts on its preset's dough; pick another to bake it as a variation. When a dough carries add-ins like cheese or seeds, a tick box says whether your planned weight includes them.",
    showMe: [
      {
        target: "items.addins",
        label: "the add-ins tick box",
        body: "Ticked, a 600 g loaf weighs 600 g with its add-ins; unticked, the add-ins go on top.",
      },
    ],
  },
  ingredients: {
    target: "ingredients",
    title: "Ingredients",
    body: "One section per bowl, in grams. A split is part of the main dough taken out at the end of the mix or at a fold: weigh out the portion it names, work in its butter or add-ins, and leave the rest plain. Doughs with egg, milk, sugar or a tangzhong are mixed on their own.",
    showMe: [
      {
        target: "ingredients.split",
        label: "a split",
        body: "This dough leaves the main dough here: take the weight it says and work the add-ins in.",
      },
    ],
  },
  division: {
    target: "division",
    title: "Division",
    body: "What each piece weighs and how many to cut, grouped by the dough it comes from. From starter, whatever the items cannot use shows as spare, with a suggestion for it.",
    showMe: [],
  },
  timeline: {
    target: "timeline",
    title: "Timeline",
    body: "Clock times for every step, from the first to the oven. Change a step's length in its box and the times after it follow. With more than one dough, choose one list in order or a track per dough.",
    showMe: [
      {
        target: "timeline.view",
        label: "the two views",
        body: "One list in clock order, or a track per dough.",
      },
    ],
  },
  doughs: {
    target: "doughs",
    title: "Doughs",
    body: "Variations on the main dough. A split dough is a portion taken from the main dough at the end of the mix or at a fold, so it keeps the main dough's hydration and salt; a dough mixed separately has a bowl of its own. The tangzhong lives on a dough mixed separately: open one, such as Soft sandwich dough, and look for its Tangzhong part.",
    showMe: [
      {
        target: "doughs.tangzhong",
        label: "where the tangzhong lives",
        body: "Tick it to cook part of the flour with liquid first; the timeline gets a make-it-first step.",
      },
    ],
  },
  backup: {
    target: "backup",
    title: "Backup",
    body: "Export saves your presets, doughs, bulk table, saved plans, settings and the current plan to a file. Import replaces them with what the file holds, as a change made now; signed in, that change then reaches your other devices. Export first if you want to keep what is here.",
    showMe: [],
  },
};

/** A beacon: a dot on one control, with a sentence, shown until dismissed (decision 49). */
export interface Beacon {
  target: GuideTarget;
  title: string;
  /** One sentence. */
  body: string;
}

/** The targets that carry a beacon. */
export type BeaconTarget = "items.addins" | "timeline.view" | "doughs.tangzhong";

export const BEACONS: Readonly<Record<BeaconTarget, Beacon>> = {
  "items.addins": {
    target: "items.addins",
    title: "Add-ins",
    body: "Ticked, a planned weight includes the cheese or seeds; unticked, they go on top of it.",
  },
  "timeline.view": {
    target: "timeline.view",
    title: "Two ways to read it",
    body: "Switch between one list in clock order and a track for each dough.",
  },
  "doughs.tangzhong": {
    target: "doughs.tangzhong",
    title: "Tangzhong",
    body: "The tangzhong lives here, on doughs mixed separately: tick it to cook part of the flour first.",
  },
};

/** Every target the copy names, once each, in the order above. */
export function targetsInCopy(): GuideTarget[] {
  const named = [
    ...TOUR.map((s) => s.target),
    ...Object.values(HINTS).flatMap((h) => [h.target, ...h.showMe.map((m) => m.target)]),
    ...Object.values(BEACONS).map((b) => b.target),
  ];
  return [...new Set(named)];
}
