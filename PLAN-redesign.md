# PLAN-redesign — the plan page follows the baker, not the model

Base: `d9f059a` on `main` (one docs commit above the deployed `cf6d513`). Evidence:
`docs/style-review.md` (206 screenshots behind it). Conventions, gate and the failures this
project keeps having: `ORCHESTRATION.md`. Decisions continue from `PLAN-doughs.md` (1–23) at 24.
`file:line` references below are **hints to verify**: grep for the symbol, confirm it says what the
plan claims, and report drift rather than working around it.

## 1. The defect

Every surface was built for one dough and repeated once per dough. Observed on the running app
(items mode, REF-like settings), from the review's screenshots:

| surface                             | what it does                                                                          | observed                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `TimelineCard.tsx:259-369`          | one boxed block per dough, each restarting the clock                                  | busy plan: the 13:15–13:35 soft-sandwich mix overlaps the 13:25 jalapeño split, shown nowhere; four blocks read in turn  |
| `IngredientsCard.tsx:228-304`       | the same `h3` + table for a mix and for a split taken out of it                       | "Main dough" and "Jalapeño cheddar" look like two doughs; the split sits 14 px under the mix it comes from               |
| `IngredientsCard.tsx` `muted small` | one style, six roles (figures, add-at, add-in notes, fate line, dough notes, starter) | "Keep the cheese inside…" and "Have 161 g of active starter…" read as one paragraph                                      |
| `IngredientsCard.tsx:155`           | "keep ~20 g back for the salt" when water ≥ 20 g                                      | a 120 g roll: 33 g of water, keep 20 back; shown on enriched mixes whose routine adds the salt with the flour            |
| `IngredientsCard.tsx:235,239`       | a whole-dough split keeps the "portion" reason and a weigh row                        | "All of it becomes Jalapeño cheddar at fold 1." then "…a portion of the main dough." then "Main dough, all of it 1212 g" |
| `DivisionCard.tsx:76-85,150,172`    | per-piece sum, group total, card total                                                | one roll: "1 × 120 g", "= 120 g", "120 g total"; "1437 g of 1437 g" twice; the card stretched to 985 px by `.grid.two`   |
| `styles.css:518` step rows          | `62px 1fr auto` with a 74 px duration box                                             | at 390 px a note column of ~120 px: the soft bun mix note takes fifteen lines                                            |
| `KitchenMode.tsx:93,103,122`        | tracks and lanes as `h2`, reasons at body size                                        | the reason outshouts the steps; tables run edge to edge at 1200 px                                                       |
| `ItemsCard.tsx:163`                 | accent badge "SPLIT: JALAPEÑO CHEDDAR" above a select saying the same                 | 4.1:1 in light mode; wraps to two lines at 390 px while the select truncates                                             |
| `DoughsCard.tsx:289-332,341`        | every section open, every hint shown                                                  | one open dough is 2,100 px at 1200 and 4,150 px at 390; a split gets the enriched no-sugar hint                          |
| `styles.css`                        | fourteen colour tokens, one radius, no type or spacing scale                          | twenty font sizes, fourteen spacings, thirty inline `style` props across the components                                  |
| `styles.css:830` print              | the active scheme's tokens print                                                      | dark scheme: `--muted` and `--warn-ink` pale on white; a third of page 1 empty under the "keep whole" rule               |

**The reframing:** a card is a set of sections, not a table, and the timeline follows the clock,
not the model. The planner already computes the right things (`computePlan`, `buildTimeline`);
this plan changes how they are read, and touches the lib only to fix sentences.

---

## 2. Decisions — do not relitigate

Carried forward from `PLAN-doughs.md`: 15 (the §5.5 reference bake is frozen on `REF_PRESETS`),
19 (no new dependencies; React components are typechecked and looked at, not unit-tested — amended
by 27 below), 22 (deletion belongs to the package that supersedes; report per symbol), 23 (no sugar
by default). New:

24. **Two timeline views, "In order" and "By dough".** In order is the default whenever the
    timeline has more than one track or no base track (`placeTracks(timeline).blocks.length > 0`,
    `TimelineCard.tsx:41`); By dough is one tap away and is today's block view. A lean plan (one
    base track) shows no toggle and renders as today: one list, ids `mix`, `bulk`, `divide`,
    `bench`, folds beside the bulk. Settled with Ben 2026-10-11.
25. **Kitchen mode is In order only**, with the lanes' shape, proof and bake rows merged into the
    list and tagged by item (`lane.label`). Nothing is edited there, so the order of jobs is the
    whole point. Settled with Ben.
26. **Dough colours.** The main dough is neutral. Each other dough takes `--dough-1` … `--dough-5`
    by its position among `result.doughs` with `method !== "base"` (library order, the order calc
    and the timeline both use; `tracks[i].doughId` maps the same way), wrapping after five. Colour
    is never the only carrier: icon and name travel with it. Settled with Ben. Amended in wave 2:
    the Doughs editor shows no colour, because it has no plan to colour by and a library-position
    colour disagreed with the plan's ("violet there, blue here"); a stable per-dough colour across
    plans needs `DoughResult.libraryIndex` from the lib and is a follow-up (§12). The main dough
    carries no dot on any card.
27. **Presentation helpers are pure and tested.** `src/components/*.ts` (no JSX) such as
    `timelineRows.ts` get a vitest file next to them (`vitest.config.ts` already includes
    `src/**/*.test.ts`). Components stay untested and looked at.
28. **Tokens, no inline styles.** `styles.css` gains the type, number, spacing, radius and dough
    colour tokens of §5. Every package deletes the inline `style` props in the files it owns and
    reports any it keeps with the reason. `.nowrap` and friends stay.
29. **Per-card CSS.** `styles.css` holds tokens and shared primitives only. Each card owns its own
    file (`ingredients.css`, `division.css`, `items.css`, `timeline.css`, `doughs.css`,
    `kitchen.css` under `src/components/`), imported at the top of its component, print block
    included. After wave 1 nobody edits `styles.css` except R7. A wave-2 package that supersedes a
    `styles.css` rule (`.mix-block`, `.track`, `.piece-group`, …) cannot delete it (decision 22
    meets decision 29): it lists the rule in its hand-back and R7 deletes it in wave 3. Card
    stylesheets load before `styles.css` (`main.tsx` imports it last), so a card rule wins a tie
    only by specificity: scope every card rule under the card's root class, and leave the order
    alone, since it lets `styles.css`'s print protections win ties against card screen rules.
30. **Three levels and four roles.** A card is sections; a section opens with a heading row on a
    top rule with its figures on that row; a split is a sub-section indented behind a rule in its
    dough colour; notes are one of two roles: the planner's explanations (muted, `--fs-sm`) and the
    baker's own words (dough, add-in and plan notes: ink, `--fs-sm`, behind a left rule);
    card-level lines (starter, the scale toggle, plan warnings) sit in a footer under a rule.
31. **The lib is frozen except R8**, which changes sentences, `fmtPct`, and adds
    `DoughResult.splitAt`; it moves no number, no id, no key. Every other package reads the lib and
    reports what it would want changed.
32. **The lean plan does not move** in anything a saved plan depends on: numbers, step ids, lane
    keys, `timelineOverrides`, export. Its look may change with the tokens (that is the point);
    pixel identity is not a requirement this time. Print stays block flow with every step, row,
    lane, track, piece, section and callout atomic, and no grid or flex fragmentation (Firefox).
33. **The view preference persists per browser** under `sourdough.v1.timelineView` (`"order"` or
    `"dough"`), read with storage's exported `load` and written with `usePersisted`; it is not in
    the export bundle and `UiPrefs` is untouched.
34. **Warnings stay in their own card.** Moving a dough's warnings into its section is a follow-up
    (it needs `PlanWarning.doughId`, a lib change beyond R8's remit).
35. **Percentages read "65 %"**: `fmtPct` drops a trailing `.0` and puts a thin space before the
    sign; the number itself does not change. Tests that assert "75.0%" are updated by R8.
36. **Wave-2 calls, kept.** The Ingredients card has no "Total dough" row: the total sits once on
    the section's heading row and the check row spans both columns; the library's stock add-in
    notes are the planner's words (`.note-planner`), only what the baker typed is `.note-own`; the
    starter line reads "ready by the first mix: 151 g for the main dough and 116 g for Soft bun
    dough" and shows only in items mode. The Doughs editor opens on Basics with every other part
    closed and summarised in one line (the literal "closed unless it holds values" rule missed the
    size budget by a third). A merged In order row is fixed if any part is, keeps a shared
    `defaultMinutes` only when the parts agree, and shows differing notes one per line led by the
    dough or lane name; its length box edits every step on it, and a one-sided override un-merges
    the row and shows the clash. The feed row has no dough tag; `mix` and `autolyse` are the main
    dough's.

---

## 3. The In order model (R4 implements, R1 pins, R5 consumes)

`src/components/timelineRows.ts`:

```ts
export interface TimelineRow {
  /** A step row keeps its step id (so lengths stay editable and overrides apply); a fold row is
   *  `fold:<n>@<doughId>`; a merged row joins its ids with "+" in track order. */
  id: string;
  kind: "step" | "fold";
  start: Date;
  end: Date;
  minutes: number;
  /** From the step; a fixed step has no length of its own (decision 24 keeps the lib's flag). */
  fixed?: boolean;
  defaultMinutes?: number;
  label: string; // the step's label; "Fold 2" for folds, numbered from that dough's bulk start
  note?: string;
  /** Every dough on the row, track order; colour 0 is the main dough (decision 26). */
  doughs: { doughId: string; name: string; icon?: string; colour: number }[];
  /** Ids of other hands-on spans that intersect this row's span, and only on hands-on rows:
   *  mix, split, divide, shape and the tangzhong cook. Bulks (fixed or not), feeds, autolyse,
   *  proofs, bench rests and bakes are not hands-on, and folds are moments, so none of those
   *  carry or cause an overlap. Empty for most rows. */
  overlaps: string[];
  /** Doughs whose bulk is running at this row's start, for the gutter rails. */
  rails: string[];
}
export interface TimelineRows {
  /** false for a lean plan: one base track and nothing else (decision 24). */
  multi: boolean;
  rows: TimelineRow[];
  /** When `lanes` was asked for: shape/proof/bake rows merged in; a lane row's tag carries
   *  `name: lane.label` ("Loaf (Jalapeño cheddar)"), `doughId: lane.doughId` and that dough's
   *  colour, so two lanes shaping at the same minute merge into one row with two tags. */
}
export function timelineRows(timeline: Timeline, opts?: { lanes?: boolean }): TimelineRows;
```

Rules: rows come from `timeline.steps`, every `tracks[i].steps`, every `tracks[i].folds`, and
(with `lanes`) every `lanes[j].steps`. Sort by `start`; ties keep today's order: prefix, base
track, then tracks in `tracks` order, then lanes in `lanes` order; a fold sorts after a step that
starts at the same minute. Merge rows with the same `label` and the same `start` and `end` (folds
at the same minute; the busy plan's 17:55 divides and 18:10 bench rests): one row, every dough.
Fold numbers count from that dough's own bulk start for base and separate tracks and from the
base bulk start for a split (as `BulkDetails` does, `TimelineCard.tsx:180-201`). Bulk rows carry
"to HH:MM" in the card, not a length. `overlaps` marks hands-on collisions only, so a mix during
another dough's bulk is not one, but a mix during a split is.

**Worked rows, Ben's case** (items mode; `loaf` ×2 at 600 on `jalapeno-cheddar`, tick box off;
REF settings; start 09:00; hand mixed, 24 °C): `mix` 09:00–09:10 [main] · `bulk` 09:10–09:50
"Bulk ferment (until the split)" [main], fixed · `split@jalapeno-cheddar` 09:40–09:50 "Work in
the add-ins" [jalapeño] · `bulk@jalapeno-cheddar` 09:50–14:10 [jalapeño] · `fold:2@jalapeno-cheddar`
10:10 · `fold:3@…` 10:40 · `fold:4@…` 11:10 · `divide@jalapeno-cheddar` 14:10–14:25 ·
`bench@jalapeno-cheddar` 14:25–14:50; `multi` true; no row has `overlaps`; the base bulk and
the split overlap in time but the bulk is not hands-on. With lanes: `shape:loaf@jalapeno-cheddar`
14:50–15:00, `proof:…` 15:00–16:30, `bake:…` 16:30–17:15, each tagged "Loaf (Jalapeño cheddar)".

**Worked rows, the busy plan** (items mode; `loaf` ×1 lean at 600, `loaf` ×1 at 600 on
`jalapeno-cheddar`, `roll` ×6 at 120 on `soft-bun`, `loaf` ×1 at 800 on `soft-sandwich`; REF
settings; start 06:00; `feedStarter` and `autolyse` on; hand mixed): `feed` 06:00–12:00 ·
`autolyse` 12:00–12:45 · `mix` 12:45–12:55 [main] · `bulk` 12:55–17:55 [main] · `mix@soft-bun`
12:55–13:15 · `bulk@soft-bun` 13:15–18:15 · `mix@soft-sandwich` 13:15–13:35 · `split@jalapeno-cheddar` 13:25–13:35 · `fold:1@lean` 13:25
(a fold sorts after a step starting at the same minute) · `bulk@soft-sandwich` 13:35–18:35 ·
`bulk@jalapeno-cheddar` 13:35–17:55 (track order: separate doughs precede the split in `tracks`) · `fold:1@soft-bun` 13:45 · `fold:2@lean+fold:2@jalapeno-cheddar` 13:55 (one row, two
doughs) · … · `divide+divide@jalapeno-cheddar` 17:55 (one row, two doughs) · `bench+bench@…` 18:10 ·
`divide@soft-bun` 18:15 · `bench@soft-bun` 18:30 · `divide@soft-sandwich` 18:35 · `bench@…` 18:50.
`mix@soft-sandwich` and `split@jalapeno-cheddar` list each other in `overlaps`. The pin computes
every time from `buildTimeline` on that fixture and asserts ids, order, merges, tags and overlaps;
the times above are what it must find (verify with a node script, do not hand-type them).

---

## 4. The timeline card, both views (R4)

- **Toggle** "In order | By dough" using the existing `.toggle` (`styles.css:296-315`;
  `SettingsCard.tsx:19` shows the markup), shown only when `multi`. Default per decision 24;
  choice persisted per decision 33.
- **In order** (`timeline.css`): one list of `TimelineRow`s. A row is time · step (note under it
  as now) · length (editable `DurationInput` for step rows that are not fixed, same step ids) ·
  dough tag(s): icon, name, a dot in the dough colour; on a phone the name only when the dough
  changes from the row above. A narrow gutter carries a rail per dough while its bulk runs
  (`rails`), in that dough's colour. Rows with `overlaps` get a bracket and the planner note
  "hands busy: also <label> at HH:MM". The bake lanes stay under the list as today.
- **By dough**: today's blocks (`placeTracks`) with: no reason line on the main dough
  (`calc.ts:795`'s sentence is dropped by R8 anyway), blocks ordered main, splits, separate
  (the `DivisionCard.tsx:44` rank), the autolyse box only when there is a main mix
  (`TimelineCard.tsx:289-297`), and the bulk guide hung off each track as now.
- **Step rows** on a phone: the note column gets `min-width: 0` and the duration box shrinks to
  its digits (R1's shared `.step` change); lanes use `auto-fit, minmax(min(280px, 100%), 1fr)` (R1).
- **Kitchen mode** (R5) renders `timelineRows(timeline, { lanes: true })` only, read-only, with
  the same tags and rails, `h3` headings, reasons at note size, and `max-width` from R1.

---

## 5. The design system (R1 ships; every package uses)

`styles.css` `:root` gains, for both schemes:

| token                                   | value                                 | used for                                                          |
| --------------------------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| `--fs-xs` `--fs-sm` `--fs-md` `--fs-lg` | 0.78rem · 0.88rem · 1rem · 1.15rem    | badges, pills, hints · notes and sub lines · body · section heads |
| `--num-sm` `--num-md` `--num-lg`        | 1.15rem · 1.5rem · 2.2rem             | not weighed (a portion, a split total) · weighed · piece counts   |
| `--sp-1` … `--sp-6`                     | 4 · 8 · 12 · 16 · 24 · 32 px          | all margins and gaps                                              |
| `--radius-sm` `--radius-md`             | 8 px · 14 px (`--radius` keeps 14)    | rows · cards                                                      |
| `--dough-0` … `--dough-5`               | neutral + five hues, tuned per scheme | decision 26; `--dough-0` equals `--muted`                         |

Kitchen mode and print scale the type by one factor each (`.kitchen { --scale: 1.3 }`, print
`--scale: 0.9`) rather than re-declaring sizes. Shared primitives R1 adds to `styles.css`:
`.section` (top rule, `--sp-4` above), `.section > .head` (heading row: icon, name, badge; figures
right-aligned on the row), `.subsection` (indent `--sp-4`, left rule 3 px in `var(--dough)`),
`.note-planner` (muted `--fs-sm`), `.note-own` (ink `--fs-sm`, left rule 2 px `--line`, padding
`--sp-2`), `.card-footer` (top rule, `--sp-3` above, `.note-planner` inside), `.dough-tag` (dot
`0.6em` in `var(--dough)` + icon + name, `--fs-sm`), `.dough-rail` (3 px vertical in `var(--dough)`).
`var(--dough)` is set inline-free: a class `dough-1` … `dough-5` sets `--dough` on the element.
The five small sizes collapse onto `--fs-xs`/`--fs-sm`; `.small` becomes `--fs-sm`.

Also in R1, the quick wins the review lists for `styles.css`: `.grid.two { align-items: start }`
(:168-177), lanes `auto-fit, minmax(min(280px, 100%), 1fr)` (:598; three lanes still fit a 914 px card), `.kitchen`
max width 820 px (:735),
`.step` note column `min-width: 0` and a 3.2em duration box (:518-559), the light palette
re-declared inside `@media print` (:830) so a dark screen prints dark ink.

---

## 6. Work packages

Rule for every package (decision 22): what you supersede you delete in the same commit and report
per symbol; inline styles in your files go (decision 28) and any kept are listed with why.

### R1 · Tokens, primitives, per-card files, and the red pins

**Goal:** the design system exists, every card has its own stylesheet wired in, and the In order
contract is pinned by failing tests, with nothing visible changed beyond the five quick wins.

- `styles.css`: everything in §5. Collapse the five "small" sizes; do not restyle components.
- New empty files with a one-line comment: `src/components/ingredients.css`, `division.css`,
  `items.css`, `timeline.css`, `doughs.css`, `kitchen.css`; one `import "./x.css";` line at the
  top of `IngredientsCard.tsx`, `DivisionCard.tsx`, `ItemsCard.tsx`, `TimelineCard.tsx`,
  `DoughsCard.tsx`, `KitchenMode.tsx` (those six lines are the only component edits).
- `src/components/timelineRows.ts`: the §3 types verbatim and a stub `timelineRows` returning
  `{ multi: false, rows: [] }`. `src/components/timelineRows.test.ts`: pins P1 (Ben's case), P2
  (the busy plan), P3 (the default lean plan: `multi` false; rows `mix`, `bulk`, `fold:1@lean` …
  `fold:4@lean`, `divide`, `bench` in that order, every `colour` 0, no overlaps) as `it.fails`,
  figures computed from `buildTimeline` on the §3 fixtures (REF presets and `DEFAULT_DOUGHS`, start
  times fixed) and written into each pin's comment; run them once as plain `it` to see each fail on
  content, not on an import.
- Screenshots before and after of the lean plan, example B and the busy plan at 1200 and 390 px
  (the review's drivers: `scratchpad/sr-work/cdp.mjs`, `states.mjs`, `shoot.mjs`): only the five
  quick wins move.

**Acceptance:** gate green with exactly three `it.fails`; `grep -c "style={" src/components/*.tsx`
unchanged (R1 restyles nothing); the lean plan's markup is byte-identical (react-dom/server diff)
and its screenshot differs only by the `.grid.two` alignment and the step-row widths; dark-scheme
print of the lean plan shows ink-dark muted text.

Owns: `src/styles.css`, the six new `.css` files, the six import lines, `src/components/timelineRows.ts`,
`src/components/timelineRows.test.ts`. Size **M**. Depends: none. Runs with R8 only (disjoint).

### R8 · Lib sentences and `splitAt` (wave 1, with R1)

**Goal:** the lib stops saying things the cards have to work around, without moving a number.

- `timeline.ts`: `plainMixNote` keeps "Reserve ~20 g water for the salt" only for a plain mix with
  `addedWater ≥ 200` (`:183-187`, verify; the card applies the same rule in R2); drop "the <name>
  track carries on from there" from the rest-until-split note (`:317`); the tangzhong note's "(it
  will while the starter feeds)" only when `plan.feedStarter` (`:501`); the shared prefix mix step
  is labelled "Mix (main dough)" / "Mix (main dough, stand mixer)" when the timeline has more than
  one track, else "Mix" / "Mix (stand mixer)" as today (pin H must keep passing).
- `calc.ts`: `reasonFor(d, "base")` returns `""` (`:795`); `DoughResult` gains `splitAt?: SplitAt`
  (set for split doughs from `splitAtFor`) so no card parses the reason text; `lineLabel` stays.
- `format.ts`: `fmtPct` per decision 35; `fmtDuration` unchanged.
- `types.ts`: the `splitAt` field only.
- Tests updated where they assert the old strings; a test for each new sentence rule and for
  `splitAt`; `REF_PRESETS` figures untouched.

**Acceptance:** gate green; `npm test` count rises only by the new tests; `git diff --stat` touches
no component; the all-lean timeline pin (H) and worked timelines A, B, B3 still pass to the minute;
the only visible change on a lean plan is "75 %" for "75.0%" and the water note rule.

Owns: `src/lib/timeline.ts`, `timeline.test.ts`, `src/lib/calc.ts`, `calc.test.ts`, `src/lib/format.ts`,
`format.test.ts`, `src/lib/types.ts`. Size **S**. Depends: none. Runs with R1 only.

### R2 · Ingredients card

**Goal:** one card that reads as sections: each mix a section, each split a sub-section of its
mix, one style per role, the starter line first and the baker's notes unmistakably theirs.

- `IngredientsCard.tsx` + `ingredients.css`: card header (totals, "65 %"); a `.section` per mix
  with a `.head` (icon, name, "separate mix" badge where it applies, total dough and, when it
  differs, usable on the row); the table at `--num-md`; a `.subsection` per split in its dough
  colour: heading row "Jalapeño cheddar · split off at fold 1" (from `DoughResult.splitAt`, R8),
  the portion as a `.note-planner` line ("Take 506 g of the main dough" or "All of the main dough"),
  the add-ins at `--num-md`, the split's total at `--num-sm` labelled "with add-ins"; no "Main
  dough, all of it" row and no "…a portion of the main dough" sentence for a whole-dough split; the
  fate line under the main dough only when lean has pieces or spare exists ("of which 506 g goes to
  Jalapeño cheddar at fold 1 · 486 g spare"); add-in notes and dough notes as `.note-own`; the
  check row across both columns when there is no usable figure; the starter line at the top of the
  card as `.note-planner`, split per mix when there are several ("140 g for the main dough, 88 g
  for Soft bun dough"); the reserve-water note only on a plain mix with ≥ 200 g of water; the scale
  toggle in the `.card-footer`.
- Delete the inline styles and the `muted small` roles it replaces (report each).

**Acceptance:** Ben's case shows one section whose sub-section is the jalapeño dough with no
repeated total; example B shows two sections and the starter line split per mix; B3's tangzhong
block sits inside the sandwich section above its table; the lean plan shows one section with the
same figures as today; `grep -c "muted small" IngredientsCard.tsx` is 0; print of the busy plan
(scratch build) keeps every section and sub-section whole.

Owns: `src/components/IngredientsCard.tsx`, `src/components/ingredients.css`. Size **M**.
Depends: R1, R8.

### R3 · Division and Items

**Goal:** the division says each figure once and the items row says the dough once.

- `DivisionCard.tsx` + `division.css`: "N g of M g" only when N and M differ (`:150`, `:172`); no
  "= N g" line; "N g total" only for a count above one (`:76-85`); a one-piece group full width;
  group headings as `.section > .head` with the dough tag and colour; the add-ins convention line
  in the card header as today.
- `ItemsCard.tsx` + `items.css`: a neutral badge "split" or "separate mix" without the dough's
  name (`:159-166`); the `.dough-tag` dot beside the select; "flex N" only in starter mode
  (`:174`); the row grid gets `min-width: 0` from `items.css`, not inline.

**Acceptance:** one roll reads "1 × 120 g" and nothing else about 120 g; Ben's case reads "2 × 719 g
· 1437 g total" once; the lean plan's division is unchanged in figures; at 390 px nothing
truncates or wraps mid-number; the badge passes 4.5:1 in both schemes.

Owns: `src/components/DivisionCard.tsx`, `ItemsCard.tsx`, `division.css`, `items.css`. Size **S**.
Depends: R1.

### R4 · Timeline, both views

**Goal:** the card shows the day in order by default and each dough's routine on request, and the
three pins flip.

- `timelineRows.ts`: implement §3 (replace the stub; keep the types). `timelineRows.test.ts`: flip
  P1–P3 to plain `it`; add: a stand-mixer plan (one fold set), a plan with no base mix (B3), a split
  with `bulkFactor` 1.2 (its divide after the base's), and three doughs where two merges happen on
  one row.
- `TimelineCard.tsx` + `timeline.css`: §4. The toggle; the In order list with tags, rails, merged
  rows, overlap brackets, editable lengths by step id; By dough as today with the §4 trims. Delete
  what the In order view supersedes in the old render path only if nothing uses it (report per
  symbol); `placeTracks`, `trackTitle`, `trackBadge`, `isBulkStep` stay exported for R5 unless R5
  no longer needs them (R5 says so in its hand-back; R4 does not guess).
- The lean plan: no toggle, markup identical to today except class names R1 introduced.

**Acceptance:** `grep -c "it.fails" src/components/*.test.ts` is 0; Ben's case renders the §3 rows
in order with the jalapeño rows tagged and the base bulk fixed; the busy plan shows the 13:15/13:25
bracket; editing the sandwich mix length in the In order view moves only that dough (same
`timelineOverrides` key as before); the choice survives a reload; the lean plan shows no toggle and
its saved overrides still apply; at 390 px a row's note is at least 60 % of the card width.

Owns: `src/components/TimelineCard.tsx`, `src/components/timelineRows.ts`,
`src/components/timelineRows.test.ts`, `src/components/timeline.css`. Size **M**. Depends: R1, R8.

### R6 · Doughs editor

**Goal:** a dough's form fits on a screen, says what matters first, and hints only what applies.

- `DoughsCard.tsx` + `doughs.css`: `Section` (`:341`) becomes collapsible with a one-line summary
  when closed (e.g. "Enrichments: milk 35 %, egg 12 %, butter 12 %"); Basics open by default, the
  rest closed unless they hold values; "Will be: …" as a `.callout.info` directly under the method
  control; the no-sugar hint (`:820`) and the enriched hints only for a separate dough, the split
  hints (butter after the mix, add-ins at the split) only for a split; fields wide enough for their
  longest option ("After the mix (dough built)"); the list header on a phone: name and icon on one
  row, the three buttons on the next; the notes box `.notes-input`.
- `PresetsPage.tsx`: the same header treatment (`:80-128`); the collapsed preset summary keeps the
  dough.
- Delete `Section`'s always-open rendering and the inline styles (report each).

**Acceptance:** Soft bun dough open is under 1,100 px tall at 1200 and under 2,000 px at 390 with
Basics open; the jalapeño dough shows no enriched hint; every field still round-trips (WP-E's
scripted checks, re-run); `npm run typecheck` clean.

Owns: `src/components/DoughsCard.tsx`, `src/components/PresetsPage.tsx`,
`src/components/doughs.css`. Size **M**. Depends: R1.

### R5 · Kitchen mode

**Goal:** kitchen mode is the day's job list.

- `KitchenMode.tsx` + `kitchen.css`: render `timelineRows(timeline, { lanes: true })` as one
  read-only list with tags and rails; `h3` for sections, reasons at `--fs-sm`; `max-width` from R1;
  the ingredients and pieces as now (they come from R2 and R3's components unchanged in name and
  props); `plan.notes` as `.note-own` under the title. Delete the track and lane renders it
  replaces and report which `TimelineCard` exports (`trackTitle`, `trackBadge`, `placeTracks`,
  `isBulkStep`) it no longer imports so R4's agent, or a follow-up, can delete them.

**Acceptance:** the busy plan's kitchen view is one list from 06:00 to the last bake with the
sandwich divide at 18:35 shown beside the loaves' shape at 18:35; the lean plan's kitchen list has
the same steps and times as today; nothing overflows at 390 px.

Owns: `src/components/KitchenMode.tsx`, `src/components/kitchen.css`. Size **S**. Depends: R4, R2, R3.

### R7 · Print, both browsers, and a screenshot harness in the repo

**Goal:** everything prints whole in Chrome and Firefox, and the next person can see state
without rebuilding the review's scripts.

- `scripts/screens/`: the review's drivers (`scratchpad/sr-work/cdp.mjs`, `states.mjs`,
  `shoot.mjs`) brought into the repo as plain Node (no dependencies; Node's global `WebSocket`):
  `node scripts/screens/shoot.mjs --state busy --width 390 --scheme light --out <dir>` and
  `node scripts/screens/print.mjs --state busy --out <pdf>`; the six states of the review as
  fixtures; a README line per flag. Add the Firefox print route WP-G used (WebDriver BiDi) if it
  fits in plain Node; else document the manual step.
- Print blocks: review every `@media print` block the wave-2 packages wrote (the five card files)
  and `styles.css`'s; make each new class atomic where it should be; fix the dark-scheme palette if
  R1's pin did not hold; keep sections together when they fit and let a tall section break between
  its atomic children.
- Print the lean plan, Ben's case, example B, B3 and the busy plan in Chrome and in Firefox; run the
  text-per-page checker; rasterise and look at every page.
- `ORCHESTRATION.md`: the harness commands replace the "worktree trick" paragraph where they can.

**Acceptance:** ten PDFs with nothing split; the lean print keeps its page count; the busy plan's
page 1 is more than two-thirds used; `scripts/screens/` runs from a clean checkout with
`npm ci` only.

Owns: `scripts/screens/` (new), the `@media print` blocks of `ingredients.css`, `division.css`,
`items.css`, `timeline.css`, `doughs.css`, and `src/styles.css` whole (its print block, and the
deletion of the screen rules wave 2 reported as superseded; badges print as ink with an outline;
decide the print scale for badges), `ORCHESTRATION.md`. Size **S**.
Depends: R2, R3, R4, R6. Runs with R5 only (R5 owns `kitchen.css` whole; R7 does not touch it).

---

## 7. The red pin

R1 writes P1, P2 and P3 in `src/components/timelineRows.test.ts` as `it.fails` against the stub
and sees them fail on content; R4 flips them as part of its acceptance. The plan is complete when:

```
grep -c "it.fails" src/components/*.test.ts src/lib/*.test.ts   → 0 in every file
npm run format && npm run lint && npm run typecheck && npm test && npm run build   → green
```

and R7's ten PDFs show nothing split, with the screenshots of the six states at both widths and
both schemes attached to R7's hand-back.

---

## 8. Wave table

| Wave | Packages          | Notes                                                                                                                                              |
| ---- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | R1 + R8           | disjoint: `styles.css`, the six new css files, six import lines and `timelineRows.*` vs the lib and its tests. R1 owns the stylesheet choke point. |
| 2    | R2 + R3 + R4 + R6 | disjoint by card: each owns its component(s) and its own css file; none touches `styles.css`, the lib, `App.tsx` or `KitchenMode.tsx`              |
| 3    | R5 + R7           | disjoint: `KitchenMode.tsx` + `kitchen.css` vs `scripts/screens/`, the five card print blocks, `styles.css`'s print block and `ORCHESTRATION.md`   |

Checked against the `Owns` lists: no file appears twice in a wave. Standing rules:

- `src/styles.css` is a choke point: R1 in wave 1, R7's print block in wave 3, nobody else. A
  wave-2 package that needs a shared primitive writes it in its own css file and reports it for
  R7 to lift.
- `src/App.tsx` is not owned by anyone: the toggle lives in `TimelineCard`, kitchen mode's props
  are unchanged, and `IngredientsTable`/`Pieces` keep their names and props (R5 depends on it).
- The lib is R8's in wave 1 and frozen after; a wave-2 package that wants a lib change reports it
  with file:line for a follow-up and works with what the result carries.
- Each package screenshots its own card at 1200 and 390 px in both schemes before its final gate
  (the review's drivers until R7 lands the harness) and prints the busy plan from a scratch build.

Rough total: three waves, eight packages.

---

## 9. Regression to fear

**What must not move:** every number, step id, lane key and saved override of every plan; the lean
plan's timeline as one list with no toggle; the export bundle; print in block flow with atomic
blocks and no grid or flex fragmentation (Firefox); the gate. Pin H and `REF_PRESETS` are the
tripwire for the lib; R1's byte-identical markup check and R4's "no toggle on a lean plan" are the
tripwires for the cards.

**Hunt for the assumption rather than assuming its absence.** The assumption is "one style fits
every line": `muted small` doing six jobs, `h3` meaning both a mix and a split, a badge in the
button colour, an inline `style` where a level was needed. Each package greps its files for
`muted small`, `style={` and `<h3` and reports each use as replaced or kept with the role it now
has. The one-dough assumption of the last plan is still worth a glance: the kitchen mode's `h2`
levels and the items badge came from it.

**What the fixtures avoid.** The review's six plans are tidy: whole grams, default settings, one
split, at most two separate doughs, no tangzhong beside a split, no user-written notes longer than
a line, no dough names longer than "Buttered (softer crumb)". The awkward shapes a package must
build and look at: six doughs and eight lines (the review's stress plan); a 40-character dough name
and a three-paragraph dough note; a plan with no base mix and a feed; the 390 px light-mode kitchen
view; a print where a section is taller than a page. The live defect will be in the one none of
these cover, found by Ben on a real bake: R7's two-browser print and the screenshots are part of
the gate, not a courtesy.

---

## 12. Follow-ups outside this plan

Raised in waves 1 and 2, deliberately not folded in:

1. A stable per-dough colour across plans: `DoughResult.libraryIndex` from calc, one tested
   helper replacing `doughColour` (`DivisionCard.tsx`), `doughColours` (`timelineRows.ts`) and the
   editor's deleted `libraryColour`.
2. `KEYS.timelineView` in `storage.ts` (the card hard-codes the key); `fmtPctRange` and the
   editor's two-decimal amounts on the "65 %" rule; `.callout`'s 0.93rem onto the type scale.
3. Export the lib's reserve-water and whole-base rules (`timeline.ts`) so the Ingredients card
   stops mirroring them; a flag on `AdditionLine.note` saying who wrote it.
4. `ItemsCard` computes `computePlan` a second time for its colours; pass `result` from `App.tsx`.
5. The starter line lives in `IngredientsCard`, so kitchen mode does not show it.
6. A merged split row's note repeats the dough's name (`splitStep`, `timeline.ts`); the butter
   hint "above 10 % it goes in after the gluten is built" shows on split doughs too (`doughs.ts`).
7. `fitToText` exists twice (`NotesCard.tsx`, `DoughsCard.tsx`); Firefox 157 has `field-sizing`.
8. The main dough's heading shows the whole bowl's usable figure although splits take part of it
   (the old meaning; worth Ben's eye); "2 × 719 g · 1437 g total" rounds the piece and the total
   separately (pre-existing).
9. Long dough names (over about 30 characters) truncate in a native select at 390 px.
10. A tall Ingredients section pushes a page: the stress plan's page 1 holds only the header. R7
    lets a section break before a split; a section with no split still moves whole.

---

## 10. Settled with Ben (2026-10-11, before this plan was written)

1. In order is the default when a plan has two or more doughs; By dough is a toggle away.
2. Kitchen mode shows In order only.
3. The main dough stays neutral; library doughs are coloured in library order.
4. The lib sentence fixes ride along as R8 rather than a later release.

---

## 11. Verification gate

`ORCHESTRATION.md` is the gate: format, lint, typecheck, test, build; the print check for anything
printed; screenshots for anything restyled. Commit messages `type(scope): summary`; one commit per
package. Nothing is pushed until Ben has looked at it locally. Commit this plan to the repo root
before wave 1 starts.
