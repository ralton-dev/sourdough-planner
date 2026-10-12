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

Every state is seeded with the guide quiet (`sourdough.v1.guide` = `{ seen: true, dismissed: [the
three beacons] }`, `GUIDE_QUIET` in `scripts/screens/app.mjs`; `print.mjs` seeds the same), so no
shot or print carries the walkthrough or a beacon unless asked. `--guide tour:<n>` opens the
walkthrough at step _n_, `hint:<card>` a card's `?`, `show:<card>` its first "show me",
`beacon:<target>` one beacon and `beacons` every beacon on the page; `scripts/screens/README.md`
has the details.

## Accounts locally

Accounts are off unless all six account variables are set (`PLAN-accounts.md` §3). To walk them,
start the test-only issuer, which prints the env block to start the app against it:

```
node server/fake-issuer.mjs        # 127.0.0.1:9400; FAKE_ISSUER_DENY=1 answers access_denied
```

then, in another terminal, after `npm run build`:

```
DATA_DIR=$TMPDIR/sdp-local-data APP_URL=http://127.0.0.1:8080 \
  OIDC_ISSUER=http://127.0.0.1:9400/application/o/sdp/ \
  OIDC_CLIENT_ID=sdp-local OIDC_CLIENT_SECRET=sdp-local-secret \
  SESSION_SECRET=insecure-local-only-session-secret-0123456789 \
  node server/index.mjs
```

- Open `http://127.0.0.1:8080`, not `localhost`: the cookie belongs to `APP_URL`'s host.
- Every sign-in is the same user ("Test Baker"), so a private window (or a second browser profile)
  is the second device of one person: edit different sections on each to see the merge notice.
- The server holds `index.html` in memory: restart it after a rebuild, or it serves the old
  bundle's hashed asset names.
- `kill -9` the server to simulate a lost network ("Offline, changes kept"); SIGTERM shuts down
  gently and the client sees a clean close, not an outage. Start it again to see the recovery.
- A plain-http issuer is accepted only on loopback; nothing local or in a test ever points at a
  real issuer.

## Git conventions

- Commit straight onto `main`; no branches. Stage only the files a package owns, by name. Never
  `git add -A`, `git stash`, `git checkout --` or `git restore` while other agents share the tree.
- Message: `type(scope): summary` with a short body saying why (`feat(lib)`, `fix(app)`,
  `docs(plan)`, `ci(docker)`); one commit per package, plus follow-ups as their own commits.
- Plans live at the repo root (`PLAN-<idea>.md`); research and the deployment contract
  (`docs/deployment.md`) under `docs/`. Decisions are numbered continuously: `PLAN-doughs.md`
  ended at 23, `PLAN-redesign.md` at 36, `PLAN-accounts.md` ends at 52; the next plan starts
  at 53.

## Code conventions that bite

- No new dependencies, dev ones included. Strict TypeScript with `noUnusedParameters`; an unused
  parameter needs a leading underscore and an eslint-disable, so do not design "accepted and
  ignored" parameters.
- Pure logic in `src/lib` with vitest; components are typechecked and looked at, never unit-tested.
- Percentages are fractions of total flour including the starter's flour; hydration is true
  hydration. The §5.5 reference bake (1000 / 718.75 / 250 / 22.5 / 1991.25, loaf 605.625) is frozen
  on `REF_PRESETS` fixtures in `calc.test.ts` and `timeline.test.ts`; it must not move.
- `NumberField` tolerates half-typed values and clamps on blur; do not re-sync it on every change.
- **Migrations (decision 41):** `server/migrations/NNN_name.sql`, numbered, applied at boot in the
  server's own process, one transaction each, recorded in `schema_migrations`. Each is idempotent
  (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) and never contains `DROP`,
  `DELETE` or `TRUNCATE`. A change to an applied file does nothing; add the next number.
- **The image runs `npm ci --omit=dev`**: only the server's `openid-client` is a dependency.
  Everything Vite bundles (React, driver.js) stays in `devDependencies`, or the runtime stage
  installs it for nothing.
- **`node:sqlite` needs Node 22.13 or later** (`engines` says `>=22.13`; the image pins
  `node:22.23-alpine`). An older local Node fails the server tests on the import.

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
