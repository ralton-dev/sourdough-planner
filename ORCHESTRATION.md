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
`.step`, `.lane`, `.track`, `.piece` and callout is atomic (commit `1980585`). Verify, do not eyeball:

1. `npm run build`, serve `dist/` on a non-default port (`node server/index.mjs` or `npx vite preview --port 4173`).
2. `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --print-to-pdf=<out.pdf> --no-pdf-header-footer --virtual-time-budget=3000 <url>`
   Chrome does not exit by itself: kill it once the PDF exists. macOS has no `timeout`.
3. Per-page text with pypdf in a scratchpad venv; rasterise with `sips -s format png` and look.
4. Ben's browser is Firefox: never rely on grid or flex fragmentation in print CSS.

Screenshots for a look: `--headless=new --screenshot=<png> --window-size=1200,2400 <url>`.

## Seeing state the app does not have yet

The app's state lives in `localStorage` (`sourdough.v1.*`), which headless Chrome cannot be given
from the command line. To look at a view that needs a plan, doughs or a wiring that is not in
`App.tsx` yet, use a scratch `git worktree` (symlink the repo's `node_modules` into it), make the
temporary wiring or seeded state there, run `vite` on a unique port, and never commit from it.
Remove it with `git worktree remove --force` when done.

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
