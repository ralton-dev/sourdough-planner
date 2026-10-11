# Plan — doughs, variations and inclusions

Proposed 2026-10-11. Evidence: `docs/dough-variations-research.md` (R1 roll sizes, R2 enriched
doughs, R3 inclusions, R4 sugar and sweeteners); the plan cites it as R1–R4. Starting state: commit `187a90a`, clean
tree, CI green, 46 tests passing. There is no ORCHESTRATION.md and no earlier plan, so the
decisions below start at 1 and the verification gate is written out in §12.

`file:line` references are **hints to verify**: grep for the symbol, confirm it says what the
plan claims, and report drift rather than working around it.

---

## 1. The defect

Ben's words: 70 g is a dinner roll, not a bun; he wants to plan buns that need egg and butter
alongside plain loaves; he made a jalapeño-and-cheese loaf and had nowhere to record what he
added. What the code assumes, against what the bake needs:

| Surface (hint)                                           | Assumes                             | The bake needs                                                                                       |
| -------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/lib/presets.ts:9` `roll.defaultWeight: 70`, max 130 | a roll is 70 g                      | 70 g is a dinner roll in every source; a 4-inch bun is 100 g of dough, sourdough buns 120–135 g (R1) |
| `src/lib/types.ts:5` `Settings`                          | one hydration and one salt per plan | a bun dough at ~65 % true hydration with milk, egg and butter next to a 75 % lean loaf (R2)          |
| `src/lib/types.ts:14` `Preset`, `:31` `ItemSelection`    | an item is a weight and a bake      | an item is a weight, a bake **and a dough**                                                          |
| `src/lib/calc.ts:209` `computePlan`                      | one `Ingredients`                   | one per mix, plus add-in lines per dough                                                             |
| `src/lib/timeline.ts:122` `buildTimeline`                | one mix, one bulk, one divide       | a split step 30 min into bulk, or a second mix with its own bulk and divide                          |
| `grep -ril "butter\|egg\|cheese\|inclusion" src/`        | nothing (0 hits)                    | formula lines for them, as % of flour, like water and salt (R2, R3)                                  |
| `src/lib/types.ts:38` `Plan`                             | a plan has a `name`                 | a plan and a dough each carry notes: the record of what was adapted                                  |

**Reframing, one sentence: the unit of planning is the dough, not the batch.** A plan is one
bake with a base dough (the Batch settings) and any number of variant doughs; every item line
belongs to one dough. The packages, their order and the regression hunt all follow from it.

The research changes one thing in the request. Taking a portion of a mixed dough and working
something into it is sound for inclusions and for butter (R3 "Splitting one batch", R2
"Verdict"). It is **not** sound for egg, milk or sugar: no source adds them after gluten
development, and their water has to be inside the hydration from the start. So the planner
supports both a **split** (one mix, a portion taken out at a fold) and a **separate mix**,
chooses the mechanism from what the dough contains, and says why in the plan it prints.

---

## 2. Decisions — do not relitigate

1. **Doughs are a stored, user-editable library like presets** (`KEYS.doughs`), seeded with
   `DEFAULT_DOUGHS`, with "reset to defaults". The base dough is the plan's Batch settings; it
   has the reserved id `lean`, is not stored, and cannot be deleted or renamed.
2. **Every item line belongs to exactly one dough:** `ItemSelection.doughId`, else
   `Preset.doughId`, else `lean`. A line's **key** is `presetId` for lean and
   `presetId@doughId` otherwise. Lanes, lane step ids and React keys use the key. Lean keys
   and lean step ids (`mix`, `bulk`, `divide`, `bench`, `shape:loaf` …) are byte-identical to
   today, so saved plans and their `timelineOverrides` keep working untouched. A line whose
   dough id is not in the library keeps its own key, `presetId@<missing id>`, so it never
   collides with a lean line of the same preset; it computes as lean, is labelled "Lean
   (dough <id> not found)" and raises `unknown-dough`.
3. **Two mechanisms, chosen per dough:** `method: "auto" | "split" | "separate"`. Under
   `auto` the effective method is `separate` when the dough has egg, yolk, milk, a sweetness
   whose sugar-equivalent is above 5 % (sugar, honey or a bulk sweetener, not a
   high-intensity one), a tangzhong, or its own hydration or salt; otherwise `split`
   (inclusions, butter, oil). A forced `split` with any of the separate-only contents still
   computes but raises `split-needs-mix` (level warn). Grounds: R2 "Verdict".
4. **All percentages are of the dough's total flour, starter flour included** — the basis
   the app already uses for everything.
5. **Hydration is true hydration.** Water inside the starter, milk, egg, yolk, butter and
   honey counts at the R2 water fractions (`WATER_FRACTION`); inclusions and soaker water do
   not (BBGA convention, R3). Added water = target minus everything else. When that goes
   negative the water line is 0 and `liquid-exceeds-hydration` (warn) reports the hydration
   the liquids alone give.
6. **Whether a piece weight includes its add-ins is a tick box on the plan:**
   `Plan.weightsIncludeAdditions`, default on (undefined reads as `true`, so no saved plan
   moves). On, the PL and BBGA convention (R3 "Recording"): a 600 g jalapeño-cheddar loaf is
   a 600 g finished piece and the division card shows "600 g · 506 g dough + 94 g add-ins".
   Off: the planned weight is plain dough and the add-ins ride on top: "600 g dough +
   112 g add-ins = 712 g". Add-ins here are inclusions and soaker water only; enrichments,
   sweetness and tangzhong are the dough itself and sit inside the weight either way.
   Wordloaf's "reduce the dough by only 30–50 % of the inclusion weight" is not implemented
   in either mode. Settled 2026-10-11 (§11).
7. **Inoculation and starter hydration stay plan-wide.** Starter is apportioned between
   mixes in proportion to added flour. No per-dough inoculation in this plan.
8. **Allocation runs in flour grams.** Each line converts through its dough's
   `usablePerFlour = k_d × (1 − benchLoss)` (§4). The flex water-fill keeps its shape; only
   the unit changes. `spareOrShort` and the suggestions are reported in base-dough grams.
9. **Split doughs inherit the base hydration and salt.** You cannot change either after
   mixing. Their `hydration` and `salt` fields are ignored and the editor greys them out with
   that sentence.
10. **The bulk factor applies to bulk only, never to a preset's proof range** (enriched presets
    carry enriched proof ranges already, §6). Default when `bulkFactor` is undefined:
    `1 + 0.05 × max(0, sugarEq% − 3) + (butter% + oil% ≥ 20 ? 0.1 : 0)`, clamped to 1–2,
    percentages as whole numbers, where `sugarEq% = sweetness% × osmoticFactor(kind)` from
    the `SWEETENERS` table (sugar 1, honey 0.8, xylitol 1.2, erythritol 1.5,
    maltitol 0.5, high-intensity 0). No sugar gives 1.0 plus the fat term (R2 "Fermentation
    effects", R4). Shown as "a guide".
11. **Add-at defaults.** Inclusions: the §6 per-kind add-at (seed and herb at `mix`, garlic
    and porridge at `fold2`, the rest `fold1`), `fold1` when the table has none. Butter: `mix` up to 10 %, `after-mix` above.
    Egg, yolk, milk, oil and any sweetness: `mix`. In a split dough everything goes in at the split
    step (`splitAt`, default `fold1`), except `shape` inclusions, which become a note on the
    lane's shape step. `fold1` is 30 min into bulk and `fold2` 60 min, **whatever the fold
    count**, including 0.
12. **A dough's `bake` override (tempC, steam, wash) wins over the preset's**; bake durations
    stay the preset's. Enriched defaults: 190 °C, no steam, egg wash (R2 "Shaping, proofing,
    baking").
13. **Mix step:** 10 min lean (unchanged), 20 min for a separate enriched mix, with the
    butter-in-pieces note. The fold count stays plan-wide: a separate dough gets its own fold
    set at the same count from its own bulk start; a split dough shares the base folds that
    fall after its split.
14. **Presets.** `roll` becomes "Bread roll", 100 g (70–140), lean, 220 °C with steam,
    18–22 min (R1 bap/bun size). New: `dinner-roll` 70 g, `burger-bun` 120 g,
    `hot-dog-bun` 90 g, all on `soft-bun`, 190 °C, no steam (§6). Existing browsers:
    `reconcileDefaults` appends a default only when its id is in neither the stored list nor
    the browser's seeded record (`sourdough.v1.seeded`: the default ids this browser has
    already been given, written by `loadAll`), so a default the user deleted stays deleted;
    it replaces a stored entry only when it is deep-equal to its **previous** default
    (`LEGACY_PRESETS`); anything the user edited is left alone. Amended 2026-10-11 by WP-B:
    the first wording resurrected deletions on every reload.
15. **The §5.5 reference bake is frozen** on a `REF_PRESETS` fixture inside `calc.test.ts`,
    not on `DEFAULT_PRESETS`. Its numbers (1000 / 718.75 / 250 / 22.5 / 1991.25, loaf
    605.625) must not move by a gram, now or in any later plan.
16. **Storage:** namespace stays `sourdough.v1`; new keys `sourdough.v1.doughs` and
    `sourdough.v1.seeded` (decision 14); export
    bundle `version: 2` adds `doughs`; `parseBundle` accepts version 1 (doughs = defaults,
    presets reconciled) and 2. Nothing destructive.
17. **Doughs are edited on the Presets page** as a Doughs card between Presets and Backup.
    No new nav tab.
18. **Notes:** `Dough.notes` (the adaptation record, shown under its mix) and `Plan.notes`
    (this bake). Both print and both show in kitchen mode.
19. **No new dependencies and no component test framework.** Lib logic is unit-tested;
    components are typechecked, checked in the running app and by the print check.
20. **Tangzhong is in scope in its smallest form, and every surface the baker reads carries
    it.** `tangzhong: { flourPct, ratio }` on a separate dough. Its flour and liquid are two
    lines taken out of that mix's totals and shown as a "Tangzhong — make first" block with
    the cooking method on the ingredients card, in kitchen mode and in print (WP-F). A
    `tangzhong@<id>` step opens the timeline, before any feed or autolyse: 15 min when a
    feed or autolyse follows (it cools during them), 45 min otherwise, so it is cool by the
    mix (WP-D). Its note carries the grams and the method; the dough's mix note starts with
    the cooled paste going in with the liquids (§5). The editor field carries the hint
    (WP-E). No yudane variant, no hydration auto-adjustment (the hint says "soft doughs
    with a tangzhong want ~75 % true hydration"). Settled 2026-10-11: in, on condition the
    instructions reflect it, which is what this decision specifies.
21. **Waves 1–3 never break `App.tsx`.** Every new prop or parameter added before WP-H is
    optional with a lean default (`doughs = []`), so the app compiles and behaves exactly as
    today until wired. WP-H makes them required and deletes the defaults. (WP-E's
    `PresetsPage` shows no dough UI at all while its `doughs`/`onDoughs` props are absent,
    rather than an empty card with dead buttons: the same contract seen from the page.)
22. **Deletion belongs to the package that supersedes.** Every package that replaces a
    symbol deletes it in the same commit and reports per symbol: deleted, or kept with the
    name of who still calls it. "Nothing calls it any more, so I left it" is not an answer.
    A red build from a deletion is a result, not a failure.
23. **No sugar is the default.** Sweetness is a per-dough three-way choice: none, sugar
    (sugar, honey or syrup) or sweetener (xylitol, erythritol blends, maltitol, or a
    high-intensity sweetener), carried as one optional `sweetness` field, never as an
    enrichment. Every seeded dough, preset, worked example and hint is sugar-free. Sugar's
    only irreplaceable job is taste: the culture lives on flour, colour comes from milk and
    the wash, softness from butter, egg, milk and tangzhong, and the rise is better without
    it (R4). The planner treats a bulk sweetener as its sugar-equivalent for fermentation
    and says what each one cannot do. Allulose, the only sweetener that browns and softens,
    is left off the list: it is not authorised for sale in the EU or UK (R4; settled
    2026-10-11).

---

## 3. The model (WP-A implements this verbatim)

`src/lib/types.ts` gains:

```ts
export type DoughMethod = "auto" | "split" | "separate";
export type EffectiveMethod = "base" | "split" | "separate";
export type SplitAt = "mix" | "fold1" | "fold2";
export type EnrichmentAddAt = "mix" | "after-mix";
export type InclusionAddAt = "mix" | "fold1" | "fold2" | "lamination" | "shape";
export type EnrichmentKind = "butter" | "oil" | "egg" | "yolk" | "milk";
export type SweetKind =
  "sugar" | "honey" | "xylitol" | "erythritol" | "maltitol" | "high-intensity";
export type InclusionKind =
  | "cheese"
  | "chilli"
  | "olive"
  | "seed"
  | "nut"
  | "dried-fruit"
  | "chocolate"
  | "herb"
  | "garlic"
  | "porridge"
  | "other";

/** pct is a fraction of the dough's total flour, like every other ratio in the app. */
export interface Enrichment {
  kind: EnrichmentKind;
  pct: number;
  addAt?: EnrichmentAddAt;
}
export interface Inclusion {
  kind: InclusionKind;
  name: string;
  pct: number;
  addAt?: InclusionAddAt;
  /** Water the inclusion is soaked in, as a fraction of flour. Its own line; not hydration. */
  soakerWaterPct?: number;
  note?: string;
}
/** Decision 23. pct is a fraction of flour; for high-intensity kinds it is tiny (≈0.0002). */
export interface Sweetness {
  kind: SweetKind;
  pct: number;
}

export interface Dough {
  id: string;
  name: string;
  icon?: string;
  method: DoughMethod;
  /** Separate mixes only; undefined = the batch settings. Ignored for split doughs (decision 9). */
  hydration?: number;
  salt?: number;
  enrichments: Enrichment[];
  inclusions: Inclusion[];
  /** Undefined = no sugar (decision 23). */
  sweetness?: Sweetness;
  /** Separate mixes only: a cooked paste from this fraction of the dough's flour at liquid:flour = ratio. */
  tangzhong?: { flourPct: number; ratio: number };
  /** Split doughs only. Default fold1. */
  splitAt?: SplitAt;
  /** Multiplier on the bulk estimate. Undefined = derived (decision 10). */
  bulkFactor?: number;
  bake?: { tempC?: number; steam?: boolean; wash?: string };
  notes?: string;
}

export const LEAN_DOUGH_ID = "lean";
```

Existing types gain: `Preset.doughId?: string`, `ItemSelection.doughId?: string`,
`Plan.notes?: string` and `Plan.weightsIncludeAdditions?: boolean` (decision 6; undefined
means on).

Result types (also `types.ts`):

```ts
export interface AdditionLine {
  kind:
    | EnrichmentKind
    | SweetKind
    | InclusionKind
    | "soaker-water"
    | "tangzhong-flour"
    | "tangzhong-liquid";
  label: string; // "Mature cheddar", "Butter", "Soaker water (mixed seeds)"
  pct: number; // of this dough's flour
  grams: number;
  addAt: EnrichmentAddAt | InclusionAddAt | "split";
  note?: string;
}

export interface DoughResult {
  doughId: string;
  name: string;
  icon?: string;
  method: EffectiveMethod;
  mixId: string; // "base" or the dough id
  flour: number; // this dough's total flour, starter flour included
  water: number; // true total water
  starter: number;
  salt: number;
  addedFlour: number; // what to weigh for a separate mix; 0 for base and split
  addedWater: number; // likewise (0 when liquids exceed the target, decision 5)
  additions: AdditionLine[];
  additionsTotal: number;
  mass: number; // dough including additions, before bench loss
  usable: number; // mass × (1 − benchLoss)
  portion?: number; // split only: grams of base dough to take at the split
  trueHydration: number;
  bulkFactor: number;
  reason: string; // "Mixed separately: egg and milk have to go in with the water."
  notes?: string;
}

export interface MixResult extends Ingredients {
  id: string; // "base" or the dough id
  label: string; // "Main dough" or the dough name
  doughIds: string[]; // base mix lists lean plus its split doughs
  additions: AdditionLine[]; // separate mixes: enrichment and tangzhong lines; base: []
  mixMinutes: number; // 10 or 20 (decision 13)
}
```

`AllocationLine` gains `key: string`, `doughId: string`, `doughName: string`,
`doughEach: number` (plain dough per piece), `additionsEach: number` and `pieceEach: number`
(the finished piece: `weightEach` with the tick box on, `weightEach + additionsEach` with it
off, decision 6); `AllocationLine.subtotal` was deleted in wave 3 (no reader left, and with
the tick box off it was dough grams). `BatchResult` gains
`mixes: MixResult[]` and `doughs: DoughResult[]`; its inherited `Ingredients` fields become
**totals across mixes** (one mix → unchanged values, so every existing test still holds).

`src/lib/doughs.ts` (new) holds `DEFAULT_DOUGHS`, `WATER_FRACTION`, `ENRICHMENTS`,
`SWEETENERS`, `INCLUSIONS` (§6), and the pure helpers the other packages share:

```ts
export function resolveDoughId(sel: ItemSelection, preset: Preset): string;          // decision 2
export function lineKey(presetId: string, doughId: string): string;                   // decision 2
export function effectiveMethod(d: Dough): "split" | "separate";                      // decision 3
export function separateReasons(d: Dough): string[];                                  // ["egg", "milk"] …
export function defaultBulkFactor(d: Dough): number;                                  // decision 10
export function bulkFactorFor(d: Dough): number;                                      // override or default
export function enrichmentWater(d: Dough): number;                                    // Σ pct × WATER_FRACTION, sweetness included
export function sugarEquivalent(d: Dough): number;                                    // sweetness pct × osmoticFactor, decision 10
export function compositionFactor(d: Dough, base: Settings): number;                  // k_d, §4
export function doughOnlyFactor(d: Dough, base: Settings): number;                    // k_dough_d: k_d without inclusions and soaker water, §4
export function usablePerFlour(d: Dough, base: Settings, plan: Pick<Plan, "weightsIncludeAdditions">): number; // §4, decision 6
export function clamp01…  // whatever small helpers the above need; keep them here, not in calc.ts
```

---

## 4. The maths (WP-C implements; WP-A's pins assert it)

Notation per dough _d_: _H_ true hydration, _s_ salt, _e_j_ enrichment fractions (the sweetness,
if any, is one of them) with water fraction _w_j_, _I_ = Σ inclusion fractions, _K_ = Σ soaker-water fractions, _L_ bench loss.
Split doughs use the base _H_ and _s_ (decision 9).

```
k_dough_d    = 1 + H + s + Σ e_j·(1 − w_j)                  separate: the enrichment water comes off the water line
k_dough_d    = 1 + H + s + Σ e_j                            split: the base is already mixed, nothing comes off it
k_d          = k_dough_d + I + K                             dough grams per flour gram, add-ins in
trueHydration = H (separate) or H + Σ e_j·w_j (split)        a buttered split loaf is wetter than the base
usablePerFlour_d = (weightsIncludeAdditions ? k_d : k_dough_d) · (1 − L)       decision 6
flour needed by a line = count × weightEach / usablePerFlour_d
per piece, on:   doughEach = weightEach · k_dough_d / k_d   additionsEach = weightEach · (I + K) / k_d        pieceEach = weightEach
per piece, off:  doughEach = weightEach                     additionsEach = weightEach · (I + K) / k_dough_d  pieceEach = weightEach + additionsEach
```

**Starter mode.** Total flour `T = S/i + S/(1 + h_s)` is unchanged (`batchFromStarter`'s
first lines). Allocation water-fills in flour: `remainingFlour = T − Σ lineFlour`;
per-piece increment `Δw = remainingFlour / Σ_active(count / usablePerFlour)`; clamp to the
preset's min/max as now; repeat per tier. Spare is reported as `remainingFlour × k_base`.

**Items mode.** `T = Σ lineFlour` at base weights (replaces `requiredDough`), then
`addedFlour = T / (1 + i/(1 + h_s))` and `S = i × addedFlour` exactly as `batchFromItems`
does today; `inoculationForStarter` is unchanged.

**Per dough** (flour share `F_d` = Σ its lines' flour, plus unallocated flour on `lean`):

```
starter_d    = S · addedFlour_d / addedFlour        where addedFlour_d = F_d / (1 + i/(1+h_s))
starterWater = starter_d − starter_d/(1+h_s)
water_d      = H_d · F_d
enrichWater  = F_d · Σ e_j·w_j
addedWater_d = max(0, water_d − starterWater − enrichWater)      (warn when clamped)
salt_d       = s_d · F_d
additions    = [each enrichment: pct·F_d] + [each inclusion: pct·F_d] + [soaker water: K·F_d]
mass_d       = F_d · k_d          (= addedFlour_d + addedWater_d + starter_d + salt_d + Σ additions while nothing clamps)
               when addedWater_d clamps to 0, mass_d is the sum of the lines as weighed (F_d·k_d + the clamped
               shortfall): checkRow is the truth, and liquid-exceeds-hydration says how much heavier the dough is
portion_d    = F_d · (1 + H + s)  (split only: base dough to take out)
```

Rules §4 was silent on, settled in wave 2: in starter mode lean absorbs a shortage first; if
the library doughs alone need more flour than the batch holds, lean gets none and they shrink
in proportion. A mix whose total flour is 0 is absent: items mode with no lean or split line,
starter mode when the separate doughs take the whole batch, or no flour at all. It is omitted
from `mixes` and its doughs from `doughs` (a base mix takes its split doughs with it; they can
only be empty too). Otherwise starter mode keeps lean as the home of the spare flour. Spare is reported as `flour × k_base × (1 − L)`, the usable base
dough the old code reported. `checkRow` allows ±2 g plus 0.5 g per addition line. The
zero-flour rule applies to every mix, not only the base. Two item lines that resolve to the
same key (a preset's own dough changed to one a row already names) are merged in
`resolveLines`: counts summed, the first weight override kept; with different overrides the
later keys get `#2`, `#3` so nothing is dropped (wave 3).

**Worked example A3 — a split enrichment** (REF settings, starter mode 250 g; `loaf` ×1 at
600 on `buttered`, butter 8 % split, beside the flexing lean loaf of example A): k = 1 + 0.75

- 0.02 + 0.08 = 1.85, F = 324.324, portion 574.054, butter 25.946, mass 600.000, `pieceEach`
  600, true hydration 76.28 %; one mix, §5.5 totals unchanged.

**Mixes.** Base mix = lean + every split dough, pooled: its `Ingredients` are the plain
formula over `Σ F_d` (so the base mix is what you weigh and mix; the splits come out of it
later). Each separate dough is its own mix whose `additions` are its enrichment, soaker and
tangzhong lines. Tangzhong: `tangzhong-flour = flourPct · F_d` taken out of `addedFlour_d`;
`tangzhong-liquid = ratio × that`, taken from the milk line when the dough's milk covers it,
else from `addedWater_d` (one liquid, never a blend; if the water line cannot cover it the
line is clamped to what there is and `tangzhong-liquid-short` warns); the mix totals are
unchanged by it. Both lines carry `addAt: "mix"` and the note "Cook to 65 °C, stirring, to a
thick paste that holds a line. Cool to room temperature before it goes in. Made the day before
and kept in the fridge is fine: bring it back to room temperature." `BatchResult`'s top-level
`Ingredients` are the sums over mixes; `checkRow` runs per mix and adds the rounded addition
lines to its sum.

**Worked example A — split** (REF settings: `h_s` 1, `i` 0.25, `H` 0.75, `s` 0.02, `L` 0;
starter mode, 250 g; tick box on, the default). Items: `loaf` ×1 lean (flex 2, 400–1000), `loaf` ×1 on
`jalapeno-cheddar` pinned at 600. Jalapeño-cheddar = cheddar 25 % + jalapeño 8 %, split:

```
T = 1125       k_base = 1.77       k_v = 2.10
F_v = 600 / 2.10 = 285.714   cheddar 71.429   jalapeño 22.857   portion 505.714   (sum 600 ✓)
lean loaf: 600/1.77 = 338.983 flour; remaining 500.303 flour → +885.536 g → clamps at 1000 g
           (564.972 flour); remaining 274.314 flour = 485.536 g spare base dough
one mix:   added flour 1000, water 718.75, starter 250, salt 22.5, total 1991.25 (= §5.5)
doughs:    lean flour 839.286, mass 1485.536 (1000 used, 485.536 spare); jalapeño flour 285.714, mass 600
division:  loaf@jalapeno-cheddar "600 g · 506 g dough + 94 g add-ins"
```

**Worked example A2 — the tick box off** (the same plan with
`weightsIncludeAdditions: false`; the planned 600 g is plain dough):

```
F_v = 600 / 1.77 = 338.983   cheddar 84.746   jalapeño 27.119   portion 600   piece 711.864
lean loaf: 338.983 flour; remaining 447.034 flour → +791.25 g → clamps at 1000 g (564.972 flour);
           remaining 221.045 flour = 391.25 g spare base dough
one mix:   unchanged (added flour 1000, water 718.75, starter 250, salt 22.5, total 1991.25)
doughs:    lean flour 786.017, mass 1391.25 (1000 used, 391.25 spare); jalapeño flour 338.983, mass 711.864
division:  loaf@jalapeno-cheddar "600 g dough + 112 g add-ins = 712 g"
```

**Worked example B — separate** (REF settings; items mode). Items: `loaf` ×2 at 600 lean,
`roll` ×8 pinned at 120 on `soft-bun` (H 0.65, s 0.018, milk 35 %, egg 12 %, butter 12 %,
no sugar; water fractions milk 0.88, egg 0.76, butter 0.16):

```
k = 1 + 0.65 + 0.018 + 0.35·0.12 + 0.12·0.24 + 0.12·0.84 = 1.8396
F = 960 / 1.8396 = 521.853      added flour 463.869      starter 115.967 (water 57.984)
total water 339.204   enrichment water 218.343   added water 62.877
milk 182.648   egg 62.622   butter 62.622   salt 9.393      mass 960.000 ✓
bulk factor = 1 (no sugar; butter 12 % is under the 20 % fat term)
lean mix: flour 677.966, added flour 602.637, starter 150.659, water 433.145, salt 13.559, total 1200
totals:   starter 266.626, flour 1199.819
```

**Worked example B2 — the sugar term** (test-only dough `sweet-bun` = `soft-bun` plus
sweetness sugar 6 %): k = 1.8996, F = 505.370, sugar line 30.322 g, bulk factor
1 + 0.05·(6 − 3) = 1.15. With erythritol 4 % instead: sugar-equivalent 6 %, factor 1.15, k
= 1.8796.

**Worked example B3 — tangzhong** (REF settings; items mode; `loaf` ×1 at 800 on
`soft-sandwich` with `tangzhong: { flourPct: 0.05, ratio: 5 }`; H 0.70, s 0.018, milk 22 %,
butter 12 %, no sugar):

```
k = 1 + 0.70 + 0.018 + 0.22·0.12 + 0.12·0.84 = 1.8452      F = 800 / 1.8452 = 433.557
added flour 385.384   starter 96.346 (water 48.173)   total water 303.490
enrichment water 92.261   added water 163.056   milk 95.383   butter 52.027   salt 7.804   mass 800 ✓
tangzhong: flour 21.678 (5 % of F), liquid 108.389 (×5); the milk (95.383) does not cover it → water
as weighed: tangzhong 21.678 flour + 108.389 water (make first), then flour 363.706, water 54.667,
            starter 96.346, milk 95.383, butter 52.027, salt 7.804      (sum 800 ✓; mix totals unchanged)
bulk factor 1 (no sugar; butter 12 % is under the fat term)
```

**Worked example C — liquids exceed the target** (`soft-bun` edited to milk 55 %, egg 12 %,
butter 12 %, H 0.62; 500 g flour; 25 % inoculation): total water 310, starter water 55.556,
enrichment water 297.2 → added water −42.756 → **0**, `liquid-exceeds-hydration` reports
70.6 %.

---

## 5. The timeline shape (WP-D implements)

```ts
export interface DoughTrack {
  doughId: string;
  name: string;
  icon?: string;
  method: EffectiveMethod;
  steps: TimelineStep[];
  folds: Date[];
  bulk: BulkEstimate & { usedMinutes: number; doughFactor: number };
  benchEnd: Date;
  reason: string; // DoughResult.reason
}
export interface Timeline {
  steps: TimelineStep[]; // the common prefix: tangzhong@<id>…, feed?, autolyse?, mix
  tracks: DoughTrack[]; // base first, then separate and split doughs in library order
  foldCount: number;
  defaultFoldCount: number;
  lanes: Lane[]; // Lane gains key, doughId, doughName, label (format's lineLabel, re-exported by calc)
  ovenWarnings: string[];
  end: Date;
  /** @deprecated aliases of tracks[0]; WP-G deletes them with the UI that read them. */
  folds: Date[];
  bulk: BulkEstimate & { usedMinutes: number };
}
```

`buildTimeline(plan, presets, table, doughs = [], result = computePlan(plan, presets, doughs))`:
the timeline reads every gram, portion, addition line, mix length and lane from `computePlan`'s
result and computes none of it itself (settled in wave 2 after both agents found two copies of
the maths drifting at .5 g ties); `App.tsx` passes the result it already has. When the base mix
is absent (§4) there is no `mix`, no `autolyse` and no base track: the prefix is the tangzhong
steps and the feed, the first `mix@<id>` starts at its end, and `tracks[0]` is the first track
present. The timeline's test for "absent": no base mix in `result.mixes` (or its flour ≤ 0)
and no line riding on it; the second clause keeps a starter-mode plan with 0 g of starter from
losing its lean lanes while the field is being cleared.

Step ids and placement:

| Track           | Steps (id → default minutes)                                                                                                                                                                           | Starts                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| base (`lean`)   | `bulk` → table × inoculation factor, `divide` 15, `bench` 25 — **unchanged ids and defaults**                                                                                                          | at the end of `mix`                                                                   |
| separate `<id>` | `mix@<id>` 20 (10 if no enrichment), `bulk@<id>` → base estimate × `doughFactor`, `divide@<id>` 15, `bench@<id>` 25                                                                                    | `mix@<id>` after the previous mix ends (base first, then library order)               |
| split `<id>`    | `split@<id>` 10, `bulk@<id>` → base bulk end − split end (so it ends with the base unless its factor differs: then base bulk start + estimate × factor − split end), `divide@<id>` 15, `bench@<id>` 25 | `split@<id>` at base bulk start + 30 (`fold1`), + 60 (`fold2`), or at mix end (`mix`) |

Notes on steps carry the numbers: `split@jalapeno-cheddar` reads "Take 506 g of dough for
Jalapeño cheddar. Work in 71 g mature cheddar, 23 g jalapeño (fresh, diced). Keep it
separate from here on." `mix@soft-bun` reads the enriched mix routine (milk, egg,
starter, flour, salt to a windowpane; butter in pieces over 5–8 min; keep under 26 °C; no
sugar, so bake to 88–93 °C inside rather than to colour, and a young levain keeps it mild).
`tangzhong@soft-sandwich` (example B3; the first step of the common prefix, before any feed
or autolyse; 15 min when a feed or autolyse follows, 45 min otherwise, decision 20) reads
"Tangzhong for Soft sandwich dough: cook 22 g flour with 108 g water, stirring, to 65 °C, a
thick paste that holds a line. Cool to room temperature before it goes in. Made the day
before and kept in the fridge is fine: bring it back to room temperature. If it waits more
than about two hours (it will while the starter feeds), keep it in the fridge." `mix@soft-sandwich`
then opens with "Cooled tangzhong in with the milk and water," before the enriched routine.

The "reserve ~20 g water for the salt" sentence belongs to the plain mix note (the base mix,
or a separate dough with no enrichments) and appears only when that mix's water line holds
20 g or more; enriched mixes carry the enriched routine instead. The Ingredients card follows
the same rule. A plan whose batch has no flour (a starter of 0 g while the field is being
cleared) has no mixes and no doughs while its item lines remain; a lane whose dough has no
result falls back to the first track.

Folds: base and separate tracks get `foldCount` folds at 30-min intervals from their own
bulk start (existing rule); a split track lists the base folds that fall after its split.
Lanes start at their track's `benchEnd`; lane ids are `shape:<key>`, `proof:<key>`,
`bake:<key>`; a lane's bake temperature and steam come from the dough's `bake` override
when set (decision 12), its wash goes into the bake note as "190 °C, 18–22 min, wash: egg + a
splash of milk". `ovenConflicts` keeps its logic, names lanes by `label`, and now sees two
lanes for two loaves on different doughs — that is correct, they are two loaves. Example B
raises one itself: with `REF_PRESETS` the roll proofs 60 min, so `roll@soft-bun` bakes
16:20–16:42 against the loaf.

Worked timeline (example B, start 09:00, 24 °C, hand mixed): `mix` 09:00–09:10;
`mix@soft-bun` 09:10–09:30; `bulk` 09:10–14:10 with folds 09:40 10:10 10:40 11:10;
`bulk@soft-bun` 09:30–14:30 (300 min, factor 1) with folds 10:00 10:30 11:00 11:30;
`divide` 14:10, `bench` 14:25–14:50; `divide@soft-bun` 14:30, `bench@soft-bun` 14:45–15:10;
lane `loaf` shape 14:50, proof 90, bake 16:30–17:15; lane `roll@soft-bun` shape 15:10, proof
per preset. With the `sweet-bun` dough of B2 instead, its bulk runs 345 min to 15:15 and
everything on that track shifts 45 min later.
Worked timeline (example B3, start 09:00, no feed, no autolyse; the base mix is absent, so
there is no `mix` step and no base track): `tangzhong@soft-sandwich` 09:00–09:45,
`mix@soft-sandwich` 09:45–10:05, `bulk@soft-sandwich` 10:05–15:05 (300 min, factor 1), the
loaf bakes 17:25–18:10. With `feedStarter` on instead: `tangzhong@soft-sandwich` 09:00–09:15,
`feed` 09:15–15:15, `mix@soft-sandwich` 15:15–15:35.
Worked timeline (example A): `split@jalapeno-cheddar` 09:40–09:50, `bulk@jalapeno-cheddar`
09:50–14:10, its folds 10:10 10:40 11:10; two `loaf` lanes, keyed `loaf` and
`loaf@jalapeno-cheddar`, both baking 16:30–17:15 → one oven-clash warning.

---

## 6. Defaults (WP-A ships the tables and doughs; WP-B the presets)

`WATER_FRACTION` (R2): butter 0.16, oil 0, egg 0.76, yolk 0.52, milk 0.88; sweeteners: honey
0.17, every other kind 0.

`ENRICHMENTS` — label, typical range, default add-at, one-line effect shown as the field hint:

| kind   | typical % | add-at                   | hint                                                                                       |
| ------ | --------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| butter | 5–20      | mix ≤ 10, after-mix > 10 | Tender crumb, softer crust, keeps longer. Above 10 % it goes in after the gluten is built. |
| oil    | 2–10      | mix                      | Softer crumb, keeps longer, little flavour. Above 10 % it behaves like extra water.        |
| egg    | 10–30     | mix                      | Richer, softer, more volume, browns faster. Goes in with the liquid, always.               |
| yolk   | 5–15      | mix                      | Richer and more tender than whole egg.                                                     |
| milk   | 20–60     | mix                      | Softer crust, finer crumb, browner. Counts as 88 % water.                                  |

`SWEETENERS` — the three-way choice is none / sugar / sweetener (decision 23); each kind
carries sweetness relative to sugar, `osmoticFactor` (decision 10), whether it browns,
whether it softens, a typical range, and the hint shown under the field (R4):

| kind           | choice    | sweet    | osmotic | browns    | softens | typical                     | hint                                                                                                                                                                                              |
| -------------- | --------- | -------- | ------- | --------- | ------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)         | no sugar  | —        | 0       | —         | —       | —                           | Colour comes from the milk and the wash; softness from butter, egg, milk or a tangzhong. Ferments like a lean dough; bake to 88–93 °C inside, not to colour. A young levain keeps it mild.        |
| sugar          | sugar     | 1        | 1       | yes       | yes     | 3–10 %                      | Softer, browns faster. Slows the rise from about 5 %; a lot above 10 %.                                                                                                                           |
| honey          | sugar     | 1        | 0.8     | yes, fast | yes     | 3–10 %                      | Honey, maple or date syrup: still sugar, and browns faster than sugar. 17 % water.                                                                                                                |
| xylitol        | sweetener | 1        | 1.2     | no        | yes     | ≤ 5 %                       | As sweet as sugar, moist crumb, no browning: rely on the wash. Poisonous to dogs. Laxative above ~20 g.                                                                                           |
| erythritol     | sweetener | 0.7      | 1.5     | no        | no      | ≤ 4 %                       | Swerve, Lakanto and Truvia are erythritol. No browning, no softness, a cooling taste, can go gritty, and the strongest drag on the rise per gram.                                                 |
| maltitol       | sweetener | 0.9      | 0.5     | no        | yes     | 2–6 %                       | Softens and slows staling; pale crust. Laxative above ~60 g.                                                                                                                                      |
| high-intensity | sweetener | 200–600× | 0       | no        | no      | 0.02–0.03 g per 100 g flour | Pure stevia, monk fruit or sucralose: sweetness only, nothing else changes. Check the label: "cup-for-cup" blends are mostly dextrose or maltodextrin, which is sugar. Avoid sucralose in baking. |

Allulose is not in the table: it is not authorised for sale in the EU or UK (decision 23).
For `high-intensity` the editor labels the amount "g per 100 g flour" and shows two decimals;
the stored value is still a fraction of flour.

`INCLUSIONS` — label, typical %, default add-at, flags (`salty`, `sugary`, `fatty`, `dry`,
`wet`) and the note the planner prints:

| kind        | typical % | add-at | flags        | note                                                                            |
| ----------- | --------- | ------ | ------------ | ------------------------------------------------------------------------------- |
| cheese      | 25        | fold1  | salty, fatty | Keep it inside at shaping; parchment under the loaf.                            |
| chilli      | 8         | fold1  | wet          | Pat dry; sautéing first tames the water.                                        |
| olive       | 20        | fold1  | salty, wet   | Rinse and dry; drop the water up to 5 % if the dough goes slack.                |
| seed        | 15        | mix    | dry          | Soak 1:1 in boiling water (flax 1:3), drain. Seeds on the crust darken: −10 °C. |
| nut         | 15        | fold1  | dry          | Toast first. Soak if you want a softer bite.                                    |
| dried-fruit | 15        | fold1  | sugary       | Tuck pieces in at shaping; they burn. Can slow the rise.                        |
| chocolate   | 20        | fold1  | sugary       | Tuck under the pre-shaped round.                                                |
| herb        | 1         | mix    | —            | Start at 1 %.                                                                   |
| garlic      | 3.5       | fold2  | —            | Slows the rise; add late.                                                       |
| porridge    | 20        | fold2  | wet          | Slackens the dough late in bulk: −5 % water.                                    |
| other       | —         | fold1  | —            |                                                                                 |

`DEFAULT_DOUGHS` (fractions, not percentages, in code):

| id                 | name                       | method   | contents                                                                                                                                    | bake                                                   | notes (verbatim)                                                                                                                                                               |
| ------------------ | -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `soft-bun`         | Soft bun dough 🍔          | separate | H 0.65, s 0.018; milk 0.35, egg 0.12, butter 0.12, no sugar                                                                                 | 190 °C, no steam, "Egg + a splash of milk"             | Mix to a windowpane before the butter goes in. Bulk to doubled, proof to doubled; 88–93 °C inside, not to colour. A tangzhong (5 % of the flour at 1:5) makes it softer still. |
| `soft-sandwich`    | Soft sandwich dough 🥪     | separate | H 0.70, s 0.018; milk 0.22, butter 0.12, no sugar                                                                                           | 190 °C, no steam, "None under a lid; egg wash if open" | Pain de mie style. Bulk to +40 %, proof to just below the rim of the tin.                                                                                                      |
| `buttered`         | Buttered (softer crumb) 🧈 | split    | butter 0.08; splitAt fold1                                                                                                                  | —                                                      | Dimple softened butter into the portion in thirds and fold until it disappears; it goes slimy for a while. Keep it cool. Expect a slightly slower rise.                        |
| `jalapeno-cheddar` | Jalapeño cheddar 🌶️        | split    | cheese "Mature cheddar" 0.25 (note "Mostly grated, some chunks for pockets"); chilli "Jalapeño, fresh, diced" 0.08; splitAt fold1           | —                                                      | Keep the cheese inside at shaping; parchment under the loaf. Bake as plain.                                                                                                    |
| `seeded`           | Seeded 🌻                  | split    | seed "Mixed seeds (sunflower, sesame, flax)" 0.15, soakerWaterPct 0.15, note "Soak in boiling water 5 h or overnight; drain"; splitAt fold1 | —                                                      | Seeds on the crust darken fast: drop 10 °C if coating the outside.                                                                                                             |

`DEFAULT_PRESETS` after WP-B (order as listed; unchanged entries elided):

| id                                      | name           | g (min–max)  | dough      | proof        | bake                   | note                                                                |
| --------------------------------------- | -------------- | ------------ | ---------- | ------------ | ---------------------- | ------------------------------------------------------------------- |
| `roll`                                  | Bread roll 🥐  | 100 (70–140) | lean       | room 60–90   | 220 °C 18–22, steam    | Bap size. Tight pre-shape; proofs fastest; bake first. Steam 8 min. |
| `dinner-roll`                           | Dinner roll    | 70 (50–90)   | `soft-bun` | room 120–240 | 190 °C 20–24, no steam | Pan, touching. Egg wash. 88–93 °C inside.                           |
| `burger-bun`                            | Burger bun 🍔  | 120 (90–150) | `soft-bun` | room 120–240 | 190 °C 18–22, no steam | Flatten after shaping. Egg wash, sesame. 88–93 °C inside.           |
| `hot-dog-bun`                           | Hot dog bun 🌭 | 90 (70–110)  | `soft-bun` | room 120–240 | 190 °C 18–20, no steam | 15 cm logs, almost touching. Egg wash.                              |
| `loaf`, `pizza`, `baguette`, `focaccia` | unchanged      |              |            |              |                        |                                                                     |

`LEGACY_PRESETS` in `presets.ts` holds the previous `roll` entry byte-for-byte, so
`reconcileDefaults` can tell "unedited" from "edited" (decision 14).

---

## 7. Work packages

### WP-A · The dough model, library and red pins

**Goal:** the types, the seeded dough library, and failing tests that specify the maths and
the timeline — with the app compiling and behaving exactly as today.

- `types.ts`: everything in §3, verbatim. `BatchResult`/`Timeline` additions are typed now
  even though nothing fills them until WP-C/WP-D.
- `doughs.ts` (new): `WATER_FRACTION`, `ENRICHMENTS`, `SWEETENERS`, `INCLUSIONS`, `DEFAULT_DOUGHS`,
  `cloneDoughs`, and the helpers listed in §3, each with tests in `doughs.test.ts`
  (effective method for every default dough; `defaultBulkFactor` at sugar 0/5/10/20 % =
  1/1.1/1.35/1.85, erythritol 4 % = 1.15, high-intensity = 1, butter 25 % = 1.1;
  `enrichmentWater` for `soft-bun` = 0.4184; `compositionFactor` for `jalapeno-cheddar` =
  2.10, `soft-bun` = 1.8396, `soft-sandwich` = 1.8452 and `sweet-bun` = 1.8996;
  `doughOnlyFactor` for `jalapeno-cheddar` = 1.77 and `soft-bun` = 1.8396; `usablePerFlour`
  for `jalapeno-cheddar` = 2.10 with the tick box on and 1.77 off, at L 0; `lineKey` and
  `resolveDoughId` precedence).
- `calc.ts`: `computePlan(plan, presets, doughs: Dough[] = [])` — the parameter is accepted
  and ignored; `BatchResult` gets `mixes: []`, `doughs: []` and each `AllocationLine` its
  `key`, `doughId: "lean"`, `doughName: "Lean"`, `doughEach = weightEach`,
  `additionsEach = 0`, `pieceEach = weightEach`. No other behaviour change.
- `timeline.ts`: `buildTimeline(plan, presets, table, doughs: Dough[] = [])` likewise;
  `Timeline.tracks` is `[]`; lanes get `key = presetId`, `doughId`, `doughName`.
- `calc.test.ts`: freeze `REF_PRESETS` (a copy of today's five presets, `roll` at 70 g)
  and point every existing test at it instead of `DEFAULT_PRESETS`. Then the pins, as
  `it.fails`, with the expected figures from §4 written into the test's own comment: (A)
  worked example A — one mix, jalapeño dough flour/portion/addition grams, the lean loaf at
  1000 g, spare 485.5, `allocation` keys `loaf` and `loaf@jalapeno-cheddar`, the variant
  line's `doughEach` 505.714 and `pieceEach` 600; (A2) the same plan with
  `weightsIncludeAdditions: false` — jalapeño flour 338.983, portion 600, `pieceEach`
  711.864, spare 391.25, the mix unchanged; (B) worked
  example B — two mixes, every line of the soft-bun mix to 0.01 g, total starter 266.626,
  bulk factor 1; (B2) `sweet-bun` — sugar line 30.322 g, factor 1.15, and the erythritol
  variant from §4; (B3) worked example B3 — tangzhong lines 21.678 and 108.389 taken from the
  water line, flour 363.706 and water 54.667 as weighed, mix totals equal to the same dough
  without the tangzhong, both lines carrying the cook note; (C) the negative-water case
  raises `liquid-exceeds-hydration` and sets
  `addedWater` to 0; (D) a forced-split dough with egg raises `split-needs-mix`; (E) an item
  whose dough id does not exist raises `unknown-dough` and computes as lean.
- `timeline.test.ts`: pins as `it.fails`: (F) example A's split track — step ids
  `split@jalapeno-cheddar`, `bulk@jalapeno-cheddar`, `divide@…`, `bench@…`, split start =
  base bulk start + 30 min even with `foldCount: 0`, two `loaf` lanes with the keys above and
  one oven-clash warning; (G) example B's separate track — `mix@soft-bun` starts at `mix`
  end and lasts 20 min, `bulk@soft-bun` = 300 min and `bulk@sweet-bun` = 345 min, its folds
  at +30/+60/+90/+120 from its own bulk start, lane `roll@soft-bun` bake note "190 °C" and no
  steam; with `soft-sandwich` plus its tangzhong (B3): `tangzhong@soft-sandwich` is
  `steps[0]`, 45 min without a feed and 15 min with `feedStarter` on, the first mix starting
  at its end, its note containing "22 g flour" and "108 g water", and the `mix@soft-sandwich` note
  starting "Cooled tangzhong"; (H) base step ids and
  times for the all-lean plan are unchanged (`["mix","bulk","divide","bench"]`, folds as
  today) — this one passes now and must keep passing.
- Pins use `REF_PRESETS` plus explicit `doughId`s on the item lines, never the new preset
  ids (those arrive in WP-B).

**Acceptance:** `npm test` green with exactly ten `it.fails` cases in the tree; the
`doughs.test.ts` values above hold; the §5.5 reference numbers are asserted against
`REF_PRESETS`; `App.tsx` is untouched and the app behaves identically (check a saved plan
loads and the timeline is byte-identical).

Owns: `src/lib/types.ts`, `src/lib/doughs.ts` + `doughs.test.ts` (new), `src/lib/calc.ts`
(signature only), `src/lib/calc.test.ts`, `src/lib/timeline.ts` (signature only),
`src/lib/timeline.test.ts`.
Size **L**. Depends: none. Runs alone: `types.ts` is the choke point every package imports.

### WP-B · Bun-sized presets, dough persistence, bundle v2

**Goal:** the preset list says what the research says, existing browsers pick the change up
without losing edits, and doughs survive a reload and an export.

- `presets.ts`: the §6 preset table; `LEGACY_PRESETS`; `reconcileDefaults<T extends {id}>(stored, defaults, previous)`
  (generic; used for presets and doughs). `clonePresets` unchanged.
- `storage.ts`: `KEYS.doughs`; `isDoughList` (id string, name string, arrays present);
  `loadAll()` returns `doughs` and runs `reconcileDefaults` on both presets and doughs;
  `ExportBundle.version: 1 | 2`, `doughs?: Dough[]`; `exportBundle` writes 2;
  `parseBundle` accepts 1 (doughs = `cloneDoughs()`, presets reconciled) and 2.
  `exportBundle`'s `doughs` input is optional until WP-H (decision 21). `isPlan` and
  `newPlan` are untouched: `weightsIncludeAdditions` is optional and unset means on, so a new
  lean plan is byte-identical to today's. Pass `doughs` explicitly at every `exportBundle`
  call in `storage.test.ts`.
- Tests: `presets.test.ts` (new): `burger-bun` is ≥ 100 g on `soft-bun`; `roll` is 100 g;
  reconcile appends missing ids, replaces an entry deep-equal to `LEGACY_PRESETS.roll`,
  leaves an edited `roll` alone, preserves user order and user-added presets.
  `storage.test.ts`: v1 bundle imports with default doughs; v2 round-trips doughs;
  `loadAll` with an old `presets` value in localStorage gains the new presets.

**Acceptance:** a browser with today's unedited presets shows Bread roll 100 g, Dinner roll,
Burger bun and Hot dog bun after a reload with nothing else changed; a browser with an
edited `roll` keeps the edit and gains the three new presets; an export from `187a90a`
imports cleanly.

Owns: `src/lib/presets.ts`, `src/lib/presets.test.ts` (new), `src/lib/storage.ts`,
`src/lib/storage.test.ts`.
Size **M**. Depends: WP-A.

### WP-C · Multi-dough batch maths and warnings

**Goal:** `computePlan` returns mixes, doughs and per-dough allocation lines exactly as §4
specifies, and the five calc pins flip to plain assertions.

- `calc.ts`: `resolveLines` carries `doughId`, `key`, `usablePerFlour`; `allocate` works in
  flour (§4) and still returns the same shape for a lean-only plan; `batchFromFlour(T, s)`
  replaces the dough-grams inverse inside `batchFromItems` (keep `batchFromStarter` and
  `batchFromItems` exported — tests and the README name them — but implement them through
  the flour pivot); each line's `usablePerFlour` honours the plan's tick box and the
  per-piece `doughEach`/`additionsEach`/`pieceEach` follow §4 (decision 6); `perDough`,
  `perMix` builders; `requiredDough` is superseded by
  `requiredFlour` — delete it and update its callers (grep: `calc.ts` only).
  Unallocated flour in starter mode belongs to `lean`. Rename `_doughs` to `doughs` and drop
  its eslint-disable. `salt-range` also checks each separate dough's own salt; `below-min`
  names the line (preset and dough). Example C's `mass` is the sum of the lines, 959.556 g,
  not F·k (§4). Pass `doughs` explicitly at every `computePlan` call in `calc.test.ts`.
- `warnings.ts`: `high-hydration` uses each dough's `trueHydration` against the sensitive
  presets **on that dough**; new codes `liquid-exceeds-hydration` (warn), `split-needs-mix`
  (warn, names the offending contents), `unknown-dough` (warn), `inclusion-load` (info,
  total inclusions > 35 %), `salty-inclusions` (info, salty kinds ≥ 15 %: "some bakers drop
  the salt to 1.6–1.8 %"), `sugar-high` (info, sugar-equivalent > 12 %: "expect a slow bulk;
  a sweet or stiff levain helps"), `tangzhong-liquid-short` (warn: the water line cannot
  cover the tangzhong liquid, so the line is clamped), `xylitol-dogs` (info), `erythritol-fit` (info above
  4 %: "pale and drier; no browning or softness from erythritol"), `sweetener-label` (info for
  high-intensity: "check the bulking agent"), `butter-by-hand` (info, butter > 30 % and no
  stand mixer).
- `format.ts`: `checkRow(mix, halfGramSalt)` adds rounded addition lines; `fmtPctRange` if
  needed for the editor hints. Tests in `format.test.ts`.
- Flip pins A, A2, B, B2, B3, C, D and E to plain `it` and extend them with the awkward
  fixture (§10): bench loss 1 %, a weight override on a variant line, two variants on `loaf`
  plus plain `loaf` with the tick box off, items mode with `starterAvailable` short, a
  separate dough that also has inclusions, and `soft-sandwich` with a tangzhong whose milk
  does cover the liquid (milk 60 %, ratio 2: the liquid comes off the milk line) beside B3,
  where it does not.

**Acceptance:** worked examples A, A2, B, B2, B3 and C reproduce to 0.01 g; the all-lean plan returns
`mixes.length === 1`, `doughs.length === 1`, and every pre-existing assertion unchanged;
`checkRow` is `ok` for every mix of examples A, B and B3 at both salt roundings; no
`it.fails` remains in `calc.test.ts`; the symbol report names `requiredDough` as deleted.

Owns: `src/lib/calc.ts`, `src/lib/calc.test.ts`, `src/lib/warnings.ts`,
`src/lib/format.ts`, `src/lib/format.test.ts`.
Size **L**. Depends: WP-A.

### WP-D · Multi-dough timeline

**Goal:** `buildTimeline` returns the §5 tracks and lanes, and the three timeline pins flip.

- `timeline.ts`: build the common prefix (`tangzhong@<id>` first, one per separate dough
  that has one: 15 min when a feed or autolyse follows, 45 min otherwise, the note carrying
  the grams and the method per §5; then feed, autolyse, `mix`), then `tracks` per §5, with a
  dough's `mix@<id>` note opening on the cooled tangzhong when it has one, then lanes per
  (preset, dough) line keyed by
  `lineKey`, then `ovenConflicts(lanes)`. Base track keeps ids `bulk`/`divide`/`bench` and
  the existing defaults. `Timeline.folds`/`Timeline.bulk` stay as deprecated aliases of
  `tracks[0]` (decision 21; WP-G deletes them). `defaultFoldCount`/`foldCountFor` unchanged.
  Rename `_doughs` to `doughs` and drop its eslint-disable. `ovenConflicts` names lanes by
  lane name including the dough ("Loaf (Jalapeño cheddar)"). `end` and the lane fallback use
  each track's `benchEnd`, not the base one. Move the existing `t.folds`/`t.bulk` reads in
  `timeline.test.ts` to `tracks[0]`, keeping the alias-equality test in one block marked
  `// deprecated aliases: WP-G deletes`. Pass `doughs` explicitly at every `buildTimeline`
  call in the test file.
- Dough `bake` override applied to the lane's `bakeTempC`, `steam`, and the bake note (wash
  appended: "190 °C, 18–22 min, wash: egg + a splash of milk").
- Flip pins F and G (H passes already); add: a split dough with `bulkFactor` 1.2 ends later than the base and its
  divide follows; `splitAt: "mix"` starts the split at mix end; an override on
  `bulk@soft-bun` cascades into its divide, bench and lanes but not into the base track;
  `feedStarter` with two mixes produces one feed step; the B3 prefix with and without
  `feedStarter` (§5); the deprecated aliases equal `tracks[0].folds` and `tracks[0].bulk`.

**Acceptance:** worked timelines A, B and B3 reproduce to the minute; the all-lean plan's
`steps`+`tracks[0].steps` ids and times equal today's `steps`; no `it.fails` remains in
`timeline.test.ts`.

Owns: `src/lib/timeline.ts`, `src/lib/timeline.test.ts`.
Size **L**. Depends: WP-A.

### WP-E · Doughs editor

**Goal:** a Doughs card on the Presets page where Ben can create "add butter", "add egg",
"jalapeño and cheddar" and record what he did.

- `DoughsCard.tsx` (new), modelled on `PresetsPage`'s list + expandable form: name, icon,
  method (auto/split/separate) with a live line "Will be: mixed separately — egg and milk
  have to go in with the water" from `effectiveMethod`/`separateReasons`; hydration and salt
  (disabled with the decision-9 sentence when the effective method is split); enrichment
  rows (kind select showing the §6 hint, %, add-at for butter only); a sweetness row: radio
  "No sugar / Sugar / Sweetener", then a kind select limited to that choice, then the amount
  (% of flour, or "g per 100 g flour" for high-intensity) with the §6 hint and the label-check
  sentence under it; inclusion rows (kind,
  name, %, add-at, soaker water %, note); tangzhong (flour %, ratio; separate only) with the
  hint "Cook 5–10 % of the flour with five times its weight of liquid to 65 °C. Softer,
  moister, keeps longer; wants ~75 % true hydration. The planner takes the flour and liquid
  out of the mix and puts a make-it-first step on the timeline."; split-at
  (split only); bulk factor (placeholder = derived default, "a guide"); bake override
  (°C, steam, wash); notes textarea labelled "What you did and how it went". Add, delete
  (confirm, naming the presets whose default dough it is, and saying that plans using it
  fall back to the main dough with an `unknown-dough` warning), move, reset to defaults.
- `PresetsPage.tsx`: render `<DoughsCard>` between Presets and Backup; `PresetForm` gains a
  "Dough" select (lean + library) writing `doughId`; the Backup card text mentions doughs.
  New props `doughs?`, `onDoughs?` default to `[]`/no-op until WP-H. The collapsed preset
  summary (`PresetsPage.tsx:86-89`) shows the dough; the select shows a dangling id as
  "<id> (not found)".
- Reuse existing classes only (`card`, `preset-card`, `fields`, `field`, `stack`, `row`,
  `badge`, `muted`, `small`, `callout`, `check`); `styles.css` belongs to WP-G this wave.
  Percent fields use `NumberField` with `scale={100}` like `SettingsCard`.

**Acceptance:** every field round-trips through state; a new dough with butter 8 % shows
"split"; adding egg flips it to "separate" with the reason, as does
sugar at 6 %, while a high-intensity sweetener does not; a split dough's hydration field
is disabled with the sentence; `npm run typecheck` passes with `App.tsx` untouched.

Owns: `src/components/DoughsCard.tsx` (new), `src/components/PresetsPage.tsx`.
Size **L**. Depends: WP-A, WP-B.

### WP-F · Plan cards: items, ingredients, division, notes

**Goal:** the plan page shows which dough each item is on, one ingredient table per mix with
its add-ins, pieces grouped by dough with their composition, and the bake notes.

- `ItemsCard.tsx`: a dough select per row (lean + library, excluding doughs already used on
  the same preset) with a badge ("split" / "separate mix"); the add dropdown lists every
  preset and adds the first unused dough for it (its default first, then lean, then library
  order), disabled only when none is left; row key = `lineKey`. New prop `doughs?` defaults
  to `[]`. Under the rows, shown whenever an item sits on a dough with inclusions: a tick box
  "Planned weights include add-ins" bound to `plan.weightsIncludeAdditions` through the
  existing `onChange` (unticking writes `false`; ticking deletes the key), with the hint
  "Ticked, a 600 g jalapeño loaf is 600 g finished with 506 g of dough in it. Unticked, it is
  600 g of dough with the add-ins on top." (decision 6). A row whose preset carries a
  `doughId` lands on that dough and its badge names it ("separate mix: Soft bun dough"); the
  count field's aria-label uses `lineLabel` so two rows of one preset differ.
- `IngredientsCard.tsx`: `IngredientsTable` **keeps its name and props** and now renders one
  table per `result.mixes` entry (heading = `mix.label` with "Mixed separately: …" or "Split
  off at fold 1: …" from `DoughResult.reason`), each with its add-in lines, its own check
  row, and the dough notes under it; a mix with a tangzhong shows a "Tangzhong — make first"
  block above its lines (the first two entries of `mix.additions`, with their grams and the
  cook note; they are not on the `DoughResult`), and the flour and liquid lines below it are what is left after the
  tangzhong (decision 20); the header sub shows total flour and the base true hydration.
  The "keep ~20 g back for the salt" note shows only when that mix's added water covers it
  (a milk and egg mix can have 0 g, decision 5); the batch-level check row goes, one per mix
  replaces it; `result.mixes` can be empty (no flour at all), so render a placeholder line
  rather than nothing. `KitchenMode` picks this up unchanged (it imports `IngredientsTable`).
- `DivisionCard.tsx`: `Pieces` **keeps its name and props** and groups by dough with a
  heading per group, grouping by `allocation[].doughId` (in a no-flour plan a line's dough
  may have no `DoughResult`); each piece shows `count × pieceEach` and, when `additionsEach > 0`,
  "506 g dough + 94 g add-ins" (tick box on) or "600 g dough + 112 g add-ins = 712 g" (off);
  the card's sub line says which convention is in force. `key = l.key`. The "used of
  usable" line compares `Σ count × pieceEach` per dough with that dough's `usable` (equal
  except for lean's starter-mode spare and a clamped separate dough), never piece grams with
  mix totals (`DivisionCard.tsx:54,60` today).
- `NotesCard.tsx` (new): a textarea bound to `plan.notes`, printed as a card, heading
  "Notes". Rendered by WP-H.
- `Warnings` unchanged.

**Acceptance:** example A renders one table and two loaf pieces in two groups; A2 shows a
712 g piece with its 600 g dough line; example B renders two tables whose check rows are ✓;
B3 renders the tangzhong block, 22 g flour and 108 g water (whole grams, like every line),
above the soft-sandwich table; adding `loaf` twice yields the main dough then Soft bun dough
(the rule: the preset's own dough, then main, then library order); the print of the plan page (headless Chrome, see §12) splits no `.piece`
or table across pages.

Owns: `src/components/ItemsCard.tsx`, `src/components/IngredientsCard.tsx`,
`src/components/DivisionCard.tsx`, `src/components/NotesCard.tsx` (new).
Size **M**. Depends: WP-C.

### WP-G · Timeline card, kitchen mode, print

**Goal:** the timeline shows the common steps, one track per dough with its folds and split
step, and lanes labelled with their dough; kitchen mode and print mirror it.

- `TimelineCard.tsx`: render `timeline.steps`, then a block per `tracks` entry (heading
  with icon, name and method badge; its steps via `StepRow`, its folds line, its guide line
  with the dough factor when it is not 1, "×1.15 for the sugar, a heuristic"), then lanes
  headed by `lane.label`; durations editable per step id as now. Folds and the guide line hang
  off each track's bulk step (`bulk` or `bulk@<id>`), the stand-mixer sentence sits under every
  track's bulk, and the duration input's aria-label includes the step id so it stays unique
  across tracks. A plan with no base mix (§4) has no `mix` step and no base track: render what
  is there. Delete the reads of `timeline.folds` and `timeline.bulk` and, with them, the
  deprecated aliases in `timeline.ts` and the alias test block in `timeline.test.ts`
  (decision 22: report each symbol).
- `FeedHelper` gets `undefined` in items mode (`TimelineCard.tsx:183`, no `result` in the
  card): add an optional `starterTotal?: number` prop to `TimelineCard`, pass it to the
  helper; WP-H wires `result.starter`.
- `KitchenMode.tsx`: same structure read-only; `plan.notes` under the title; dough notes
  come through `IngredientsTable`; the tangzhong step and the tick-box wording arrive through
  `timeline.steps` and `Pieces`, nothing extra to render.
- `styles.css`: `.track` (and `.track h3`) with `break-inside: avoid` / `break-after: avoid`
  under `@media print` like `.lane`; the dough select in the item row; the piece-group
  heading; keep every new block out of the fragmenting grid rules (Firefox: no grid/flex
  fragmentation — see §12).
- Run the print check (§12) with examples A, B and B3 loaded: the timeline page must hold
  every `.step`, `.track` and `.lane` whole, the tangzhong step included.

**Acceptance:** worked timelines A, B and B3 appear with the times in §5; editing
`bulk@soft-bun` moves only that track; the printed PDF shows no split step, track or lane;
`grep -n "timeline.folds\|timeline.bulk" src/` returns nothing.

Owns: `src/components/TimelineCard.tsx`, `src/components/KitchenMode.tsx`,
`src/styles.css`, the two deprecated aliases in `src/lib/timeline.ts`, and the alias-equality
block marked `// deprecated aliases: WP-G deletes` in `src/lib/timeline.test.ts`.
Size **L**. Depends: WP-D. Owns the stylesheet choke point: runs with no other CSS editor.

### WP-H · Wire-up, defaults made required, README

**Goal:** the app uses all of it, nothing optional-with-a-default remains, and the README
says what the maths is now.

- `App.tsx`: `doughs` state from `initial.doughs`, `usePersisted(KEYS.doughs, doughs)`;
  `computePlan(plan, presets, doughs)`, `buildTimeline(plan, presets, bulkTable, doughs, result)`;
  pass `doughs` to `ItemsCard`, `doughs`/`onDoughs` to `PresetsPage`, `result.starter` to
  `TimelineCard` as `starterTotal`; render `NotesCard`
  after `DivisionCard`; export includes doughs; import replaces doughs (confirm text updated).
- Make every decision-21 default required: `computePlan`'s `doughs`, `buildTimeline`'s
  `doughs` and `result`, `ItemsCard.doughs`, `PresetsPage.doughs`/`onDoughs`,
  `TimelineCard.starterTotal`, `exportBundle`'s input (`Omit<ExportBundle, "app" | "version" | "exportedAt" | "doughs"> &
{ doughs: Dough[] }`; `ExportBundle.doughs?` itself stays optional for version-1 files, and
  `parseBundle` keeps its "version 2 without doughs" path). Delete the defaults and report each.
- `SettingsCard.tsx`: the hydration and salt hints say these are the main dough's; variants
  set their own on the Presets page. `FeedHelper.tsx`: the target field is set once at mount;
  re-sync it when the incoming target changes, leaving a typed value alone (the `seen` pattern
  in `NumberField`). `SavedPlans.tsx`: the summary line adds "· 2 doughs" when more than
  one dough is in use.
- `README.md`: "Modes" mentions doughs; "The maths" gains §4 in prose with worked example A;
  new "Doughs and variations" section (split vs separate, what counts as water, the add-ins
  tick box, tangzhong, the bulk heuristic); "Persistence" lists `sourdough.v1.doughs`,
  `sourdough.v1.seeded` (what it is for) and bundle v2.
  Point to `docs/dough-variations-research.md`.
- End-to-end: build, run the print check with the example A, A2, B and B3 plans, and leave
  `npm run dev` running on :5173 for Ben to look at before anything is pushed (§12).

**Acceptance:** `grep -rn "Dough\[\] = \[\]\|doughs?: Dough\[\]\|BatchResult = computePlan" src/`
shows only `ExportBundle.doughs?` in `storage.ts`; a fresh browser seeds five doughs and eight presets; a `187a90a` export imports; the
full gate (§12) passes; the PDFs are attached to the hand-back.

Owns: `src/App.tsx`, `src/components/SettingsCard.tsx`, `src/components/SavedPlans.tsx`,
`src/components/FeedHelper.tsx`, `README.md`, plus the one-line signature edits in `calc.ts`, `timeline.ts`, `storage.ts`,
`ItemsCard.tsx`, `PresetsPage.tsx` that make the defaults required (wave 4, nobody else is
editing).
Size **M**. Depends: WP-B, WP-E, WP-F, WP-G.

---

## 8. The red pin

WP-A writes ten `it.fails` tests (A, A2, B, B2, B3, C, D, E, F and G above; H passes
already) against the §4/§5 figures and sees them fail on the current commit; CI stays green
while the gap stands and the tree records that it is known. WP-C flips the calc pins and
WP-D the timeline pins **as part of their acceptance**. The plan is complete when:

```
grep -c "it.fails" src/lib/*.test.ts     → 0
npm test                                  → green, §5.5 figures unchanged against REF_PRESETS
```

and the worked-example PDFs from WP-H show nothing split across a page.

---

## 9. Wave table

| Wave | Packages           | Notes                                                                                                                                                         |
| ---- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | WP-A               | alone: owns `types.ts`, which every later package imports, and the pins                                                                                       |
| 2    | WP-B + WP-C + WP-D | disjoint: presets/storage vs calc/warnings/format vs timeline. B and C both read `doughs.ts`, neither edits it                                                |
| 3    | WP-E + WP-F + WP-G | disjoint: DoughsCard/PresetsPage vs Items/Ingredients/Division/Notes vs Timeline/Kitchen/styles. G alone owns `styles.css`; E and F use existing classes only |
| 4    | WP-H               | alone: `App.tsx` and the signature edits that touch five other files                                                                                          |

Checked against the `Owns` lists: no file appears twice in a wave. `KitchenMode` (G) keeps
compiling against F's changes because F keeps `IngredientsTable` and `Pieces` names and
props (stated in WP-F). Standing rules beneath the table:

- `src/lib/types.ts`, `src/App.tsx` and `src/styles.css` are choke points: one owner per
  wave, and that package runs with nothing else that could touch them.
- A package needing one line in a file it does not own says so in its hand-back and leaves
  the line to the owner or to WP-H; it does not edit the file.
- Wave-2 packages pass `doughs` explicitly at every `computePlan`, `buildTimeline` and
  `exportBundle` call in the test files they own, so WP-H can make the parameters required
  without editing tests.
- Accepted transient: between wave 2 and wave 3 the Timeline card and kitchen mode show only
  the common prefix, because `bulk`/`divide`/`bench` move into `tracks[0]` (WP-D) before
  anything renders tracks (WP-G). Wave-3 agents do not patch around it.
- Accepted transient: until WP-H wires `doughs`, `App.tsx` passes no library, so an item on
  one of WP-B's bun presets computes as lean with an `unknown-dough` warning. Lean plans are
  unaffected; nobody shows Ben buns before WP-H.

Rough total: four waves, eight packages.

---

## 10. Regression to fear

**The all-lean plan must not move at all.** Not a gram in the ingredients, not a minute in
the timeline, not a step id, not a lane key, not a saved plan's override, not a v1 export.
Every other number moves only for the reasons decisions 5–14 name. Pin H and the frozen
`REF_PRESETS` are the tripwire; WP-H's "a `187a90a` export imports" is the second.

Accepted movement, wave 3: the division card prints its pieces in block flow (inline-block,
four to a row) instead of flex, because Firefox does not fragment flex containers, so the lean
print's first page differs from the `187a90a` baseline in piece widths and in one wrap ("from
600 g" now stays on a line); the timeline pages are pixel-identical. On screen the piece count
is capped with a size container so "1 × 1000 g" no longer overflows at 760–1000 px. The
warnings' wording also moved ("short by X g of main dough"). Nothing numeric moved.

**Hunt for the assumption rather than assuming its absence.** The assumption is "there is
one dough", and it is written in more places than the evidence table lists. Known sites to
grep and clear, each of which a package must report as fixed or deliberately kept:

- `timeline.ts` `lanes.some((l) => l.presetId === p.id)` — dedupe by preset becomes dedupe by key.
- `ItemsCard.tsx` `unused = presets.filter(…)` — a preset can be added once per dough.
- `DivisionCard.tsx` `key={l.presetId}`, `TimelineCard.tsx` `key={lane.presetId}`,
  `KitchenMode.tsx` `key={lane.presetId}` — React keys become `key`.
- `warnings.ts` `sensitive` — hydration sensitivity is per dough.
- `calc.ts` `suggest()` — base weights are dough grams of **that** dough; the surplus is
  base-dough grams.
- `FeedHelper.tsx` `targetGrams` — total starter is the sum over mixes (it reads
  `plan.starterWeight`, which is still that sum in starter mode; in items mode `result.starter`
  is already the total — verify, don't assume).
- `IngredientsCard.tsx` header "total flour · true hydration" — per mix now.
- `SavedPlans.tsx` pieces count — still right; dough count added.
- `format.ts` `checkRow` — per mix, including add-ins.
- `weightEach` everywhere — the planned weight is no longer always the finished piece
  (decision 6). Every reader (`DivisionCard`, `KitchenMode`, `SavedPlans`' summary,
  `suggest()`) says which of `pieceEach` and `doughEach` it means.
- `timeline.ts` `ovenConflicts` — names lanes by preset name; two loaves read "Loaf, Loaf"
  (WP-D).
- `timeline.ts` `end` and the lane fallback — use the base `bench.end` (WP-D).
- `warnings.ts` `salt-range`, `below-min` — plan salt only; preset name only (WP-C).
- `ItemsCard.tsx` row keys — `p.id` (WP-F).
- `DivisionCard.tsx` "used of usable" — piece grams against mix totals (WP-F).
- `TimelineCard.tsx` `FeedHelper` — `undefined` in items mode; needs the total starter
  (WP-G, wired by WP-H).

**What the fixtures avoid.** The reference bake is a household of tidy numbers: 250 g
starter, round percentages, no bench loss, one of everything. The awkward fixture WP-C and
WP-D must build and keep: starter mode with 1 % bench loss and a stand mixer; `foldCount: 0`
with a `fold1` split; `soft-bun` edited to milk 55 % so the water goes negative; a saved
plan referencing a deleted dough; a weight override on a variant line; `loaf` three times
(lean, jalapeño-cheddar, seeded) with the add-ins tick box off; items mode with
`starterAvailable` 100 g short; a separate dough carrying inclusions and a tangzhong; a
tangzhong whose liquid the milk line does cover; a `bulk@soft-bun` override with feed and
autolyse on. The live defect will be in the shape none of these cover — a real person on a
real screen finds it, so WP-H's local run with Ben is part of the gate, not a courtesy.

---

## 11. Decisions Ben took (settled 2026-10-11)

Each was a product or data call. Ben answered on 2026-10-11 and §2 already reflects every
answer; this list is the record. An agent that finds §2 and this list disagreeing reports it
rather than picking one.

1. **Egg and milk doughs are mixed separately, never split** (decision 3). Yes.
2. **Piece weight and add-ins** (decision 6). Not a fixed rule: a tick box on the plan,
   "Planned weights include add-ins", on by default. Sometimes a 600 g loaf is 600 g
   finished; sometimes it is 600 g of dough with the mix-ins on top.
3. **The `roll` preset becomes a 100 g lean bread roll** with three enriched bun presets
   added and unedited stored presets refreshed in place (decision 14). Yes.
4. **Export bundle version 2** (decision 16). Yes.
5. **Doughs live on the Presets page** (decision 17). Yes.
6. **Tangzhong is in** (decision 20). Yes, on condition that the instructions reflect it:
   the ingredients block, the make-it-first step with grams and method, the mix note and the
   editor hint are now part of the decision, not a courtesy.
7. **The bulk heuristic** (decision 10) stays a labelled, editable guide. Yes.
8. **No sugar by default; sugar / sweetener / none per dough** (decision 23). Yes, and
   allulose is removed from the list because it is not authorised in the EU or UK.

---

## 12. Verification gate

There is no ORCHESTRATION.md; this section is the gate until one exists.

- Every package: `npm run format && npm run lint && npm run typecheck && npm test && npm run build`
  green, and the symbol report (decision 22) in the hand-back.
- Packages that touch anything printed (WP-F, WP-G, WP-H): the headless Chrome print check —
  build, serve `dist/` on a non-default port, run
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --print-to-pdf=<out> --no-pdf-header-footer --virtual-time-budget=3000 <url>`,
  kill Chrome once the PDF exists (it does not exit by itself; macOS has no `timeout`), dump
  text per page with pypdf in a scratchpad venv, rasterise with `sips`, and confirm no
  `.step`, `.track`, `.lane` or `.piece` is split. Ben's browser is Firefox: print CSS must not
  rely on grid or flex fragmentation.
- Nothing is pushed until Ben has looked at it locally. WP-H leaves `npm run dev` running on
  :5173 with examples A, A2, B and B3 saved as plans.
- Commit messages follow the repo's `type(scope): summary` style; one commit per package.

Commit this plan to the repo root before wave 1 starts.

---

## 13. Follow-ups outside this plan

Raised during execution, deliberately not folded in:

1. **Saved plans snapshot their doughs.** A saved plan references doughs by id, so editing a
   dough later rewrites what an old saved plan says was baked (WP-B). Recommended as its own
   plan: snapshot the doughs a plan uses at save time.
2. **`AdditionLine` carries structure, not labels.** The timeline pairs a soaker with its seed
   and picks the tangzhong liquid word from calc's label text (WP-D). A `liquid` and a
   `pairedWith` field on `AdditionLine` would remove that coupling; it touches `types.ts`,
   `calc.ts` and `timeline.ts` together.
3. **One-time upgrade notice** when an unedited roll is refreshed to 100 g (WP-B). Declined
   for now: decision 14's intent, and Ben edits his own presets.
4. **Suggestions are main-dough grams.** "Short by X g", "X g spare" and "drop one Roll (Soft
   bun dough) to free 115 g" count base dough; a 120 g enriched roll frees 115 g of it. Say so
   in `suggest()` (WP-C).
5. **`isPresetList` is shallow** (since `187a90a`): a stored preset without a name would crash
   the warnings. Deepen it the way `isDoughList` was (WP-C).
6. **One reason sentence.** `reasonFor` in `calc.ts`, `split-needs-mix` in `warnings.ts` and
   the editor's "Will be:" line each word the separate-vs-split reason; one helper in
   `doughs.ts` would serve all three, and `LABEL_CHECK` belongs next to `NO_SUGAR` (WP-E).
7. **A preset's note can contradict a dough's bake.** The shape step carries the preset's
   note, so a lean roll on `soft-bun` says "Steam 8 min" while its lane bakes at 190 °C without
   steam (WP-G). Either a dough-aware note or a hint in the editor.
8. **Track order is library order**, so with three or more doughs a split block can list after
   a mix that starts later; listing splits straight after the main dough is one option (WP-G).
9. **Why the factor.** The guide says "×1.15 for this dough, a heuristic"; a `bulkFactorWhy(d)`
   could say sugar, fat or "as set" (WP-G).
10. **Firefox print is untested by tooling** (no headless print-to-PDF); the print CSS uses
    block flow and atomic blocks only, which Firefox fragments correctly, and Ben's own print
    is the real check.
