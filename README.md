# Sourdough Planner

A small single-user web app that plans a bake: one bulk batch of sourdough split into several
bakes (rolls, loaves, pizza bases, whatever you keep as presets), and any other doughs made
alongside it, such as a loaf with cheese worked into a portion of the batch, or burger buns from
an egg-and-milk dough mixed on its own. It answers two questions:

1. **What goes into each mix?** Flour, water, starter and salt, using _true_ hydration (the
   water and flour inside the starter are counted), and each dough's butter, egg, milk and
   add-ins.
2. **How do I divide it?** Weight per piece for each item, plus a clock-time schedule from
   mixing to baking with a track per dough and a lane per item.

Built for a phone or tablet on the kitchen counter: big numbers, numeric keypads, a
read-only kitchen mode that keeps the screen awake, dark mode, and a print layout (A4, the
timeline on its own page, no step or lane split across pages).

## Modes

- **From starter.** You have _S_ grams of starter; the app sizes the batch and spreads the
  usable dough across your items. Presets with a flex priority absorb the surplus or deficit,
  highest priority first, clamped to their min and max. Anything left over is reported as
  spare or short with a suggestion.
- **From items.** You want these items; the app sizes the batch and tells you how much
  starter to have ready. Give it the starter you have and it warns if that is short, with the
  inoculation that would fit.

Switching modes keeps the items and settings.

Every item line is made from a dough: the one the line picks, else its preset's, else the main
dough, which is the Batch settings. Both modes plan every dough in the plan at once, from one
starter shared between them; see [Doughs and variations](#doughs-and-variations).

## The maths

All percentages are of **total flour**, which includes the flour in the starter. For the main
dough:

```
starterFlour = S / (1 + h_s)         addedFlour = S / i
starterWater = S − starterFlour      totalFlour = addedFlour + starterFlour
totalWater   = H × totalFlour        addedWater = totalWater − starterWater
salt         = s × totalFlour        totalDough = addedFlour + addedWater + S + salt
usableDough  = totalDough × (1 − L)
```

Items mode inverts it: `totalFlour = totalDough / (1 + H + s)` and
`addedFlour = totalFlour / (1 + i / (1 + h_s))`, then `S = i × addedFlour`.

The reference bake from the spec is a unit test: 250 g starter at 100 %, 25 % inoculation,
75 % hydration, 2 % salt gives 1000 g flour, 718.75 g water, 22.5 g salt, 1991 g dough, and
two pizzas, four rolls and two loaves of about 606 g (with the 70 g rolls the app had then).
The inverse returns 250 g starter.

### More than one dough

Everything runs in flour. Each dough has a factor _k_, the grams of dough one gram of its flour
makes: `1 + H + s` for the main dough, plus each enrichment, add-in and soaker as a fraction of
flour. A dough mixed separately counts an enrichment less the water it carries (milk is 88 %
water, egg 76 %, butter 16 %), because that water comes off its water line; a dough split from
the main one counts it whole, since the dough it is cut from is already mixed. A piece of _w_
grams needs `w / (k × (1 − L))` grams of flour, or `w / (k_dough × (1 − L))` with the add-ins
tick box off, where `k_dough` leaves the add-ins out.

From starter, the starter fixes the batch's flour, `S / i + S / (1 + h_s)`, and the flex items
share whatever flour the others leave, highest priority first, as before; spare or short is
reported in grams of main dough. From items, the flour is the sum of what the lines need and the
starter follows from it as above. Either way an all-lean plan gets the batch it always did.

Each dough then takes its share: starter in proportion to its flour (inoculation and starter
hydration are plan-wide), water to its hydration less what its starter, milk, egg and butter
already hold, salt at its rate, and each add-in as a fraction of its flour. When the liquids
alone pass the target, the water line is 0 and a warning gives the hydration they make.

The main dough and the doughs split from it are one mix: you weigh and mix it once and take the
split portions out later. A dough mixed separately is a mix of its own, with its own table.

**Worked example A** (a unit test). From starter, 250 g, at the reference settings with no
bench loss. Items: a plain loaf that flexes between 400 and 1000 g, and a loaf pinned at 600 g
on Jalapeño cheddar (mature cheddar 25 %, jalapeño 8 %, split off at fold 1).

- The batch holds 1125 g of flour: 1000 g added and 125 g in the starter.
- Jalapeño cheddar makes `k = 1 + 0.75 + 0.02 + 0.25 + 0.08 = 2.10` g of loaf per gram of
  flour, so the 600 g loaf needs 285.714 g of flour: a 505.714 g portion of main dough
  (285.714 × 1.77) with 71.429 g of cheddar and 22.857 g of jalapeño worked in.
- The plain loaf could take the other 839.286 g of flour, 1485.5 g of dough. It stops at its
  1000 g maximum, and 485.5 g of main dough is spare.
- It is still one mix, the reference batch: 1000 g flour, 718.75 g water, 250 g starter, 22.5 g
  salt. At fold 1 the timeline says "Take 506 g of dough for Jalapeño cheddar. Work in 71 g
  mature cheddar, 23 g jalapeño (fresh, diced)." The division card shows the loaf at 600 g:
  506 g dough + 94 g add-ins.

With the add-ins tick box off, the 600 g is plain dough: the portion is 600 g, the finished loaf
712 g, and 391.25 g of main dough is spare.

Everything in `src/lib` is a pure function with no rounding; rounding happens at display
time, and a check row under each mix confirms its displayed lines, add-ins included, add up to
its displayed total.

## Timeline

Mix, bulk ferment (with stretch-and-folds), divide, bench rest, then one lane per item:
shape, proof (room or cold retard with an earliest/latest bake window), bake. Every duration
is editable and edits cascade. Optional steps: feed the starter first (with a feed helper
sized to the starter the whole plan needs), autolyse.

Folds sit in the first 30-minute slots of bulk, because handling belongs early and the dough
should be left alone at the end. Hand-mixed dough defaults to four sets; ticking **Stand
mixer** changes the mix step to a dough-hook routine and drops the default to one early set,
since the mixer builds the gluten up front and most bakers then do zero or one set. The count
is editable either way (0–12), and the folds always stay at 30, 60, 90 … minutes into bulk.

The bulk estimate comes from an editable table keyed on dough temperature, scaled for
inoculation outside 20–25 %. It is a guide; the UI says so. The target is a 50–75 % rise,
domed and jiggly, not the clock. Overlapping bakes produce an oven-clash warning with a
suggested order.

With more than one dough the common steps come first (any tangzhong, the feed, the autolyse,
the main mix), then a track per dough. A split dough leaves the main dough's bulk at fold 1
(30 minutes in), fold 2 (60 minutes) or the end of the mix, whatever the fold count, and is
divided when its own bulk ends. A dough mixed separately mixes after the one before it and has
its own bulk, folds, divide and bench rest. Each lane starts from its own dough's bench rest. An
all-lean plan's timeline is what it always was, step for step.

## Doughs and variations

Doughs live on the Presets page, in a Doughs card between the presets and the backup. Five come
seeded, all without sugar: Soft bun dough (milk, egg, butter), Soft sandwich dough (milk,
butter), Buttered (8 % butter), Jalapeño cheddar and Seeded. Add, edit, reorder, delete or reset
them as you would presets. The main dough is not in the list: it is the Batch settings. A
preset can name a dough (the dinner roll, burger bun and hot dog bun use Soft bun dough), any
item line can pick another, and one preset can sit on several doughs in the same plan. A
dough's notes, "What you did and how it went", print under its mix, and the plan's Notes card
(this bake) prints whenever something is written in it.

**Split or separate.** Butter and add-ins can be worked into a portion of dough that is already
mixed, so a dough with only those is _split_: one mix, and at fold 1, fold 2 or the end of the
mix you take its portion out and work them in. Egg, milk and sugar cannot: no source adds them
after the gluten is built, and their water has to be in from the start. A dough with egg, yolk
or milk, sugar above 5 % (or a bulk sweetener's equivalent), a tangzhong, or a hydration or salt
of its own is _mixed separately_, after the main mix. A dough's method is "auto" unless you set
one; a split forced on a dough with egg or milk still computes, with a warning. Each dough's
heading says why it is mixed the way it is.

**What counts as water.** Hydration is true hydration: the water in the starter, milk (88 %),
egg (76 %), yolk (52 %), butter (16 %) and honey (17 %) all count, and the water line is what
is left to add. Add-ins and the water they soak in do not count, which is how bakers record
them. A split dough keeps the main dough's hydration and salt (neither can change after
mixing), so its butter makes it a little wetter: 76.3 % for Buttered at 75 %.

**Add-ins and piece weights.** Whenever an item is on a dough with add-ins, a tick box under the
items says whether "Planned weights include add-ins". Ticked, the default, a 600 g jalapeño loaf
is 600 g finished with 506 g of dough in it. Unticked, it is 600 g of dough with the add-ins on
top, 712 g in all. Enrichments, sweetness and a tangzhong are the dough itself and sit inside
the weight either way.

**Tangzhong.** A dough mixed separately can have a tangzhong: some of its flour (5 % by default)
cooked with five times its weight of liquid to 65 °C. The planner takes that flour and liquid
out of the mix's own lines (milk when the milk covers it, else water), so the totals do not
move. The ingredients card shows a "Tangzhong — make first" block, and the timeline opens with
a tangzhong step: 45 minutes to cool, or 15 when a feed or an autolyse follows and it cools
during them.

**Bulk.** Each dough's bulk is the main dough's estimate times a factor: 1, plus 0.05 for each
point of sugar above 3 % (a bulk sweetener by its sugar-equivalent), plus 0.1 when butter and
oil together reach 20 %, kept between 1 and 2. It is a heuristic and the timeline says so; each
dough can set its own. The dough is the target, not the clock.

**Sweetness.** No sugar is the default: the culture lives on flour, colour comes from the milk
and the wash, softness from butter, egg, milk and a tangzhong. Each dough can choose none, sugar
(sugar, honey or a syrup) or a sweetener (xylitol, erythritol, maltitol, or a high-intensity one
such as stevia). A bulk sweetener counts as its sugar-equivalent for the bulk, and the editor
says what each cannot do. Allulose is not offered: it is not authorised for sale in the UK or
the EU.

**Bake.** A dough can set its own oven temperature, steam and wash (the soft doughs bake at
190 °C without steam), and that wins over the preset's; the bake times stay the preset's.

The research behind these choices, with its sources, is in
[`docs/dough-variations-research.md`](docs/dough-variations-research.md).

## Persistence

The app renders from the browser's localStorage, under `sourdough.v1.`: `presets`, `doughs`,
`plan` (the current one), `bulkTable`, `savedPlans` and `ui` (the half-gram-salt preference),
and `seeded`, the default preset and dough ids this browser has already been given. That record
is what lets a new default reach an existing browser once while a default you deleted stays
deleted. An old default you never edited (the 70 g roll) is brought up to date in place; edits,
order and your own presets and doughs are left alone. Saved plans refer to presets and doughs by
id, so editing a dough changes every plan that uses it. Two more keys sit beside them: `sync`,
when each of the six sections last changed in this browser and the server version it last saw,
and `guide`, whether the walkthrough has run and which tips were dismissed. The Timeline card's
In order / By dough choice (`sourdough.v1.timelineView`) stays per browser and never syncs: one
device may want the list and another the tracks.

**Local only** (accounts off, or signed out): that is all there is. The Presets page has JSON
export and import to move between devices or back up.

**Signed in**: the same six sections also live on the server as one document per account, so
every device you sign in on has them. localStorage is still what the app reads, so it works
offline. On load (and when the tab comes back after a while) it pulls the account's copy and
merges it section by section: whichever side changed a section more recently wins it whole, by
the clocks of the devices that made the changes. Nothing is merged inside a section, so a plan
edited on two devices within the same minute takes the later save. Each change is pushed 1.5 s
after the last edit; if another device saved in between, the server refuses the stale push, and
the app merges the server's copy in and pushes the merge, never its own stale copy. Offline,
changes stay in the browser and are retried after 5 s, 30 s, 2 min, then every 5 min. The
Backup card says which state it is in ("Signed in as …, synced 21:14.", "Offline, changes kept;
will sync when back.", "Sign in again to keep syncing.") and, after a merge that moved something,
what came from where.

An export is version 3: the five sections of version 2 plus the settings (`ui`) and when each
section last changed. Versions 1 (before doughs) and 2 still import; a version-1 file gets the
default doughs and its presets brought up to date. An import replaces what it carries and counts
as a change made now, so signed in it then reaches your other devices.

## Privacy

**Accounts off** (the default, and the public instance unless it says otherwise): nothing a
visitor enters leaves their browser. The page makes one request beyond its own files, `GET
/api/me`, to ask whether accounts are on (cached for an hour); the answer carries nothing about
the visitor. No cookies, no analytics, and the server keeps no state.

**Accounts on, signed out**: the same, plus the sign-in link. **Signed in**: the server keeps,
per account, the issuer and subject that identify you to your sign-in service, the email and
name it gives (both optional), when the account was created and last seen, your sessions (an id,
created, expires, last seen), and one document: your presets, doughs, bulk table, saved plans,
current plan and settings, with when each last changed. One cookie, `sdp_session` (HttpOnly,
SameSite=Lax, Secure on https, 30 days sliding), holds the session id; a short-lived
`sdp_login` cookie carries the sign-in in progress. ID and access tokens are used once at sign-in
and never stored or sent to the browser. Nothing else is collected.

The public instance sits behind Cloudflare, which sees visitor IP addresses as any web host
does. The footer says the same in-app, in whichever mode it is in.

## Development

```
npm ci
npm run dev        # vite on :5173
npm test           # vitest: the src/lib maths, storage, sync logic and the server
npm run lint && npm run typecheck && npm run format
npm run build && npm start   # serve dist/ from the production server on :8080
```

## Running it

The image builds the SPA and serves it from `server/index.mjs`, a small Node server whose only
dependency is `openid-client`, used when accounts are on. It runs as uid 1000 with a read-only
root filesystem and no capabilities, and needs no writable `$HOME`. With accounts off it writes
nothing to disk; with accounts on it writes one SQLite file, `$DATA_DIR/planner.sqlite` (Node's
built-in `node:sqlite`, WAL mode), so mount a volume there (`/data` in a cluster, with
`DATA_DIR=/data`).

| Variable       | Default                  | Purpose                                                                                     |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `PORT`         | `8080`                   | Listen port. Must be an integer 1–65535; the process exits 1 naming the variable otherwise. |
| `HOST`         | `0.0.0.0`                | Bind address.                                                                               |
| `APP_VERSION`  | `dev`                    | Reported by `/healthz` and `/readyz`. Set it to the image tag.                              |
| `STATIC_DIR`   | `/app/dist` in the image | Where the built bundle is.                                                                  |
| `LOG_REQUESTS` | unset                    | Exactly `"true"` logs one JSON line per request.                                            |

None of those are secret or required. Accounts take six more, **all or none**:

| Variable             | Default | Purpose                                                                                    |
| -------------------- | ------- | ------------------------------------------------------------------------------------------ |
| `DATA_DIR`           | unset   | Directory for `planner.sqlite`. Must be writable.                                          |
| `APP_URL`            | unset   | The public origin, e.g. `https://sourdough.example.com`; https makes the cookie Secure.    |
| `OIDC_ISSUER`        | unset   | The issuer's discovery base (Authentik: `https://auth.example.com/application/o/<slug>/`). |
| `OIDC_CLIENT_ID`     | unset   | The OAuth2 client (confidential; PKCE is used as well).                                    |
| `OIDC_CLIENT_SECRET` | unset   | Its secret.                                                                                |
| `SESSION_SECRET`     | unset   | At least 32 bytes; signs the session cookie.                                               |
| `SESSION_DAYS`       | `30`    | Sliding session lifetime, a positive integer.                                              |

Set none of the six and accounts are off: today's local-only app, no database opened. Set some
but not all and the process exits naming the missing ones; there is no half-configured mode. To
switch accounts off without unsetting the rest, set `OIDC_ISSUER=""`: the data stays where it
is for when you turn them back on. The issuer must be https; plain http is accepted only on
`localhost` or `127.0.0.1` (for local testing), anywhere else the process refuses to start. At
the issuer, register `<APP_URL>/auth/callback` as the redirect URI and `<APP_URL>/` as the
post-logout redirect, with the scopes `openid profile email`.

| Path                 | Meaning                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /healthz`       | Liveness. `200 {"status":"ok","version":…}` whenever the process answers.                                   |
| `GET /readyz`        | Readiness. `200` once `index.html` is readable and, with accounts on, the database opened; `503` otherwise. |
| `GET /api/me`        | `{ enabled: false }` (cached an hour), or `{ enabled: true }` with `user: { name, email }` when signed in.  |
| `GET /auth/login`    | Accounts on: starts the sign-in (redirect to the issuer). `/auth/callback` finishes it.                     |
| `POST /auth/logout`  | Ends the session, then the issuer's end-session page when it has one.                                       |
| `GET/PUT /api/state` | The signed-in account's document, with a version; a stale `PUT` gets `409` and the current copy.            |
| `GET /assets/*`      | Hashed bundle files, `Cache-Control: public, max-age=31536000, immutable`.                                  |
| anything else        | SPA fallback to `index.html`, `no-cache`. Only `GET` and `HEAD`; others get `405`.                          |

Neither health endpoint requires auth.

### Accounts locally

A fake OIDC issuer for testing ships in the repo (not in the image). In one terminal:

```
node server/fake-issuer.mjs        # on 127.0.0.1:9400; FAKE_ISSUER_DENY=1 makes it refuse
```

It prints the environment to start the app against it. In another, after `npm run build`:

```
DATA_DIR=/tmp/sdp-local-data APP_URL=http://127.0.0.1:8080 \
  OIDC_ISSUER=http://127.0.0.1:9400/application/o/sdp/ \
  OIDC_CLIENT_ID=sdp-local OIDC_CLIENT_SECRET=sdp-local-secret \
  SESSION_SECRET=insecure-local-only-session-secret-0123456789 \
  node server/index.mjs
```

Open `http://127.0.0.1:8080`, not `localhost`: the cookie belongs to `APP_URL`'s host. Every
sign-in is the same user, "Test Baker", so two browser profiles (or a normal and a private
window) signed in are two devices of one person.

### Network

- **Inbound:** TCP `PORT` (8080) from the ingress. Plain HTTP; TLS terminates upstream.
- **Outbound:** none with accounts off. With accounts on, the server reaches `OIDC_ISSUER`
  (discovery, the token endpoint) and nothing else. No APIs, no fonts, no CDN, no telemetry, no
  update checks; the bundle is self-contained. The footer links to GitHub and Ko-fi are plain
  anchors the visitor chooses to follow; the app never requests either.
- No WebSockets. Redirect URLs are built from `APP_URL`, so `X-Forwarded-Proto` is not
  consulted. Cookies only with accounts on (see [Privacy](#privacy)). Served from the domain root
  with root-relative asset URLs.

### Image

CI builds `linux/amd64` and `linux/arm64` natively and pushes a manifest list to
`ghcr.io/ralton-dev/sourdough-planner` tagged `sha-<full commit sha>` and `latest` on every
push to `main`. The tag appears in the job summary of the _Multi-arch manifest_ job.

Run it wherever a container runs: pin the `sha-` tag, set `APP_VERSION` to match, and point
the liveness and readiness probes at `/healthz` and `/readyz`.
