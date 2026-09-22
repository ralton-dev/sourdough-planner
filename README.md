# Sourdough Planner

A small single-user web app that plans one bulk batch of sourdough and splits it into several
bakes: rolls, loaves, pizza bases, whatever you keep as presets. It answers two questions:

1. **What goes into the batch?** Flour, water, starter and salt, using _true_ hydration (the
   water and flour inside the starter are counted).
2. **How do I divide it?** Weight per piece for each item, plus a clock-time schedule from
   mixing to baking with a lane per item.

Built for a phone or tablet on the kitchen counter: big numbers, numeric keypads, a
read-only kitchen mode that keeps the screen awake, dark mode, and a two-page print layout.

## Modes

- **From starter.** You have _S_ grams of starter; the app sizes the batch and spreads the
  usable dough across your items. Presets with a flex priority absorb the surplus or deficit,
  highest priority first, clamped to their min and max. Anything left over is reported as
  spare or short with a suggestion.
- **From items.** You want these items; the app sizes the batch and tells you how much
  starter to have ready. Give it the starter you have and it warns if that is short, with the
  inoculation that would fit.

Switching modes keeps the items and settings.

## The maths

All percentages are of **total flour**, which includes the flour in the starter.

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
two pizzas, four rolls and two loaves of about 606 g. The inverse returns 250 g starter.

Everything in `src/lib` is a pure function with no rounding; rounding happens at display
time, and a check row confirms the displayed ingredients add up to the displayed total.

## Timeline

Mix, bulk ferment (with four stretch-and-folds), divide, bench rest, then one lane per item:
shape, proof (room or cold retard with an earliest/latest bake window), bake. Every duration
is editable and edits cascade. Optional steps: feed the starter first (with a feed helper),
autolyse.

The bulk estimate comes from an editable table keyed on dough temperature, scaled for
inoculation outside 20–25 %. It is a guide; the UI says so. The target is a 50–75 % rise,
domed and jiggly, not the clock. Overlapping bakes produce an oven-clash warning with a
suggested order.

## Persistence

Everything lives in the browser's localStorage: presets, the bulk table, the current plan,
saved plans and the half-gram-salt preference. The Presets page has JSON export and import
to move between devices or back up. There is no server-side state.

## Development

```
npm ci
npm run dev        # vite on :5173
npm test           # vitest: calc, timeline, storage and server tests
npm run lint && npm run typecheck && npm run format
npm run build && npm start   # serve dist/ from the production server on :8080
```

## Running it

The image builds the SPA and serves it from `server/index.mjs`, a dependency-free Node
static server. It runs as uid 1000 with a read-only root filesystem and no capabilities,
writes nothing to disk, and needs no writable `$HOME`.

| Variable       | Default                  | Purpose                                                                                     |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `PORT`         | `8080`                   | Listen port. Must be an integer 1–65535; the process exits 1 naming the variable otherwise. |
| `HOST`         | `0.0.0.0`                | Bind address.                                                                               |
| `APP_VERSION`  | `dev`                    | Reported by `/healthz` and `/readyz`. Set it to the image tag.                              |
| `STATIC_DIR`   | `/app/dist` in the image | Where the built bundle is.                                                                  |
| `LOG_REQUESTS` | unset                    | Exactly `"true"` logs one JSON line per request.                                            |

None are secret. None are required.

| Path            | Meaning                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `GET /healthz`  | Liveness. `200 {"status":"ok","version":…}` whenever the process answers.          |
| `GET /readyz`   | Readiness. `200` once `index.html` is readable from `STATIC_DIR`; `503` otherwise. |
| `GET /assets/*` | Hashed bundle files, `Cache-Control: public, max-age=31536000, immutable`.         |
| anything else   | SPA fallback to `index.html`, `no-cache`. Only `GET` and `HEAD`; others get `405`. |

Neither health endpoint requires auth.

### Network

- **Inbound:** TCP `PORT` (8080) from the ingress. Plain HTTP; TLS terminates upstream.
- **Outbound:** none. No APIs, no fonts, no CDN, no telemetry, no update checks. The bundle
  is self-contained and the server makes no outbound connections.
- No WebSockets. No absolute URLs are generated, so `X-Forwarded-Proto` is not consulted.
  No cookies are set. Served from the domain root with root-relative asset URLs.

### Image

CI builds `linux/amd64` and `linux/arm64` natively and pushes a manifest list to
`ghcr.io/ralton-dev/sourdough-planner` tagged `sha-<full commit sha>` and `latest` on every
push to `main`. The tag appears in the job summary of the _Multi-arch manifest_ job.

See `docs/homelab-deployment.md` for what the homelab cluster requires of this repo and how
each requirement is met.
