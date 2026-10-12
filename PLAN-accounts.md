# PLAN-accounts — the planner belongs to a person, and shows them around

Base: `44a8918` on `main` (deployed as `sha-44a8918…` on 2026-10-12). Conventions, gate and the
failures this project keeps having: `ORCHESTRATION.md`. Decisions continue from `PLAN-redesign.md`
(24–36) at 37. `file:line` references are **hints to verify**: grep for the symbol, confirm it says
what the plan claims, and report drift rather than working around it.

## 1. The defect

Everything a baker builds up lives in one browser, and nothing on the page explains itself.

| surface                                                    | what it does                                                             | observed                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `src/lib/storage.ts` `KEYS`                                | six `localStorage` keys under `sourdough.v1`                             | custom doughs, presets and saved plans vanish on a new device or a cleared browser (Ben, 2026-10-12)     |
| `src/App.tsx:28` `loadAll()`                               | reads that storage once at module load                                   | no notion of who is using the app; nothing can be pulled from anywhere else                              |
| `PresetsPage` Backup card                                  | "Export JSON" / "Import JSON", bundle version 2                          | the only way across devices; an import replaces everything rather than merging                           |
| `src/components/Footer.tsx`                                | "Everything you enter stays in this browser … no accounts, cookies"      | true today; the sentence must switch with the mode, not be deleted                                       |
| `Dockerfile` runtime stage                                 | "Runtime has no npm dependencies"; copies `dist/` and `server/index.mjs` | the server can serve files and nothing else                                                              |
| homelab `manifests/sourdough-planner/deployment.yaml:8,77` | "not even a /tmp emptyDir"; `readOnlyRootFilesystem: true`               | there is nowhere for a database file until a volume is mounted                                           |
| `server/index.mjs`                                         | 168 lines: `/healthz`, `/readyz`, static files                           | no routes, no sessions, no config beyond port, host, version, static dir                                 |
| the plan page                                              | four redesigned cards, a Doughs editor with collapsed parts              | nothing says what a split is or where the tangzhong lives (`DoughsCard.tsx:729`); Ben found it by asking |
| the guidance mock (2026-10-12)                             | driver.js walkthrough and `?` cards; hand-drawn annotations              | Ben kept driver.js and rejected the annotations: "too much going on … overlap text"                      |

**The reframing:** the planner belongs to a person, not to a browser, and it explains itself in
place. A sign-in is a door that is open by default (no login configured means today's app), state
follows the person, and help is a tap away on the thing it explains.

---

## 2. Decisions — do not relitigate

Carried forward: 15 (the §5.5 reference bake is frozen), 22 (deletion belongs to the package that
supersedes), 23 (no sugar by default), 27 (presentation helpers are pure and tested), 28–30 (tokens,
per-card CSS, levels), 32 (the lean plan does not move; print stays atomic). New, settled with Ben
on 2026-10-12:

37. **Accounts are optional and off by default.** With no `OIDC_ISSUER` configured the app is
    exactly today's: local storage, no cookies, no requests to the server beyond the files, and the
    footer's privacy sentence as it is. With it configured, the footer says what is stored where.
    Self-hosters lose nothing.
38. **Plain OIDC, no vendor SDK.** Authorization Code with PKCE against any OIDC issuer found by
    discovery from `OIDC_ISSUER`; Authentik (already in Ben's cluster) first, Auth0, Keycloak or
    Google by configuration. One server-only dependency, `openid-client@6.8.8` (pulls `jose` and
    `oauth4webapi`), pinned; nothing else on the server.
39. **The server is the client (BFF).** It redirects to the issuer, handles the callback, keeps the
    session server-side and sets one cookie: `sdp_session`, `HttpOnly`, `SameSite=Lax`, `Secure`
    when `APP_URL` is https, `Path=/`, 30 days sliding. ID and access tokens never reach the
    browser and are not stored after the callback beyond the claims used (`iss`, `sub`, `email`,
    `name`). Logout deletes the session and, when the issuer publishes `end_session_endpoint`,
    sends the browser there with `post_logout_redirect_uri`.
40. **SQLite through Node's built-in driver**, `node:sqlite`, so the runtime stays free of native
    builds: the image pins `node:22.23-alpine` (`node:sqlite` is unflagged from 22.13; the API is
    marked "active development", which the pin absorbs). The file is `$DATA_DIR/planner.sqlite`,
    WAL mode, one connection, `busy_timeout` 5 s. Not the cluster's shared Postgres: self-hosters
    first, one file, no second service. The store sits behind `server/store.mjs` (`getUser`,
    `upsertUser`, `createSession`, `getSession`, `touchSession`, `deleteSession`, `getState`,
    `putState`), which is the seam for a Postgres driver if the homelab prefers its CNPG backups.
41. **Migrations are numbered SQL files** in `server/migrations/NNN_name.sql`, applied at boot in
    one transaction each, recorded in `schema_migrations(id, applied_at)`, and written so a second
    run is a no-op (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`; never `DROP`,
    `DELETE` or `TRUNCATE` in a migration). Ben's standing rule.
42. **Schema (001):** `users(id INTEGER PRIMARY KEY, issuer TEXT, subject TEXT, email TEXT, name
TEXT, created_at TEXT, last_seen_at TEXT, UNIQUE(issuer, subject))`; `sessions(id TEXT PRIMARY
KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, created_at TEXT, expires_at TEXT,
last_seen_at TEXT)`; `states(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
version INTEGER NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL)`. One document per
    user, the export bundle. Sharing a plan or a dough later adds its own tables beside these and
    touches none of them.
43. **The sync protocol is three routes.** `GET /api/me` → `{ enabled: boolean, user?: { name,
email } }` (200 always). `GET /api/state` → 200 `{ version, updatedAt, bundle }`, 204 when the
    user has none, 401 when not signed in. `PUT /api/state` with `{ baseVersion, bundle }` → 200
    `{ version, updatedAt }` when `baseVersion` equals the stored version (or 0 and none stored),
    409 `{ version, updatedAt, bundle }` otherwise, 401 when not signed in, 413 above 1 MiB, 400
    when the body is not a bundle the server recognises (shape and size only; the client validates
    content with `parseBundle`). Writes require `Content-Type: application/json`, which with
    `SameSite=Lax` is the CSRF guard.
44. **Bundle version 3** adds `updatedAt: Partial<Record<Section, string>>` for the six sections
    `presets`, `doughs`, `bulkTable`, `savedPlans`, `plan`, `ui`, each an ISO timestamp of its last
    change on that device. `parseBundle` accepts 1, 2 and 3 (older files get every timestamp set to
    the import moment). Export writes 3.
45. **Merge: newest wins per section.** `mergeBundles(local, remote)` returns, per section, the
    side with the later `updatedAt` (ties to remote), and says which sections changed on which
    side. The merged document is what the client keeps and pushes. Nothing is merged inside a
    section; a plan edited on two devices in the same minute takes the later save whole.
46. **Sync is offline-first.** Local storage stays the source the app renders from. Signed in: pull
    on load and after sign-in; push 1.5 s after the last change (one debounced `PUT` with the known
    version); on 409 merge, apply, push again; on network failure keep local, retry with backoff
    (5 s, 30 s, 2 min, then every 5 min) and say "Offline, changes kept"; on 401 say "Sign in
    again". Status lives in the Backup card and, as a dot, on the account menu.
47. **Guidance is driver.js, a client dependency**, `driver.js@1.3.1`, pinned, bundled by Vite
    (no CDN, no egress). Popovers take the planner's look through `popoverClass: "sd-pop"` and the
    `onPopoverRender` hook. Hand-drawn annotations are out (Ben, after the mock).
48. **Targets are `data-guide` attributes**, not CSS classes or ids that a restyle could move:
    `data-guide="items"`, `"items.addins"`, `"ingredients"`, `"ingredients.split"`, `"division"`,
    `"timeline"`, `"timeline.view"`, `"doughs"`, `"doughs.tangzhong"`, `"backup"`, `"account"`.
    Every piece of copy names a target; a test proves each target renders.
49. **Three kinds of help.** The walkthrough: six steps, runs once per browser on first load of the
    plan page (`sourdough.v1.guide` = `{ seen: true, dismissed: [] }`), re-runnable from the footer
    "Show me around". Hint cards: a `?` on each card opens a driver.js highlight of that card with
    two or three sentences and "show me" links that light one element. Beacons: driver.js hints on
    the add-ins tick box, the In order / By dough toggle and the Tangzhong part, shown until
    dismissed. None of them changes a number, a step id or stored state beyond that key; kitchen
    mode and print carry none of it.
50. **Copy lives in one file**, `src/guide/copy.ts`, typed, so wording changes are one edit and the
    target test reads it.
51. **The lib is frozen except `storage.ts`** (bundle v3) and the new `sync.ts`; `calc.ts`,
    `timeline.ts`, `warnings.ts`, `format.ts`, `doughs.ts`, `types.ts` do not change.
52. **Deployment is a plan of its own**, written with `/jarvis-homelab-app` from this repo into
    homelab-k8s and executed there by Ben: a PVC mounted at `/data`, the OIDC client as a sealed
    secret, an Authentik OAuth2 provider and application, `readOnlyRootFilesystem` kept. This plan
    carries the app's side of that contract (§5) and nothing of the cluster's.

---

## 3. The server after this plan

```
server/
  index.mjs        config (+ DATA_DIR, APP_URL, OIDC_*, SESSION_SECRET), static files, /healthz,
                   /readyz (also opens the database), mounts the route table
  router.mjs       addRoute(method, pattern, handler); json(); readJson(req, limit); cookies
  db.mjs           open(DATA_DIR), migrate(db), close
  migrations/001_init.sql
  store.mjs        users, sessions, states (decision 40)
  auth.mjs         /auth/login, /auth/callback, /auth/logout, /api/me (decision 39)
  state.mjs        /api/state GET and PUT (decision 43)
  fake-issuer.mjs  a test-only OIDC issuer on 127.0.0.1: discovery, JWKS, authorize, token
  *.test.mjs       vitest over HTTP, as server.test.mjs does today
```

Configuration (all env; `readConfig` validates and the README's "Running it" table lists them):

| variable             | default | meaning                                                                    |
| -------------------- | ------- | -------------------------------------------------------------------------- |
| `DATA_DIR`           | unset   | directory for `planner.sqlite`; unset = accounts off, no database opened   |
| `APP_URL`            | unset   | public origin, e.g. `https://sourdough.ralton.dev`; needed when OIDC is on |
| `OIDC_ISSUER`        | unset   | discovery base; unset = accounts off                                       |
| `OIDC_CLIENT_ID`     | unset   |                                                                            |
| `OIDC_CLIENT_SECRET` | unset   | confidential client; PKCE is used as well                                  |
| `SESSION_SECRET`     | unset   | ≥ 32 bytes, signs the session cookie; required when OIDC is on             |
| `SESSION_DAYS`       | 30      | sliding session lifetime                                                   |

Accounts are "on" only when `DATA_DIR`, `APP_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
`OIDC_CLIENT_SECRET` and `SESSION_SECRET` are all set; any subset is a startup error naming the
missing ones (never a silent local-only mode with half a config).

Login flow: `GET /auth/login` → generates `state`, `nonce`, PKCE verifier, stores them in a short
`sdp_login` cookie (HttpOnly, 10 min), redirects to the issuer; `GET /auth/callback` → validates
state, exchanges the code (`openid-client`'s `authorizationCodeGrant`), reads the ID token claims,
upserts the user, creates a session, sets `sdp_session`, redirects to `/`. `POST /auth/logout` →
deletes the session, clears the cookie, redirects to the issuer's end-session URL when it has one,
else to `/`. Session ids are 32 random bytes, base64url; the cookie carries the id plus an HMAC
(`SESSION_SECRET`) so a forged id is rejected before the database is asked.

---

## 4. The client after this plan

```
src/lib/storage.ts   bundle v3 (decision 44); parseBundle 1–3; KEYS gains guide and sync meta
src/lib/sync.ts      pure: Section, SyncMeta, mergeBundles, sectionsChanged, nextBackoff
src/sync/useSync.ts  the hook: me(), pull(), push() with debounce and backoff, status
src/components/AccountMenu.tsx   nav: "Sign in" / name with a status dot / "Sign out"
src/components/PresetsPage.tsx   Backup card: sync status line and "what came from where"
src/components/Footer.tsx        privacy text by mode; "Show me around"
src/guide/copy.ts    every tour step, hint card and beacon, keyed by data-guide target
src/guide/tour.ts    driver() factories, theming, first-run logic, GuideButton
src/guide/hints.tsx  the ? button, hint cards with "show me", beacons
src/guide/guide.css  .sd-pop and the ? button, imported by tour.ts
```

`App.tsx` keeps its six `useState`s and `usePersisted`s. `useSync` sits beside them: it reads
`/api/me` once, pulls when signed in, watches the six values and their `updatedAt` map (a seventh
state, `syncMeta`, persisted under `sourdough.v1.sync` = `{ version, updatedAt: {...} }`), and
pushes. Every setter in `App.tsx` that changes a section also stamps `updatedAt[section] = now`
through one helper (`touch(section)`), so the timestamps are exact and the hook needs no diffing.

Status strings (Backup card and menu tooltip): "Local only. Sign in to keep this on every device."
· "Signed in as Ben, synced 21:14." · "Offline, changes kept; will sync when back." · "Sign in
again to keep syncing." · after a merge: "Merged: presets and doughs from this device, saved plans
from the server."

---

## 5. The deployment contract (the app's side; §52)

- Image `node:22.23-alpine`, uid 1000, read-only root, **one writable mount at `/data`** (PVC,
  ReadWriteOnce, 1 GiB is plenty; the file is kilobytes per user), `DATA_DIR=/data`.
- Env from a sealed secret: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SESSION_SECRET`; from the
  ConfigMap: `APP_URL`, `OIDC_ISSUER`, `DATA_DIR`, `SESSION_DAYS`.
- Authentik: an OAuth2/OpenID provider (confidential, redirect `https://sourdough.ralton.dev/auth/callback`,
  signing key, scopes `openid profile email`) and an application bound to it; the deployment plan
  writes the exact steps.
- Probes unchanged: `/healthz` liveness; `/readyz` now also fails when the database cannot be
  opened or migrated.
- Egress: the server reaches `OIDC_ISSUER` (discovery, token endpoint, JWKS) and nothing else; the
  NetworkPolicy allows that one destination. The browser reaches only the app.
- Backup: the deployment plan snapshots the PVC; the app adds nothing. (Copying a WAL-mode file
  while the app runs is not a consistent backup; a volume snapshot is.)
- One replica. The store is one file; a second replica would need Postgres (decision 40's seam).

---

## 6. Work packages

Rule for every package (decision 22): what you supersede you delete in the same commit and report
per symbol. No new dependencies beyond the two named (decisions 38, 47). Server code is plain
`.mjs`, dependency-free except `openid-client`, tested with vitest over HTTP.

### P1 · Store, migrations, router, and the server's red pin

**Goal:** the server can open a database, migrate it, keep users, sessions and states, and mount
routes from modules, with the state pin failing against a 404.

- `server/db.mjs`: `openDatabase(dataDir)` (creates the file, WAL, foreign keys on,
  `busy_timeout`), `migrate(db, dir)` (decision 41), `closeDatabase`.
- `server/migrations/001_init.sql`: decision 42, idempotent.
- `server/store.mjs`: decision 40's functions over prepared statements; `putState` is one
  transaction that compares the version and bumps it; sessions expire by `expires_at` and are
  swept on `touchSession`.
- `server/router.mjs`: a route table (`method`, exact path or `/prefix/*`), `json(res, status,
body)`, `readJson(req, limitBytes)` (413 beyond the limit, 400 on bad JSON), cookie parse and
  set helpers with the flags of decision 39.
- `server/index.mjs`: `readConfig` gains the §3 variables and the all-or-nothing rule; `createApp`
  opens the database when `DATA_DIR` is set, mounts `authRoutes` and `stateRoutes` from
  `./auth.mjs` and `./state.mjs` (P1 creates both files as stubs exporting an empty route list;
  P2 and P3 fill them without touching `index.mjs`), serves static files as today, and `/readyz`
  reports the database.
- `Dockerfile`: pin `node:22.23-alpine` in both stages; the runtime stage copies `package.json`,
  `package-lock.json` and runs `npm ci --omit=dev --no-audit --no-fund` (the one dependency arrives
  with G1 in this wave; the Dockerfile must build either way); `COPY server ./server` whole.
- Tests: `server/db.test.mjs` (migrate twice is a no-op; a bad SQL file fails loudly),
  `server/store.test.mjs` (user upsert by issuer+subject; session create/touch/expire/delete;
  state put/get/version conflict). **The red pin**, `server/state.test.mjs` as `it.fails`: mint a
  session straight through the store, `PUT /api/state` with a bundle and `baseVersion` 0 → 200
  `{ version: 1 }`, `GET` → the bundle, a second `PUT` with `baseVersion` 0 → 409 carrying version
  1; today it fails on 404. Without a session, 401 (also pinned).
- `npm test` keeps running the server tests (`vitest.config.ts` already includes `server/**/*.test.mjs`).

**Acceptance:** gate green with exactly the state pins as `it.fails`; `readConfig({})` gives
accounts off and opens nothing; `readConfig` with a partial OIDC config throws naming the missing
variables; the image builds for both platforms with `docker build` locally for amd64 at least.

Owns: `server/db.mjs`, `server/migrations/`, `server/store.mjs`, `server/router.mjs`,
`server/index.mjs`, `server/auth.mjs` and `server/state.mjs` (stubs only), `server/db.test.mjs`,
`server/store.test.mjs`, `server/state.test.mjs` (the pin), `Dockerfile`. Size **M**. Depends: none.

### C1 · Bundle v3 and the merge (lib)

**Goal:** a bundle carries per-section timestamps, old bundles still import, and the merge is a
pure, tested function.

- `src/lib/storage.ts`: `ExportBundle.version: 1 | 2 | 3`, `updatedAt?: Partial<Record<Section,
string>>`; `exportBundle` writes 3 with the timestamps it is given; `parseBundle` accepts 1–3 and
  fills missing timestamps with the import moment; `KEYS.sync` (`sourdough.v1.sync`) and
  `KEYS.guide` (`sourdough.v1.guide`) with validators; `isBundleShape` exported for the server's
  structural check to mirror (the server cannot import TS; P3 copies the shape rules and a test
  asserts the two agree on fixtures).
- `src/lib/sync.ts`: `Section`, `SECTIONS`, `SyncMeta`, `mergeBundles(local, remote)` (decision 45) returning `{ bundle, fromLocal: Section[], fromRemote: Section[] }`, `nextBackoff(attempt)`,
  `describeMerge(result)` for the status line.
- Tests: v1 and v2 bundles import with timestamps; v3 round-trips; merge cases: all newer local,
  all newer remote, mixed, equal (remote wins), missing sections on one side.

**Acceptance:** `npm test` green; every existing storage test unchanged; `grep -rn "version: 2"
src/` finds only the parse path.

Owns: `src/lib/storage.ts`, `src/lib/storage.test.ts`, `src/lib/sync.ts`, `src/lib/sync.test.ts`.
Size **S**. Depends: none.

### G1 · driver.js, the tour, the copy, and the guide's red pin

**Goal:** the walkthrough exists and runs on the plan page, the copy is in one file, and a test
proves every target exists (failing until G2 adds the attributes).

- `package.json` / `package-lock.json`: add `driver.js@1.3.1` (dependency) and
  `openid-client@6.8.8` (dependency; the server's) — this package owns both files this wave.
- `src/guide/copy.ts`: typed `TOUR` (six steps, all on the plan page: items, ingredients,
  division, timeline, the view toggle, the account menu), `HINTS` (per card: title, two or three sentences, "show me"
  targets), `BEACONS` (`items.addins`, `timeline.view`, `doughs.tangzhong`), every entry naming a
  `data-guide` target (decision 48).
- `src/guide/tour.ts`: `startTour()`, `firstRun()` (reads `KEYS.guide`, runs once, records
  `seen`), `GuideButton` (the footer's "Show me around"), the driver config (`popoverClass`,
  `showProgress`, `progressText "{{current}} of {{total}}"`, `nextBtnText` "Next", `prevBtnText`
  "Back", `doneBtnText` "Done", `stagePadding` 6, `stageRadius` 14, `allowClose`), `skipMissingElement`
  on so a target absent on this plan (no doughs card on the plan page) is skipped, not an error.
- `src/guide/guide.css`: `.sd-pop` on the tokens (the mock's rules), the `?` button, the beacon
  colour; imported by `tour.ts`.
- **The red pin**, `src/guide/targets.test.ts` as `it.fails`: render the four plan cards and the
  Doughs card with `react-dom/server` on the busy fixture (as earlier agents did) and assert every
  target named in `copy.ts` appears as `data-guide="…"` in the markup; fails until G2.
- Nothing mounts the tour yet (C2 mounts `GuideButton` and calls `firstRun()`); `npm run build`
  must include driver.js without a CDN reference (`grep -r "cdn" dist/` empty).

**Acceptance:** gate green with the targets pin as `it.fails`; `startTour()` runs against the
built app in a scratch build with the mock's steps (screenshots of two steps); bundle size growth
under 8 kB gzipped.

Owns: `package.json`, `package-lock.json`, `src/guide/` (new, all files). Size **M**. Depends: none.

### P2 · Login

**Goal:** a user can sign in through any OIDC issuer and out again, with the session server-side.

- `server/auth.mjs`: decision 39 and the §3 flow with `openid-client` (`discovery`,
  `buildAuthorizationUrl`, `authorizationCodeGrant`, `buildEndSessionUrl`); `/api/me`.
- `server/fake-issuer.mjs`: an in-process issuer for tests: discovery document, JWKS (an RSA key
  generated at start), `/authorize` that redirects straight back with a code, `/token` that
  returns an ID token signed for the given `nonce`, `end_session_endpoint`. Test-only, not shipped
  in the image (`Dockerfile` copies `server/` whole: exclude `*.test.mjs` and `fake-issuer.mjs`
  via `.dockerignore`, which P2 adds).
- `server/auth.test.mjs`: login redirect carries `state`, `nonce`, PKCE; a callback with a wrong
  state is 400; a good callback sets the cookie, creates the user and the session; `/api/me` shows
  the user; logout clears the session and redirects to the issuer's end-session URL; a forged
  cookie is 401; an expired session is 401; accounts off: `/api/me` → `{ enabled: false }` and
  `/auth/login` → 404.

**Acceptance:** all of the above green; no token is logged (`grep -n "console" server/auth.mjs`
shows none); `openid-client` is the only non-Node import across `server/`.

Owns: `server/auth.mjs`, `server/auth.test.mjs`, `server/fake-issuer.mjs`, `.dockerignore`.
Size **M**. Depends: P1, G1 (the dependency).

### P3 · State API

**Goal:** the three routes of decision 43, and the pin flips.

- `server/state.mjs`: GET/PUT with the store; structural check mirrored from `isBundleShape`
  (version 1–3, the six sections present as arrays/objects, size ≤ 1 MiB); `Content-Type` guard;
  409 returns the stored document.
- Flip `server/state.test.mjs` to plain `it` and add: 413, 400 on a non-bundle, 409 payload equals
  the stored body, `PUT` after 409 with the returned version succeeds, two users do not see each
  other's state.

**Acceptance:** `grep -c "it.fails" server/*.test.mjs` is 0; every case above green.

Owns: `server/state.mjs`, `server/state.test.mjs`. Size **S**. Depends: P1, C1 (for the shape
fixtures it mirrors; read-only).

### G2 · Hint cards, beacons, targets

**Goal:** every card has a `?`, the three beacons exist, every `data-guide` target renders, and the
guide pin flips.

- `data-guide` attributes (decision 48) on: `ItemsCard` root and the add-ins tick box;
  `IngredientsCard` root and the first split sub-section; `DivisionCard` root; `TimelineCard` root
  and the In order / By dough toggle; `DoughsCard` root and the Tangzhong part's heading. The `backup` and `account` targets live in C2's files
  (`PresetsPage`, `AccountMenu`): G2 lists them under `WAVE_3_TARGETS` in `copy.ts`, the targets
  test skips that list, and C2 adds the attributes and empties it.
- `src/guide/hints.tsx`: `HintButton({ card })` rendering the `?` and opening the hint card
  (`driver().highlight`, `showButtons: ["close"]`, "show me" links that highlight the named
  element with its own one-line popover); `Beacons()` mounting driver.js hints for the three
  targets present on the page, dismissed into `KEYS.guide.dismissed`.
- Each card's header gets `<HintButton card="…">` after its title; `scripts/screens/shoot.mjs`
  gains `--guide tour:<n>|hint:<card>` to open the tour at step n or a hint card before the shot.
- Flip `src/guide/targets.test.ts` to plain `it`.

**Acceptance:** targets pin green; screenshots of each hint card and each beacon at 1200 and 390
px in both schemes, nothing overflowing; the lean plan's cards render identically except the `?`
and the attributes (react-dom/server diff); print shows no `?` (the button is `no-print`).

Owns: `src/components/ItemsCard.tsx`, `IngredientsCard.tsx`, `DivisionCard.tsx`,
`TimelineCard.tsx`, `DoughsCard.tsx`, `src/guide/hints.tsx`, `src/guide/targets.test.ts`,
`src/guide/copy.ts` (wording only), `scripts/screens/shoot.mjs`. Size **M**. Depends: G1.

### C2 · Sync client, account menu, footer, backup card, wiring

**Goal:** signed in, the planner follows the person; signed out, it is today's app; the page says
which it is, and the tour runs.

- `src/sync/useSync.ts`: decision 46; one `fetch` wrapper with `credentials: "same-origin"` and
  the JSON content type; the status state machine (`local`, `synced`, `syncing`, `offline`,
  `signin`), merge via `mergeBundles`, `describeMerge` for the one-off notice.
- `App.tsx`: `syncMeta` state persisted under `KEYS.sync`; `touch(section)` on every setter
  (`setPresets` … `setUi`); `useSync({ presets, doughs, bulkTable, savedPlans, plan, ui, syncMeta,
apply })` where `apply` sets all six from a merged bundle; `firstRun()` on mount of the plan
  page; `<AccountMenu>` in the nav; `<GuideButton>` in the footer props.
- `AccountMenu.tsx`: "Sign in" (a link to `/auth/login`) when `enabled && !user`; name, status dot
  and "Sign out" (a `POST` form to `/auth/logout`) when signed in; nothing when `enabled` is false.
- `PresetsPage.tsx`: the Backup card's status line and merge notice; `data-guide="backup"`; export
  and import unchanged (an import stamps every section now and syncs like any change).
- `Footer.tsx`: the privacy paragraph by mode: local-only text as today; with accounts: "Signed
  in, your presets, doughs and plans are stored on this server under your account so every device
  sees them. Nothing else is collected. Signed out, everything stays in this browser."; "Show me
  around" button.
- `README.md`: "Persistence" (local-only vs signed-in, bundle v3), "Privacy" (both modes),
  "Running it" (the §3 table, the Authentik notes, the `/data` mount).

**Acceptance:** with the fake issuer running locally (`node server/index.mjs` with a dev config
pointing at `fake-issuer.mjs` on another port): sign in, edit a dough, reload in a second
browser profile signed in as the same user and see it; edit on both and see the newest section win
with the notice; go offline (block the port) and see "Offline, changes kept", then recover; sign
out and see local-only text; accounts off: a page load makes one request beyond the files, `GET
/api/me`, answered `{ enabled: false }` with `cache-control: max-age=3600`, and the privacy text
says so ("asks the server once whether accounts are on").
The tour runs on first load and from the footer; `npm run build` and the gate green.

Owns: `src/sync/` (new), `src/App.tsx`, `src/components/AccountMenu.tsx` (new), `src/components/PresetsPage.tsx`,
`src/components/Footer.tsx`, `src/styles.css` (the nav menu and status dot only), `README.md`.
Size **L**. Depends: P2, P3, C1, G1, G2. Runs alone (`App.tsx` and `styles.css`).

### D1 · Deployment plan, docs, end to end

**Goal:** Ben can execute a deployment plan that matches the app, and the next person can run
accounts locally.

- Run `/jarvis-homelab-app briefing` in this repo (it writes the contract doc here: name it
  `docs/deployment.md`, neutral wording, no private hostnames beyond the public one) and
  `/jarvis-homelab-app plan` (one file in homelab-k8s): PVC at `/data`, sealed secret, ConfigMap,
  Authentik provider and application steps, NetworkPolicy egress to the issuer, the image pin,
  rollback (set `OIDC_ISSUER` empty = accounts off, data kept).
- `ORCHESTRATION.md`: "Accounts locally" (the fake issuer command, the env, the two-profile check)
  and the migration rule (decision 41).
- End to end on the final tree: the C2 acceptance walk again against a production build served by
  `server/index.mjs` with `DATA_DIR` on a temp dir and the fake issuer; screenshots via the
  harness of the account menu, the Backup card in every status, the tour steps, the hint cards
  and the beacons, both widths and schemes; the print check on the busy plan (nothing from the
  guide prints).

**Acceptance:** the deployment plan has no open questions the app's source can answer; the
end-to-end walk is recorded with screenshot paths; the gate green; `grep -rn "cdn\|googleapis"
dist/` empty.

Owns: `docs/deployment.md` (new), `ORCHESTRATION.md`, the plan file in homelab-k8s (via the
skill). Size **S**. Depends: C2.

---

## 7. The red pins

Two, both written in wave 1 and seen red against the current commit:

- `server/state.test.mjs` (P1): the state round trip and the 401, failing on 404. P3 flips it.
- `src/guide/targets.test.ts` (G1): every `data-guide` target in `copy.ts` renders, failing on the
  first missing attribute. G2 flips it (C2 adds the last two targets and the test's "wave 3" list
  empties).

The plan is complete when `grep -c "it.fails" server/*.test.mjs src/**/*.test.ts` is 0 everywhere,
the gate is green, and D1's end-to-end walk shows two browser profiles agreeing after a merge.

---

## 8. Wave table

| Wave | Packages     | Notes                                                                                                                                                      |
| ---- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | P1 + C1 + G1 | disjoint: `server/*` + `Dockerfile` vs `src/lib/storage.ts`, `sync.ts` vs `src/guide/*`, `package.json`+lock. P1's stubs make `index.mjs` a one-owner file |
| 2    | P2 + P3 + G2 | disjoint: `auth.mjs`, `fake-issuer.mjs`, `.dockerignore` vs `state.mjs` vs the five cards, `hints.tsx`, `copy.ts` wording, `shoot.mjs`                     |
| 3    | C2           | alone: `App.tsx` and `styles.css` are choke points; it also touches `PresetsPage`, `Footer`, README                                                        |
| 4    | D1           | alone: docs, the deployment plan through the skill, the end-to-end walk                                                                                    |

Checked against the `Owns` lists: no file appears twice in a wave. Standing rules:

- `server/index.mjs` is P1's in wave 1 and frozen after; routes live in their modules.
- `package.json` and the lock are G1's in wave 1 and frozen after (both dependencies land there).
- The lib is frozen except C1's two files; a package that wants a lib change reports it.
- Every UI package screenshots its surfaces with the harness before its final gate; P-packages
  prove behaviour over HTTP with vitest.
- The fake issuer is the only issuer any test or local walk uses; nobody points a test at Authentik.

Rough total: four waves, eight packages.

---

## 9. Regression to fear

**What must not move:** every number, step id, lane key and saved override; the §5.5 reference
bake; today's behaviour with accounts off, byte for byte in storage (`sourdough.v1.*` keys and
values unchanged except the new `sync` and `guide` keys); the export of a version-2 bundle still
importing; print; the image's read-only root.

**What could silently break:** a push that writes the server's document with a stale version and
wins because the client ignored a 409 (the merge test and the two-profile walk are the check); a
session cookie without `Secure` on https (`readConfig` derives it from `APP_URL`; test it); the
`/readyz` probe passing while the database is unopenable (P1 tests it); the first-run tour
starting inside kitchen mode or on the Presets page (G1's `firstRun` checks the view); the tour's
dim overlay trapping focus for keyboard users (driver.js handles Escape; test it in the walk).

**Hunt for the assumption rather than assuming its absence.** The assumption is "there is one
browser": `loadAll()` at module load, `usePersisted` writing without a timestamp, the Backup card's
import replacing everything, the footer's sentence. Each package greps its files for `localStorage`,
`KEYS.` and "browser" and reports each site as changed or deliberately kept.

**What the fixtures avoid.** The fake issuer always answers; real issuers time out, rotate keys and
return `error=access_denied`. The merge fixtures change one section at a time; a real second device
changes three in one minute. The tour fixtures are the busy plan; a brand-new user's plan page is
the lean default with three items. The awkward shapes a package must build: an issuer that is down
at login and at token exchange; a JWKS rotation between discovery and callback (`openid-client`
refetches: test it); a 1 MiB bundle; two devices with clocks ten minutes apart (timestamps are
device clocks: the merge must still be deterministic, and the status line says "newer" by those
clocks); a first-run tour on a lean plan where the split target is absent (skipped, not an error).

---

## 10. Settled with Ben (2026-10-12)

1. Plain OIDC with Authentik first, not a vendor SDK. Yes.
2. A database from the start because sharing is coming: SQLite through Node's built-in driver,
   behind a store interface; the cluster's shared Postgres is the named alternative if the
   deployment prefers it (decision 40). Confirm at D1 when the deployment plan is written.
3. Newest wins, per section. Recommended and not objected to; recorded as decision 45.
4. Two dependencies: `openid-client` on the server, `driver.js` on the client. Yes (Ben chose
   driver.js; the server one follows the same rule: it earns its keep).
5. Guidance is driver.js only; hand-drawn annotations are out. Yes, after the mock.

---

## 11. Verification gate

`ORCHESTRATION.md` is the gate: format, lint, typecheck, test (server tests included), build; the
harness for anything restyled; the print check for anything printed. One commit per package.
Nothing is pushed until Ben has looked at it locally with the fake issuer. Commit this plan to the
repo root before wave 1 starts.

---

## 12. Close-out (2026-10-13)

All eight packages landed on `main`, unpushed. Decisions end at 52; the next plan starts at 53.

| Package | Commits                                                                                   |
| ------- | ----------------------------------------------------------------------------------------- |
| C1      | `3bf9341` bundle v3 and the merge                                                         |
| P1      | `56ae878` store, migrations, router; the state pin red                                    |
| G1      | `5aedfec` driver.js, the tour, the copy, the targets pin; `8929a39` engines `>=22.13`     |
| P3      | `c2699af` the state API; the state pin green                                              |
| P2      | `56aae22` OIDC login, logout, `/api/me`, the fake issuer                                  |
| G2      | `8ef6ecd` hint cards, beacons, the `data-guide` targets; the guide pin green              |
| C2      | `708ec1a` sync client, account menu, privacy by mode, the tour mounted; `5631e94` README  |
| D1      | `b9fa2d9` F1, `905f125` F2, `8c273ac` ORCHESTRATION, `7e8efdc` `docs/deployment.md`, this |

**Scope change (Ben, 2026-10-12):** the homelab-k8s deployment plan (decision 52, D1's second
half) was skipped. D1 wrote only the app-side briefing, `docs/deployment.md`; the cluster plan is
for when Ben asks for it. SQLite on a PVC is confirmed (decision 40 and §10.2); `server/store.mjs`
stays the Postgres seam.

**Plan drift accepted** (the source is right, the plan text above is not):

- `openid-client` never fetches the JWKS in the code flow: the ID token is trusted on the token
  endpoint's TLS (OIDC Core 3.1.3.7), so a plain-http issuer is refused off loopback, and the
  server's egress is discovery and the token endpoint only (§3, §5, decision 38).
- driver.js 1.3.1 has no hints API and no `skipMissingElement`: beacons are self-rendered in
  `src/guide/hints.tsx` (a portal over the page), and the tour filters out steps whose target is
  absent (decisions 47, 49; G1's config list).
- driver.js sits in `devDependencies`: Vite bundles it, and the image runs `npm ci --omit=dev`
  (decision 47 said "dependency").
- `ui` (the settings) joined the bundle in version 3, the sixth section (decision 44).
- `OIDC_ISSUER=""` (set but empty) means accounts off whatever else is set: the documented
  rollback that keeps the data (§3's all-or-nothing rule).
- The 1 MiB limit is on the whole `PUT` body, envelope included (decision 43).
- An import stamps every section it carries with the import time; a section a file lacks gets
  none (decision 44 said "older files get every timestamp set to the import moment").
- `readJson` answers 415 to a write without `Content-Type: application/json` (decision 43 named
  only 400, 401, 409 and 413).
- `readBundle(value, null)` leaves missing change times absent (F2); `readRemote` uses it.

**Follow-ups not done** (each small; none blocks a push):

1. Move the login-cookie sign and verify (`sealLogin`, `openLogin`) from `server/auth.mjs` into
   `server/session.mjs` beside `signSessionId`.
2. Move the plain-http-off-loopback check (`loopbackOnly`) from `authRoutes` into `readConfig`
   (`server/index.mjs`, `readAccounts`), so the refusal is a config error like the others.
3. Two accounts signing in on one browser: the first account's local edits merge into the
   second's document (the browser's storage is shared between them).
4. The Items card's header sub-line wraps under the title at 1200 px on the lean plan since the
   `?` arrived (+30 px); a shorter sub-line in `ItemsCard` fixes it if Ben minds.
5. A second CI smoke step with accounts on: all six variables, a tmpfs at `/data`, the fake
   issuer; today CI smoke-starts the image accounts off only (`docs/deployment.md` §14).

**End-to-end evidence** (D1, on `7e8efdc`, a production build served by `node server/index.mjs`
with `DATA_DIR` on a temp dir and the fake issuer; scratch paths, not kept):

- The two-device walk, Firefox then Chrome, every step passing (sign in, a dough edited on A seen
  on B, different sections merged with the notice, the same section's later save winning whole,
  `kill -9` offline and recovery, sign out, `FAKE_ISSUER_DENY=1`): `/private/tmp/claude-501/-Users-benralton-repos-BEN-WORKING-sourdough-planner/9b84a2e8-4ff0-4117-8ed3-323d014b67ca/scratchpad/e2e/firefox/`,
  `/private/tmp/claude-501/-Users-benralton-repos-BEN-WORKING-sourdough-planner/9b84a2e8-4ff0-4117-8ed3-323d014b67ca/scratchpad/e2e/chrome/` (`walk.log` and `w00`–`w12`).
- F1: tour closed by Escape inside the animation, reload, no tour, both browsers:
  `f1-reload-no-tour.png` in the same folders.
- Account menu signed out, signed in, open, offline, "Sign in again", the tour's account step and
  the Backup card in all four statuses, at 1200 and 390, light and dark, both browsers:
  `/private/tmp/claude-501/-Users-benralton-repos-BEN-WORKING-sourdough-planner/9b84a2e8-4ff0-4117-8ed3-323d014b67ca/scratchpad/e2e/account-firefox/`, `/private/tmp/claude-501/-Users-benralton-repos-BEN-WORKING-sourdough-planner/9b84a2e8-4ff0-4117-8ed3-323d014b67ca/scratchpad/e2e/account-chrome/`.
- Tour steps 1 and 4 (step 5, the account step, needs accounts on: `l04-*` above), every hint
  card, the first "show me", each beacon and the page of beacons, at 1200 and 390, light and dark:
  `/private/tmp/claude-501/-Users-benralton-repos-BEN-WORKING-sourdough-planner/9b84a2e8-4ff0-4117-8ed3-323d014b67ca/scratchpad/e2e/guide-chrome/`, `/private/tmp/claude-501/-Users-benralton-repos-BEN-WORKING-sourdough-planner/9b84a2e8-4ff0-4117-8ed3-323d014b67ca/scratchpad/e2e/guide-firefox/`; every popover inside the screen, 0 px overflow.
- `npm run screens:print -- --both --png`: every state, both browsers, exit 0, nothing split:
  `/private/tmp/claude-501/-Users-benralton-repos-BEN-WORKING-sourdough-planner/9b84a2e8-4ff0-4117-8ed3-323d014b67ca/scratchpad/e2e/print/`; signed in on the busy plan with two beacons showing, and again with the tour
  open, printed in both browsers: no menu, `?`, beacon or popover on any page
  (`signed-in-busy*-p*.png`).
- `grep -rn "cdn\|googleapis" dist/` empty; `it.fails` 0 in every test file; accounts off,
  `GET /api/me` is `{"enabled":false}` with `cache-control: max-age=3600`.
