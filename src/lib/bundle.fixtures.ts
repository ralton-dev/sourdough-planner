/**
 * Bundle fixtures shared by the client's tests and the server's (PLAN-accounts C1, P3). Plain data
 * only, no imports, so `server/state.test.mjs` can import this file and assert that its plain-JS
 * mirror of `isBundleShape` agrees with the client on exactly these inputs.
 */

/**
 * A version-2 export exactly as `exportBundle` wrote it at f72b7b0, before bundle version 3 (one
 * dough's note reworded; nothing else touched). Text, not an object, so the bytes stay as written.
 */
export const V2_EXPORT = `{
  "app": "sourdough-planner",
  "version": 2,
  "exportedAt": "2026-10-12T00:20:02.582Z",
  "presets": [
    {
      "id": "roll",
      "name": "Roll",
      "icon": "🥐",
      "defaultWeight": 70,
      "minWeight": 50,
      "maxWeight": 130,
      "flexPriority": 0,
      "proof": "room",
      "proofMinutes": [
        60,
        90
      ],
      "bake": {
        "tempC": 220,
        "minutes": [
          18,
          22
        ],
        "steam": true
      },
      "note": "Tight pre-shape; proofs fastest; bake first. Steam for the first 8 min.",
      "hydrationSensitive": true
    },
    {
      "id": "loaf",
      "name": "Loaf",
      "icon": "🍞",
      "defaultWeight": 600,
      "minWeight": 400,
      "maxWeight": 1000,
      "flexPriority": 2,
      "proof": "either",
      "proofMinutes": [
        90,
        180
      ],
      "bake": {
        "tempC": 250,
        "minutes": [
          40,
          45
        ],
        "steam": false
      },
      "note": "Boule or batard. Bench rest 20–30 min, shape, banneton. 250 °C lidded 20 min, then 230 °C uncovered 20–25 min."
    }
  ],
  "bulkTable": [
    {
      "tempC": 22,
      "minMinutes": 330,
      "maxMinutes": 390
    },
    {
      "tempC": 24,
      "minMinutes": 270,
      "maxMinutes": 330
    }
  ],
  "savedPlans": [],
  "plan": {
    "id": "plan-2b7c1d0e",
    "mode": "starter",
    "starterWeight": 250,
    "items": [
      {
        "presetId": "roll",
        "count": 4
      },
      {
        "presetId": "loaf",
        "count": 1,
        "doughId": "dough-milk"
      }
    ],
    "settings": {
      "starterHydration": 1,
      "inoculation": 0.25,
      "hydration": 0.75,
      "salt": 0.02,
      "benchLoss": 0.01,
      "doughTempC": 24
    },
    "startTime": "2026-10-12T07:30:00.000Z",
    "timelineOverrides": {
      "bulk": 300
    },
    "feedStarter": false,
    "autolyse": true,
    "standMixer": false
  },
  "doughs": [
    {
      "id": "dough-milk",
      "name": "Milk bread",
      "icon": "🥛",
      "method": "separate",
      "hydration": 0.68,
      "enrichments": [
        {
          "kind": "milk",
          "pct": 0.3
        },
        {
          "kind": "butter",
          "pct": 0.1,
          "addAt": "after-mix"
        }
      ],
      "inclusions": [
        {
          "kind": "seed",
          "name": "Sesame",
          "pct": 0.05,
          "addAt": "shape"
        }
      ],
      "tangzhong": {
        "flourPct": 0.05,
        "ratio": 5
      },
      "notes": "Milk, butter after the mix, sesame on top."
    }
  ]
}`;

/** A version-3 bundle with all six sections and a change time for each. */
export const V3_BUNDLE = {
  app: "sourdough-planner",
  version: 3,
  exportedAt: "2026-10-12T09:00:00.000Z",
  presets: [
    {
      id: "roll",
      name: "Roll",
      defaultWeight: 70,
      minWeight: 50,
      maxWeight: 130,
      flexPriority: 0,
      proof: "room",
      proofMinutes: [60, 90],
      bake: { tempC: 220, minutes: [18, 22], steam: true },
    },
  ],
  bulkTable: [{ tempC: 24, minMinutes: 270, maxMinutes: 330 }],
  savedPlans: [],
  plan: {
    id: "plan-v3",
    mode: "starter",
    starterWeight: 250,
    items: [{ presetId: "roll", count: 4 }],
    settings: {
      starterHydration: 1,
      inoculation: 0.25,
      hydration: 0.75,
      salt: 0.02,
      benchLoss: 0.01,
      doughTempC: 24,
    },
    startTime: "2026-10-12T07:30:00.000Z",
    timelineOverrides: {},
    feedStarter: false,
    autolyse: false,
    standMixer: false,
  },
  doughs: [],
  ui: { halfGramSalt: true },
  updatedAt: {
    presets: "2026-10-12T08:00:00.000Z",
    doughs: "2026-10-12T08:01:00.000Z",
    bulkTable: "2026-10-11T20:00:00.000Z",
    savedPlans: "2026-10-12T08:02:00.000Z",
    plan: "2026-10-12T08:59:00.000Z",
    ui: "2026-10-10T12:00:00.000Z",
  },
} as const;

/** `V3_BUNDLE` with `patch` laid over it; a key patched to `undefined` is removed. */
const v3With = (patch: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries({ ...V3_BUNDLE, ...patch }).filter(([, value]) => value !== undefined),
  );

/** Every input both checks must judge the same way: `ok` is what `isBundleShape` answers. */
export const SHAPE_CASES: readonly { name: string; value: unknown; ok: boolean }[] = [
  { name: "a version-3 bundle", value: V3_BUNDLE, ok: true },
  { name: "the version-2 export", value: JSON.parse(V2_EXPORT), ok: true },
  {
    name: "a version-1 export: no doughs, no settings",
    value: v3With({ version: 1, doughs: undefined, ui: undefined, updatedAt: undefined }),
    ok: true,
  },
  {
    name: "version 3 without change times",
    value: v3With({ updatedAt: undefined }),
    ok: true,
  },
  { name: "a non-bundle object", value: { hello: 1 }, ok: false },
  { name: "null", value: null, ok: false },
  { name: "an array", value: [V3_BUNDLE], ok: false },
  { name: "a string", value: "sourdough-planner", ok: false },
  { name: "another app", value: v3With({ app: "bread-planner" }), ok: false },
  { name: "version 4", value: v3With({ version: 4 }), ok: false },
  { name: "version as a string", value: v3With({ version: "3" }), ok: false },
  { name: "no version", value: v3With({ version: undefined }), ok: false },
  { name: "missing presets", value: v3With({ presets: undefined }), ok: false },
  { name: "missing plan", value: v3With({ plan: undefined }), ok: false },
  { name: "plan as an array", value: v3With({ plan: [] }), ok: false },
  { name: "bulk table as an object", value: v3With({ bulkTable: {} }), ok: false },
  { name: "version 3 missing doughs", value: v3With({ doughs: undefined }), ok: false },
  { name: "version 3 missing saved plans", value: v3With({ savedPlans: undefined }), ok: false },
  { name: "version 3 missing settings", value: v3With({ ui: undefined }), ok: false },
  { name: "version 2 with doughs null", value: v3With({ version: 2, doughs: null }), ok: false },
  { name: "settings as an array", value: v3With({ ui: [] }), ok: false },
  { name: "change times as an array", value: v3With({ updatedAt: [] }), ok: false },
  { name: "a change time as a number", value: v3With({ updatedAt: { plan: 1 } }), ok: false },
];
