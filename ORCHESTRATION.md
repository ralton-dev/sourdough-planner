# Orchestration notes for sourdough-planner

Project facts an orchestrator or a cold agent needs that the code does not say. Written during
the doughs plan (`PLAN-doughs.md`, 2026-10-11); keep it current when they change.

## Verification gate

Every package, after its commit:

```
npm run format && npm run lint && npm run typecheck && npm test && npm run build
```

`format` is `prettier --check .` (it also checks Markdown, including plans); `format:fix` writes.
Anything that touches a printed surface (`@media print`, cards, kitchen mode) also runs the print
check below. Nothing is pushed until Ben has looked at the app locally and said so: pushing `main`
builds and publishes the Docker image.

## Print check

Browsers fragment grid and flex containers unreliably, so the print layout is block flow and each
`.step`, `.lane`, `.track`, `.piece`, `.subsection`, `.mix`, callout and card that fits a page is
atomic (commit `1980585`; an Ingredients section with splits may break, but only before a split).
Verify, do not eyeball:

```
npm run screens:print -- --both --png --out <dir>
```

It prints every state in `scripts/screens/states.mjs` in Chrome (DevTools protocol) and in Firefox
(WebDriver BiDi, Firefox's own print path: Quartz on macOS), checks that every block that must be
whole sits on one page (exit 1 if not), says how far down page 1 the text reaches, and writes each
page as a PNG to look at, which is still the point. `--state busy`, `--scheme dark` (the print
palette must hold) and `--timeline dough` narrow it; `scripts/screens/README.md` has every flag.
Ben's browser is Firefox: never rely on grid or flex fragmentation in print CSS, and Firefox
ignores `break-after: avoid`, so a heading stays with what follows only inside an atomic block.

## Seeing state

The app's state lives in `localStorage` (`sourdough.v1.*`), which the screens harness seeds:

```
npm run screens -- --state busy --width 390 --scheme light --out <dir>
```

shoots the plan page and each of its cards for the states in `scripts/screens/states.mjs` (the
style review's six and `stress`; a new state is an entry there). `--view kitchen`, `--view presets
--open "Soft bun dough"`, `--timeline dough`, `--firefox` and `--text` (the cards' text, no
pictures) cover the rest. Each run builds the working tree into a scratch folder and serves it on a
free port, so Ben's dev server on :5173 is never touched; `--dist <dir>` serves another build
instead, which is how to compare before and after: build `HEAD` in a scratch worktree (`git
worktree add --detach`, symlink `node_modules`, `npx vite build --outDir <dir>`), then shoot both
and compare the PNGs. Only a view that needs wiring `App.tsx` does not have yet still needs the
temporary wiring in such a worktree; never commit from it, and remove it with
`git worktree remove --force` when done.

## Git conventions

- Commit straight onto `main`; no branches. Stage only the files a package owns, by name. Never
  `git add -A`, `git stash`, `git checkout --` or `git restore` while other agents share the tree.
- Message: `type(scope): summary` with a short body saying why (`feat(lib)`, `fix(app)`,
  `docs(plan)`, `ci(docker)`); one commit per package, plus follow-ups as their own commits.
- Plans live at the repo root (`PLAN-<idea>.md`); research under `docs/`. Decisions are numbered
  continuously: `PLAN-doughs.md` ends at decision 23; the next plan starts at 24.

## Code conventions that bite

- No new dependencies, dev ones included. Strict TypeScript with `noUnusedParameters`; an unused
  parameter needs a leading underscore and an eslint-disable, so do not design "accepted and
  ignored" parameters.
- Pure logic in `src/lib` with vitest; components are typechecked and looked at, never unit-tested.
- Percentages are fractions of total flour including the starter's flour; hydration is true
  hydration. The §5.5 reference bake (1000 / 718.75 / 250 / 22.5 / 1991.25, loaf 605.625) is frozen
  on `REF_PRESETS` fixtures in `calc.test.ts` and `timeline.test.ts`; it must not move.
- `NumberField` tolerates half-typed values and clamps on blur; do not re-sync it on every change.

## Failures this project keeps having

- **The one-dough assumption** is written in more places than any list: React keys by preset id,
  lane dedupe by preset, labels by preset name, totals that mix piece grams with mix totals. Hunt
  for it; the plan's §10 lists the known sites.
- **Two copies of the maths drift.** The timeline once recomputed allocation to put grams in its
  notes and disagreed with calc at a .5 g tie. One source: `computePlan`'s result.
- **Reconciling defaults resurrects deletions** unless the browser records what it was already
  given (`sourdough.v1.seeded`).
- **Prettier fails CI on Markdown**, including plans; run `format:fix` on docs too.
- **Agents die at the end** of a package: commit before the long final run, emit output between
  steps, do the browser pass first.

## Standing rules

- Sugar-free by default; sweetness is a per-dough none / sugar / sweetener choice. Do not list
  ingredients that cannot be bought in the UK (allulose was dropped).
- Piece weight with or without add-ins is a per-plan tick box, default on.
- Egg, milk, sugar and tangzhong doughs are mixed separately; butter and inclusions are split off
  the main mix at a fold. Do not relitigate without the plan's decision number.
