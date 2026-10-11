// The plans the screenshot and print scripts open, as the app stores them (src/lib/storage.ts):
// each key of a state is written to localStorage as `sourdough.v1.<key>` before the app loads.
// `plan` is required; `doughs` and `presets` replace the library (left out, the app's defaults
// apply); `about` says what the state is for. The first six are the style review's
// (docs/style-review.md, "Screenshots"); `stress` holds the awkward shapes of PLAN-redesign §9.
//
// Times: a start of 09:00 Europe/London on Saturday 17 October 2026 (BST, so 08:00Z), as the
// plan's worked timelines; the browsers run in that time zone with an en-GB locale.
const START = "2026-10-17T08:00:00.000Z";

const DEFAULT = {
  starterHydration: 1,
  inoculation: 0.25,
  hydration: 0.75,
  salt: 0.02,
  benchLoss: 0.01,
  doughTempC: 24,
};
// The plan's REF settings (calc.test.ts): what worked examples B and B3 are computed on.
const REF = { ...DEFAULT, benchLoss: 0 };
// Ben's: 65 % reproduces the 54 g flour / 33 g water of his bread-roll screenshot.
const BEN = { ...DEFAULT, hydration: 0.65 };

/** The default dough library (src/lib/doughs.ts) as of the review, for states that change it. */
export const DEFAULT_DOUGHS = [
  {
    id: "soft-bun",
    name: "Soft bun dough",
    icon: "🍔",
    method: "separate",
    hydration: 0.65,
    salt: 0.018,
    enrichments: [
      { kind: "milk", pct: 0.35 },
      { kind: "egg", pct: 0.12 },
      { kind: "butter", pct: 0.12 },
    ],
    inclusions: [],
    bake: { tempC: 190, steam: false, wash: "Egg + a splash of milk" },
    notes:
      "Mix to a windowpane before the butter goes in. Bulk to doubled, proof to doubled; 88–93 °C inside, not to colour. A tangzhong (5 % of the flour at 1:5) makes it softer still.",
  },
  {
    id: "soft-sandwich",
    name: "Soft sandwich dough",
    icon: "🥪",
    method: "separate",
    hydration: 0.7,
    salt: 0.018,
    enrichments: [
      { kind: "milk", pct: 0.22 },
      { kind: "butter", pct: 0.12 },
    ],
    inclusions: [],
    bake: { tempC: 190, steam: false, wash: "None under a lid; egg wash if open" },
    notes: "Pain de mie style. Bulk to +40 %, proof to just below the rim of the tin.",
  },
  {
    id: "buttered",
    name: "Buttered (softer crumb)",
    icon: "🧈",
    method: "split",
    enrichments: [{ kind: "butter", pct: 0.08 }],
    inclusions: [],
    splitAt: "fold1",
    notes:
      "Dimple softened butter into the portion in thirds and fold until it disappears; it goes slimy for a while. Keep it cool. Expect a slightly slower rise.",
  },
  {
    id: "jalapeno-cheddar",
    name: "Jalapeño cheddar",
    icon: "🌶️",
    method: "split",
    enrichments: [],
    inclusions: [
      {
        kind: "cheese",
        name: "Mature cheddar",
        pct: 0.25,
        note: "Mostly grated, some chunks for pockets",
      },
      { kind: "chilli", name: "Jalapeño, fresh, diced", pct: 0.08 },
    ],
    splitAt: "fold1",
    notes: "Keep the cheese inside at shaping; parchment under the loaf. Bake as plain.",
  },
  {
    id: "seeded",
    name: "Seeded",
    icon: "🌻",
    method: "split",
    enrichments: [],
    inclusions: [
      {
        kind: "seed",
        name: "Mixed seeds (sunflower, sesame, flax)",
        pct: 0.15,
        soakerWaterPct: 0.15,
        note: "Soak in boiling water 5 h or overnight; drain",
      },
    ],
    splitAt: "fold1",
    notes: "Seeds on the crust darken fast: drop 10 °C if coating the outside.",
  },
];

/** The library with one dough changed (by id), or one added at the end. */
const withDough = (dough) =>
  DEFAULT_DOUGHS.some((d) => d.id === dough.id)
    ? DEFAULT_DOUGHS.map((d) => (d.id === dough.id ? dough : d))
    : [...DEFAULT_DOUGHS, dough];

const sandwichWithTangzhong = {
  ...DEFAULT_DOUGHS.find((d) => d.id === "soft-sandwich"),
  tangzhong: { flourPct: 0.05, ratio: 5 },
};

/** The splits with notes of several paragraphs, so the main dough's section outgrows a page. */
const SPLIT_NOTES = [
  {
    id: "buttered",
    notes:
      "Soften the butter to the give of the dough itself, not to grease: cold butter tears the dough and melted butter slicks it.\n\n" +
      "Dimple it into the portion in thirds, folding each in until it disappears. It goes slimy for a while and comes back by the next fold.\n\n" +
      "Keep it cool, and expect a slower rise: it may want half an hour more than the plain dough beside it.",
  },
  {
    id: "jalapeno-cheddar",
    notes:
      "Grate most of the cheddar and cut the rest into small cubes: the cubes make the pockets, the gratings the colour.\n\n" +
      "Pat the jalapeño dry before it goes in, and keep the cheese inside when you shape, or it burns on the crust.\n\n" +
      "Bake on parchment, as a plain loaf: the cheese that does reach the outside sticks to anything else.",
  },
  {
    id: "seeded",
    notes:
      "Soak the seeds the night before: boiling water over them, a lid on, and drain them well in the morning, or the dough slackens.\n\n" +
      "Work them in at fold 1 in two goes with a fold between. The dough tears at first and comes back together by fold 3.\n\n" +
      "For a seeded crust, roll the top in dry seeds before the banneton, and drop the oven by 10 °C: seeds on the outside darken fast.",
  },
].map((over) => ({ ...DEFAULT_DOUGHS.find((d) => d.id === over.id), ...over }));

/** A plan as `newPlan` makes one, in items mode from START, with `over` on top. */
const plan = (over) => ({
  id: "plan-screens",
  mode: "items",
  items: [],
  settings: { ...DEFAULT },
  startTime: START,
  timelineOverrides: {},
  feedStarter: false,
  autolyse: false,
  standMixer: false,
  ...over,
});

export const STATES = {
  lean: {
    about: "today's default plan: starter mode, 250 g, pizza ×2, bread roll ×4, loaf ×2",
    plan: plan({
      id: "plan-lean",
      mode: "starter",
      starterWeight: 250,
      items: [
        { presetId: "pizza", count: 2 },
        { presetId: "roll", count: 4 },
        { presetId: "loaf", count: 2 },
      ],
    }),
  },
  ben: {
    about: "Ben's case: two 600 g loaves on Jalapeño cheddar, items, tick box off, 65 %",
    plan: plan({
      id: "plan-ben",
      settings: { ...BEN },
      items: [{ presetId: "loaf", count: 2, doughId: "jalapeno-cheddar" }],
      weightsIncludeAdditions: false,
    }),
  },
  roll: {
    about: "one bread roll on Jalapeño cheddar, tick box off: 100 g + 20 g",
    plan: plan({
      id: "plan-roll",
      settings: { ...BEN },
      items: [{ presetId: "roll", count: 1, doughId: "jalapeno-cheddar" }],
      weightsIncludeAdditions: false,
    }),
  },
  b: {
    about: "worked example B: two plain loaves and eight 120 g rolls on Soft bun dough",
    plan: plan({
      id: "plan-b",
      settings: { ...REF },
      items: [
        { presetId: "loaf", count: 2 },
        { presetId: "roll", count: 8, weightOverride: 120, doughId: "soft-bun" },
      ],
    }),
  },
  b3: {
    about: "worked example B3: one 800 g loaf on Soft sandwich dough with a tangzhong",
    plan: plan({
      id: "plan-b3",
      settings: { ...REF },
      items: [{ presetId: "loaf", count: 1, weightOverride: 800, doughId: "soft-sandwich" }],
    }),
    doughs: withDough(sandwichWithTangzhong),
  },
  busy: {
    about: "a lean loaf, a jalapeño loaf, six burger buns, a sandwich loaf; feed and autolyse",
    plan: plan({
      id: "plan-busy",
      name: "Saturday bake",
      startTime: "2026-10-17T05:00:00.000Z", // 06:00 local: the feed runs first
      items: [
        { presetId: "loaf", count: 1 },
        { presetId: "loaf", count: 1, doughId: "jalapeno-cheddar" },
        { presetId: "burger-bun", count: 6 },
        { presetId: "loaf", count: 1, weightOverride: 800, doughId: "soft-sandwich" },
      ],
      feedStarter: true,
      autolyse: true,
      notes:
        "Cheese loaf for Sunday lunch; buns for the barbecue.\nSandwich loaf in the Pullman tin.",
    }),
  },
  stress: {
    about:
      "six doughs and eight lines: three splits with long notes off one main dough (a section " +
      "taller than a page), a tangzhong, a 40-character name with a three-paragraph note (its " +
      "colour wraps), feed on",
    plan: plan({
      id: "plan-stress",
      settings: { ...REF },
      items: [
        { presetId: "loaf", count: 1 },
        { presetId: "pizza", count: 2 },
        { presetId: "loaf", count: 1, doughId: "jalapeno-cheddar" },
        { presetId: "loaf", count: 1, doughId: "buttered" },
        { presetId: "roll", count: 6, doughId: "seeded" },
        { presetId: "burger-bun", count: 6 },
        { presetId: "loaf", count: 1, weightOverride: 800, doughId: "soft-sandwich" },
        { presetId: "loaf", count: 2, weightOverride: 900, doughId: "honey-long" },
      ],
      feedStarter: true,
    }),
    doughs: [
      ...[sandwichWithTangzhong, ...SPLIT_NOTES].reduce(
        (list, dough) => list.map((d) => (d.id === dough.id ? dough : d)),
        DEFAULT_DOUGHS,
      ),
      {
        id: "honey-long",
        name: "Honey and oat sandwich loaf for the week",
        icon: "🍯",
        method: "separate",
        hydration: 0.72,
        enrichments: [],
        inclusions: [],
        sweetness: { kind: "honey", pct: 0.08 },
        notes:
          "First paragraph of a long note: honey colours the crust early, so tent it after twenty minutes.\n\n" +
          "Second paragraph: the crumb stays moist for three days in a bag; freeze slices after that.\n\n" +
          "Third paragraph: a 10 % honey dough proofs slower, so give it the full window.",
      },
    ],
  },
};
