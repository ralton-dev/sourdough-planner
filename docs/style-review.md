# Style and information-design review — the doughs release

Reviewed 2026-10-11 at `cf6d513`: a production build driven over the DevTools protocol, six seeded
plans at 1200 and 390 px in dark and light, kitchen mode, the Doughs editor and the busy plan's
print (screenshots by file name, last section). Ben's settings are taken as 65 % hydration, which
reproduces his bread-roll screenshot exactly (54 g flour, 33 g water, "Main dough, all of it
101 g"); examples B and B3 use the plan's REF settings.

## Verdict

The release computes the right things and says most of them well, and a lean plan looks as it
did. What does not scale is the layout: every card repeats the lean plan's one pattern (a heading,
a table of big numbers, a few muted small lines) once per dough with no level between, so the busy
plan's Ingredients card is 2,266 px of look-alike tables carrying six kinds of muted small text,
with the Division card stretched beside it. The Timeline follows the model rather than the day:
the busy plan has a job every ten to twenty minutes from 12:45 to 15:35 across four blocks read one
after another, and the sandwich mix running into the jalapeño split at 13:25 shows nowhere. Several
conditional sentences misfire, worst "keep ~20 g back for the salt" on 33 g of water and on every
enriched mix. None of it needs the maths: each fix is presentation over what `computePlan` and
`buildTimeline` already return, the interleaved timeline included. Do the quick wins now, then a
seven-package redesign built around an In order timeline (the default once a plan has two doughs)
and a two-level Ingredients card.

## Findings, by impact

**1. The timeline hides when the doughs need you — reads wrong.** `TimelineCard.tsx:319-332`,
`KitchenMode.tsx:89-116`; `busy-plan-1200-dark-timeline.png`, `ben-plan-1200-dark-timeline.png`.
The busy plan shows four boxed tracks, each restarting the clock (12:55, 12:55, 13:15, 13:25),
the split last, after both separate mixes; fifteen fold pills (twelve moments) sit in four places;
the sandwich mix (13:15–13:35, kneading to a windowpane) overlaps fold 1 and the jalapeño split at
13:25 unremarked. Ben's one-bowl plan becomes two blocks, the first holding one step and the lib
sentence "the Jalapeño cheddar track carries on from there" (`timeline.ts:317`).

**2. The Ingredients card has one level for everything — reads wrong.**
`IngredientsCard.tsx:228-304`, `styles.css:354-361`; `busy-plan-1200-dark-ingredients.png`,
`ben-plan-1200-dark-ingredients.png`. "Main dough" and "Jalapeño cheddar" are the same `h3` over
the same table, though the split comes out of the main dough; mixes sit 18 px apart, a split
14 px. `muted small` carries six roles: mix figures (:288), add-at (:116), add-in notes (:119),
the fate line (:296), dough notes (:221), the starter line (:355). So "Keep the cheese inside…"
and "Have 161 g of active starter…" read as one paragraph, while the reason, in ink (:235, :292),
outshouts the heading. This is Ben's "very grouped together".

**3. The whole-dough split contradicts itself and repeats — reads wrong.**
`IngredientsCard.tsx:100`, `:235`, `:239`; `TimelineCard.tsx:328`;
`ben-plan-1200-dark-ingredients.png`, `roll-plan-1200-light-ingredients.png`. "All of it becomes
Jalapeño cheddar at fold 1." is followed by "… worked into a portion of the main dough." and a
weigh line "Main dough, all of it 1212 g" repeating "Total dough 1212 g" just above. The timeline
puts the "portion" reason over a step saying "this is all of the main dough".

**4. "keep ~20 g back for the salt" misfires — reads wrong.** `IngredientsCard.tsx:152` (lib twin
`timeline.ts:183-187`); `roll-plan-1200-light-ingredients.png`, `b-plan-1200-light-ingredients.png`,
`b3-plan-1200-dark-ingredients.png`. The rule is "water ≥ 20 g": the roll holds back 20 of 33 g,
and B, B3 and the busy plan show it on enriched mixes (63, 55, 48, 165 g) whose routine adds the
salt with the flour. Proposed: only on a plain mix (no enrichment or sweetness line, follow-up 11)
with at least 200 g of water, so 20 g is at most a tenth; otherwise nothing. Lean (719 g) keeps it.

**5. Other conditional text — reads wrong unless marked.**

- "Have 325 g of active starter ready for the first mix (Main dough)." (`IngredientsCard.tsx:342`)
  sits under the last dough's notes and reads as theirs; it is the first thing needed, so it
  belongs at the top, split per mix (140 g main, 88 g soft bun, 97 g sandwich).
- "The main dough: the batch settings, nothing added." (`calc.ts:795`) heads the main track
  (`TimelineCard.tsx:328`) and says nothing; B3 offers "Autolyse (main dough)" with no main dough
  (`:296`); lib notes contradict the plan ("Steam 8 min" on a 190 °C bun, a feed that is not
  there; follow-ups 7, 12, 16).
- Plan warnings sit at the card's foot, far from the dough they name; in print the salty add-ins
  one lands alone on top of page 3 (cosmetic).

**6. Division: stretched, and one number three times — cramped.** `styles.css:168-177`,
`DivisionCard.tsx:67-85`, `:150`, `:172`; `ben-plan-1200-dark-division.png`,
`roll-plan-1200-light-division.png`. `.grid.two` stretches the card to the Ingredients height:
985 px around Ben's one piece, 2,266 px around the busy plan's four. "1437 g of 1437 g" heads the
card and the group (in items mode the figures match); one roll reads "1 × 120 g", "… = 120 g",
"120 g total", and at 479 px the sum wraps mid-way.

**7. Step rows and lanes — cramped.** `styles.css:518-559`, `:598-603`;
`ben-plan-390-dark-timeline.png`, `b-plan-390-light-timeline.png`, `b3-plan-1200-dark-timeline.png`.
A step is `62px 1fr auto` with a 74 px duration box, so on a phone a track's note column is about
120 px: "Work in 181 g mature cheddar…" takes six lines, the soft bun mix fifteen (lean plans too).
Lanes are `auto-fill, minmax(230px, 1fr)`: one lane gets a third of the card, three wrap the shape
note every two words.

**8. Kitchen mode inverts emphasis — reads wrong.** `KitchenMode.tsx:93`, `:103`, `:122`;
`styles.css:735-775`; `busy-kitchen-1200-light.png`, `ben-kitchen-390-dark.png`. Tracks and lanes
are `h2` like "Ingredients"; the track reason is a bare `p.muted` at the kitchen body size, 1.35rem,
above step labels (1.3rem) and notes (1rem). At 1200 px the tables run edge to edge.

**9. Items card: the dough said twice, loudly — cramped.** `ItemsCard.tsx:157-195`;
`ben-plan-390-light-items.png`, `busy-plan-1200-dark-items.png`. The accent badge "SPLIT: JALAPEÑO
CHEDDAR" repeats the select under it in the colour that otherwise means a primary button; at 390 px
it wraps into a two-line pill while the select truncates to "Jalapeño chec", and in light its text
is about 4.1:1, under AA at 12 px. "Flex 2" shows in items mode, where flex does nothing (:173).

**10. Doughs editor: all open, some beside the point — cramped.** `DoughsCard.tsx:289-332`,
`:379-653`, `:416`, `:820`; `presets-soft-bun-dough-1200-dark-doughs.png`,
`presets-jalapeno-cheddar-390-light-doughs.png`. With one dough open the card is 2,100 px at 1200
and 4,150 px at 390, empty sections included; a jalapeño split gets the enriched no-sugar hint
(milk, wash, tangzhong, 88–93 °C); "Will be:", the form's main feedback, is plain small text;
150 px fields truncate "After the mix (de…"; on a phone three 44 px buttons leave each header
about 150 px (also `PresetsPage.tsx:80-128`); the notes box does not grow.

**11. Print — cosmetic.** `styles.css:826-940`; `busy-print-light-p1.png` to `-p7.png`,
`busy-print-dark-p5.png`. Seven pages (ingredients 1–3, division and notes 3, timeline 4–7),
nothing split; page 1 ends a third empty because the soft bun block may not split (the rule
working); a sliver of that block's heading icon prints at the foot of page 1; reading 13:25 means
turning between pages 4 and 5. With the dark scheme emulated, Chrome prints `--muted` and
`--warn-ink` in their dark values, pale on white; Firefox darkens light text when printing without
backgrounds, but pinning the light tokens under `@media print` removes the question.

**Phone and light mode.** Nothing overflows at 390 px (a DOM probe over all six plans, kitchen mode
and the editor); the cramped places are 7, 9 and 10, and the check row's ✓ wrapping alone
(`ben-plan-390-dark-ingredients.png`). Light mode is sound: muted text is 5.7:1 on `--card` and
4.8:1 on `--card-2`; the weak pair is the accent badge (9).

## The type, spacing and colour system

`styles.css` has colour tokens for both schemes (fourteen, :1-40) and one radius token, but no type
or spacing tokens: twenty font sizes from 0.72 to 3rem, five of them "small" (three within a pixel
of each other), fourteen spacing values from 2 to 24 px, and 30 inline `style` props in the
components. The new cards follow the sheet (`card`, `stack`, `badge`, `callout`, `muted small`,
plus `.mix-block`, `.split-block`, `.track`); what is missing is levels. The sheet has a card, a row
and a small grey line, and a multi-dough plan needs a section, a sub-section and a note. Proposed:

- Type `--fs-xs` 0.78rem (badges, pills, hints), `--fs-sm` 0.88rem (for 0.85–0.95), `--fs-md`
  1rem, `--fs-lg` 1.15rem; numbers `--num-sm` 1.15rem (not weighed: a portion, a split's total),
  `--num-md` 1.5rem (weighed), `--num-lg` 2.2rem (piece counts); kitchen and print scale them by one
  factor. Space `--sp-1`…`--sp-6` = 4, 8, 12, 16, 24, 32 px; radii as tokens; no inline margins.
- Dough colours `--dough-1`…`--dough-5` for both schemes in library order (main dough neutral), as a
  rule or dot beside a name, never the only carrier.
- One role, one style: the planner's explanations muted `--fs-sm`; the baker's own words (dough,
  add-in and plan notes) ink `--fs-sm` behind a left rule; warnings inside the section they concern;
  "65 %" everywhere (the lib's `fmtPct` gives "65.0%", so cards format their own).
- A section opens with a heading row on a top rule, its figures on that row; a split is a
  sub-section indented behind a rule in its dough colour; card-level lines (starter, scale toggle,
  plan warnings) sit in a footer under a rule.

## The timeline question

**How it works now.** `Timeline` holds a common prefix (`steps`: tangzhong, feed, autolyse, mix),
one `DoughTrack` per dough (mix or split, bulk, divide, bench, folds) and one `Lane` per item, every
step with an absolute `start` and `end`; the card renders the prefix, a boxed block per track, then
the lanes (`TimelineCard.tsx:259-369`). It is good at one thing: each dough's routine reads top to
bottom like a recipe, folds and guide beside its bulk, each length edited where it is read. For one
dough that is the whole story, so a lean plan stays inline (`placeTracks`, :41-46). With two the
reader merges the blocks in their head, and Ben's single bowl gains a block holding one step.

**In order.** One list sorted by start, ties in today's order (prefix, main dough, splits, separate
mixes). A row is time, step (note under it as now), length or "to HH:MM", and a dough tag (icon
and name on a colour dot; on a phone the name only when the dough changes). A narrow gutter carries
a rail per dough while its step runs, so overlaps show without reading times. Rows with the same
label at the same minute merge and carry every tag (folds; here also the 17:55 divide and 18:10
bench); folds become rows; overlapping hands-on steps get a bracket; lengths stay editable (same
step ids, so `timelineOverrides` are untouched); the lanes stay as now, under the list. Ben's case:

```
TIME   STEP                                 LENGTH     DOUGH
09:00  Mix                                  10 min     Main
09:10  Bulk ferment, until the split        40 min     Main
09:40  Fold 1: work in 181 g cheddar and    10 min     Jalapeño cheddar
         58 g jalapeño (all of the dough)
09:50  Bulk ferment, 3 h 50 - 4 h 50 left   to 14:10   Jalapeño cheddar
10:10  Fold 2                                          Jalapeño cheddar
10:40  Fold 3                                          Jalapeño cheddar
11:10  Fold 4                                          Jalapeño cheddar
14:10  Divide & pre-shape                   15 min     Jalapeño cheddar
14:25  Bench rest                           25 min     Jalapeño cheddar
```

The busy plan (gutter: M main, J jalapeño cheddar, B soft bun, S soft sandwich; ● this row's
dough, │ a dough mid-step):

```
TIME   M J B S  STEP                               LENGTH           DOUGH
06:00           Feed starter                       6 h, to 12:00    all
12:00  ●        Autolyse                           45 min           Main
12:45  ●        Mix                                10 min           Main
12:55  ●        Bulk ferment                       5 h, to 17:55    Main
12:55  │   ●    Mix (milk, egg; butter late)       20 min           Soft bun
13:15  │   ●    Bulk ferment                       5 h, to 18:15    Soft bun
13:15  │   │ ●  Mix (milk; butter late)            20 min           Sandwich   ┐
13:25  ●   │ │  Fold 1                                              Main       │ hands
13:25  │ ● │ │  Split off 511 g: work in 72 g      10 min           Jalapeño   ┘ busy
                  cheddar, 23 g jalapeño
13:35  │ ● │ │  Bulk ferment                       4 h 20, to 17:55 Jalapeño
13:35  │ │ │ ●  Bulk ferment                       5 h, to 18:35    Sandwich
13:45  │ │ ● │  Fold 1                                              Soft bun
13:55  ● ● │ │  Fold 2                                              Main, Jalapeño
14:05  │ │ │ ●  Fold 1                                              Sandwich
14:15  │ │ ● │  Fold 2                                              Soft bun
14:25  ● ● │ │  Fold 3                                              Main, Jalapeño
14:35  │ │ │ ●  Fold 2                                              Sandwich
14:45  │ │ ● │  Fold 3                                              Soft bun
14:55  ● ● │ │  Fold 4                                              Main, Jalapeño
15:05  │ │ │ ●  Fold 3                                              Sandwich
15:15  │ │ ● │  Fold 4                                              Soft bun
15:35  │ │ │ ●  Fold 4                                              Sandwich
       ┆ ┆ ┆ ┆  nothing to do until 17:55
17:55  ● ● │ │  Divide & pre-shape                 15 min           Main, Jalapeño
18:10  ● ● │ │  Bench rest                         25 min           Main, Jalapeño
18:15  │ │ ● │  Divide & pre-shape                 15 min           Soft bun
18:30  │ │ ● │  Bench rest                         25 min           Soft bun
18:35      │ ●  Divide & pre-shape                 15 min           Sandwich
18:50      │ ●  Bench rest                         25 min           Sandwich
```

The lanes follow as now (two loaves shape at 18:35, buns at 18:55, the sandwich loaf at 19:15), so
one collision stays unseen: the sandwich dough divides at 18:35 while two loaves are shaped. That
argues for a later step bringing the lanes' shape and bake rows into the list.

**Side by side.** A toggle "In order | By dough" (the existing `.toggle`, `styles.css:296-315`),
defaulting to In order whenever `placeTracks` returns blocks; a lean plan shows no toggle and
renders as today, so its print does not move. The choice is kept per browser under its own key
(`sourdough.v1.timelineView` via `usePersisted`; `UiPrefs` is lib). Print shows the view on screen;
both would add four pages. Kitchen mode is In order only, the lanes' rows merged in and tagged by
item: there the order of jobs is the point and nothing is edited. A "now" line is a cheap extra.

**Cost.** Presentation only: rows come from `timeline.steps`, `tracks[].steps`, `tracks[].folds`
and `lanes[].steps`. A pure `timelineRows(timeline)` (sort, merge, fold rows, rails, overlaps) of
about 80 lines in `src/components/` with a vitest file (the config includes `src/**/*.test.ts`), a
list component of about 120 lines and 60 of CSS; a split's fold numbers come from the base bulk
start as in `BulkDetails` (`TimelineCard.tsx:194-201`). About a day with the print check.

**Recommendation.** In order as the default for any plan with more than one track, By dough one
tap away (the right view for checking one dough's recipe), and kitchen mode In order only.

## Quick wins (under an hour each)

- `styles.css`: `.grid.two { align-items: start }` (:173); lanes `auto-fit, minmax(300px, 1fr)`
  (:601); the light palette re-declared inside `@media print` (:830); kitchen max width (:735).
- `IngredientsCard.tsx`: the reserve rule of finding 4 (:152); no reason line for a whole-dough
  split and no "Main dough, all of it" row (:235, :239); the starter line at the top, split per mix
  (:342-358); the check cell across both columns when there is no usable figure (:178-186).
- `TimelineCard.tsx` and `KitchenMode.tsx`: no reason line on the main dough (:328, :103); no
  autolyse box without a main dough (:289-297); blocks ordered main, splits, separate mixes (:319,
  the rank `DivisionCard.tsx:24` uses); kitchen tracks and lanes as `h3`, reasons at note size.
- `DivisionCard.tsx`: "of Y" only when the figures differ (:150, :172); no "= N g", and "N g
  total" only for a count above one (:76-85).
- `ItemsCard.tsx:162-166`: a neutral "split" or "separate mix" badge without the dough's name.
- `DoughsCard.tsx`: `className="notes-input"` on the notes (:646); the no-sugar hint for separate
  doughs only (:820).

## Redesign scope: what `PLAN-redesign.md` would hold

Decisions continue at 24: two timeline views as above; no edits under `src/lib`; presentation
helpers in `src/components` with their own tests; card CSS in per-card files, so parallel packages
never share `styles.css`; dough colours as tokens.

| Package               | Size | Owns                                                         | Does                                                                                                                                         |
| --------------------- | ---- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 Tokens             | S    | `src/styles.css`                                             | Tokens; small sizes merged; print palette; grid, lane and phone step-row fixes; empty per-card CSS files and imports for wave 2.             |
| R2 Ingredients        | M    | `IngredientsCard.tsx`, `ingredients.css`                     | Sections and nested splits, a portion line not a weigh line, one notes style, a footer, warnings by their dough, reserve rule, starter line. |
| R3 Division and Items | S    | `DivisionCard.tsx`, `ItemsCard.tsx`, their CSS               | No repeated figures, one-piece groups full width, badge and select, an optional live add-ins hint.                                           |
| R4 Timeline           | M    | `TimelineCard.tsx`, `timelineRows.ts` + test, `timeline.css` | Toggle and In order list (tags, rails, merged rows, overlap marks); By dough as today, reasons trimmed, tracks ordered.                      |
| R5 Kitchen            | S    | `KitchenMode.tsx`                                            | In order with lanes merged, heading levels, max width, optional "now" line. After R4.                                                        |
| R6 Doughs editor      | M    | `DoughsCard.tsx`, `PresetsPage.tsx`, `doughs.css`            | Collapsible sections with summaries, "Will be" as a callout, phone headers, wider fields, growing notes.                                     |
| R7 Print and browsers | S    | each CSS file's print block                                  | New classes atomic; lean, Ben, B, B3 and busy printed in Chrome and Firefox, nothing split; screenshots at both widths and schemes.          |

Waves: R1 alone; R2, R3, R4 and R6 together on their own files; then R5 and R7. Must not move:
`src/lib`; the lean plan's numbers, step ids (`mix`, `bulk`, `shape:loaf` …), lane keys and saved
`timelineOverrides`; a lean timeline as one list with no toggle; print in block flow with every
step, row, lane, track, piece and callout atomic and no grid or flex fragmentation (Firefox); no
new dependencies. Lib follow-ups for a separate small package: the reserve rule in `plainMixNote`
(`timeline.ts:183-187`), "track carries on" (`:317`), the tangzhong feed clause (`:501`), the main
dough's reason (`calc.ts:795`), shape notes against a dough's bake (follow-ups 7, 16), `fmtPct`'s
"65.0%", and `splitAt` on `DoughResult` (follow-up 19).

## Screenshots

In `/private/tmp/claude-501/-Users-benralton-repos-BEN-WORKING-sourdough-planner/c918bbe0-41d7-4012-af76-0b4b2d7a6413/scratchpad/style-review/`,
named `<state>-<view>-<width>-<scheme>[-<card>].png`. States: `lean` (today's default), `ben` (two
600 g loaves on Jalapeño cheddar, items, tick box off, 65 %), `roll` (one bread roll on it: 100 g +
20 g), `b`, `b3` (the plan's worked examples), `busy` (a lean loaf, a jalapeño loaf, six burger buns,
a sandwich loaf, feed and autolyse, from 06:00). Views: `plan` (full page and card crops), `kitchen`,
`presets-soft-bun-dough` and `presets-jalapeno-cheddar` (with `-doughs` crops), and
`busy-print-{light,dark}-p1…p7` (Chrome's PDF, a page each, rasterised with `sips`).
