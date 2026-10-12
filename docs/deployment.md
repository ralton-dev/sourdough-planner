# Deployment contract

What a Kubernetes cluster needs to know to run this app, answered from the source. Written for the
homelab cluster (k3s, mixed arm64 and amd64 nodes, GitOps from a separate manifest repo, Argo CD,
Cloudflare Tunnel then Traefik in front, deny-by-default NetworkPolicies, Authentik as the
identity provider), but nothing here depends on that cluster: any container platform with a
volume and an OIDC issuer will do. The public instance is `https://sourdough.ralton.dev`.

The reader is whoever writes the manifests. Every claim names the file that makes it true; where
the source and this document disagree, the source wins and this document is stale.

Status, 2026-10-13: accounts (sign-in and sync, `PLAN-accounts.md`) are built and tested on
`main`. Until a manifest change turns them on, the deployed app runs exactly as it always has:
accounts off, no volume, no secrets, no egress.

---

## 1. What already meets the cluster's requirements

| Requirement                                            | Where it is met                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Multi-arch `linux/amd64` + `linux/arm64` image         | `.github/workflows/ci.yml`: each platform built natively and pushed by digest, merged into one manifest list         |
| Immutable `sha-<full sha>` tags plus `latest`          | `ci.yml` job _Multi-arch manifest_ (`docker/metadata-action`, `type=sha,format=long`); the tag is in the job summary |
| Registry                                               | `ghcr.io/ralton-dev/sourdough-planner`                                                                               |
| Self-hosted arm64 runner only on push to `main`        | `ci.yml` `runs-on` expression (pull requests use `ubuntu-24.04-arm`)                                                 |
| `/healthz` and `/readyz`, distinct, unauthenticated    | `server/index.mjs`; `/healthz` reports `APP_VERSION`                                                                 |
| uid 1000, read-only root, no capabilities, port > 1024 | `Dockerfile` (`USER 1000:1000`, `PORT=8080`); CI smoke-starts it `--read-only --user 1000:1000 --cap-drop ALL`       |
| No writable `$HOME` needed                             | the runtime runs `node server/index.mjs` only; nothing writes outside `DATA_DIR`                                     |
| Env-only config, fails loudly naming the variable      | `server/index.mjs` `readConfig`                                                                                      |
| Binds `0.0.0.0`; no surprise outbound calls            | `HOST` defaults to `0.0.0.0`; the bundle is self-contained (no CDN, fonts, analytics, update checks)                 |
| Root-relative assets, served from the domain root      | Vite's default `base: "/"`                                                                                           |

The CI smoke step starts the image with **accounts off** (no `DATA_DIR`, no OIDC variables), so it
proves the image's local-only mode and the read-only root, not the accounts path.

## 2. The image

- Base `node:22.23-alpine` in both stages (`Dockerfile`). The pin is deliberate: the server uses
  Node's built-in `node:sqlite` (unflagged from 22.13; `package.json` `engines` says `>=22.13`),
  whose API is still marked "active development". Bump it on purpose, not by floating.
- `NODE_OPTIONS=--no-warnings=ExperimentalWarning` is set in the image, because `node:sqlite`
  prints an ExperimentalWarning on every start in 22.x. Do not override `NODE_OPTIONS` in the
  manifest without keeping it.
- The runtime stage runs `npm ci --omit=dev`: its one dependency is `openid-client` (server-side
  OIDC). The SPA is prebuilt into `/app/dist`; `server/` is copied whole except the test files and
  the fake issuer (`.dockerignore`).
- `CMD ["node", "server/index.mjs"]`, uid/gid 1000, `EXPOSE 8080`.

## 3. Two modes, chosen by configuration

**Accounts off** (the default): a static file server with `/healthz`, `/readyz` and one route,
`GET /api/me` → `{ "enabled": false }` (cached an hour). No database is opened, nothing is
written to disk, no cookie is set, no outbound connection is made. This is what runs today.

**Accounts on**: the same, plus sign-in through an OIDC issuer, server-side sessions and one
synced document per user, kept in a SQLite file under `DATA_DIR`.

Accounts are on only when **all six** of `DATA_DIR`, `APP_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
`OIDC_CLIENT_SECRET` and `SESSION_SECRET` are set (`ACCOUNT_VARS` in `server/index.mjs`). Any
subset is a startup error that names the missing ones; there is no half-configured mode. One
exception, which is the rollback switch: **`OIDC_ISSUER=""` (set, but empty) means accounts off**
whatever else is set, so the rest of the config and the data stay in place for turning them back
on.

## 4. Configuration

Every setting is an environment variable. Booleans compare to the exact string `"true"`.

**ConfigMap** (not secret):

| Variable       | Value for the public instance                    | Notes                                                                                                   |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `APP_VERSION`  | the image tag, `sha-<full sha>`                  | reported by `/healthz` and `/readyz`                                                                    |
| `APP_URL`      | `https://sourdough.ralton.dev`                   | the public origin; redirect URIs are built from it, and `https` here makes the cookies `Secure`         |
| `OIDC_ISSUER`  | `https://<authentik-host>/application/o/<slug>/` | Authentik's per-application issuer, trailing slash included; must be https (below). `""` = accounts off |
| `DATA_DIR`     | `/data`                                          | the volume mount (section 5)                                                                            |
| `SESSION_DAYS` | `30` (the default; may be omitted)               | sliding session lifetime, a positive integer                                                            |
| `LOG_REQUESTS` | unset, or `"true"`                               | one JSON line per request: method, path, status, ms. No IP, no cookie, no body                          |

`PORT` (8080), `HOST` (`0.0.0.0`) and `STATIC_DIR` (`/app/dist`) are set by the image; leave them.

**Sealed secret**:

| Variable             | What it is                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_CLIENT_ID`     | the Authentik provider's client id                                                                                                                                |
| `OIDC_CLIENT_SECRET` | its client secret (a confidential client; PKCE is used as well)                                                                                                   |
| `SESSION_SECRET`     | at least 32 bytes (`readConfig` refuses fewer); signs the session and login cookies. Generate it, e.g. `openssl rand -base64 48`, in the same shell that seals it |

Rotating `SESSION_SECRET` signs everyone out (their cookies stop verifying); nothing else is lost.

`OIDC_ISSUER` must be `https`. Plain `http` is accepted only for a loopback host (the local fake
issuer); anywhere else the process refuses to start (`loopbackOnly` in `server/auth.mjs`). The
reason is in that function's comment: the ID token's claims are trusted on the strength of the
token endpoint's TLS.

Config is read once at start; a change needs a pod restart (the usual `config-rev` annotation).

## 5. Storage: SQLite on a volume

**Confirmed by Ben (2026-10-12, recorded as decision 40 of `PLAN-accounts.md`): SQLite on a PVC,
not the cluster's shared Postgres.** One file, no second service, which is what a self-hoster gets
too.

- The file is `$DATA_DIR/planner.sqlite` (`server/db.mjs`), plus SQLite's `-wal` and `-shm`
  beside it: the database runs in **WAL mode**, one connection, foreign keys on, 5 s busy timeout.
- **One writable mount, at `/data`.** A PVC, `ReadWriteOnce`, **1 GiB** is far more than enough
  (the document is kilobytes per user). `readOnlyRootFilesystem: true` stays.
- The directory must be writable by uid 1000: set the pod's `fsGroup: 1000`. `openDatabase`
  creates the directory and the file if they are missing and needs nothing else.
- **One replica**, and `strategy: Recreate`. The store is one file opened by one process; a second
  replica, or a rolling update that briefly runs two pods against the same volume, is not
  supported. Scaling out would mean a Postgres store: `server/store.mjs` is the seam (its
  functions `getUser`, `upsertUser`, `createSession`, `getSession`, `touchSession`,
  `deleteSession`, `getState`, `putState` are everything the routes use), and decision 40 names
  the cluster's Postgres as that alternative.
- The volume only matters with accounts on. Mounting it with accounts off is harmless (nothing is
  opened).

What is in the file: per account, the issuer and subject that identify the user, their email and
name as the issuer gave them (both optional), created and last-seen times; their sessions (a random
id, created, expires, last seen); and one document, the planner's export bundle (presets, doughs,
bulk table, saved plans, current plan, settings, and when each last changed). No tokens: ID and
access tokens are used once at sign-in and dropped (`server/auth.mjs`).

## 6. Migrations run at boot, in the server's process

This differs from the cluster's usual rule (a separate migration Job before rollout), on purpose.

- Migrations are numbered SQL files, `server/migrations/NNN_name.sql`, applied by `migrate()` in
  `server/db.mjs` when the server starts with accounts on: each file in one transaction, recorded
  in `schema_migrations(id, applied_at)`. A second run is a no-op. Every file is idempotent by rule
  (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`; never `DROP`, `DELETE` or
  `TRUNCATE`; decision 41). Forward-only.
- **There is no separate job and no separate entrypoint.** A Job would need the same
  `ReadWriteOnce` volume as the one pod that owns the file, and the single process that opens
  SQLite is the natural place to migrate it.
- If the database cannot be opened or a migration fails, the server still starts and serves the
  SPA, logs `database unavailable, /readyz will fail: …`, answers `/api/*` and `/auth/*` with
  `503 { "error": "database unavailable" }`, and **`/readyz` returns 503** naming the database
  error. A failed migration rolls back alone; the ones before it stay applied.

## 7. Health

| Path       | Probe     | 200 when                                                                                             |
| ---------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `/healthz` | liveness  | the process answers: `{"status":"ok","version":"<APP_VERSION>"}`                                     |
| `/readyz`  | readiness | `index.html` is readable and, with accounts on, the database opened, migrated and answers `SELECT 1` |

Neither needs auth, and neither calls the issuer: an issuer outage does not make the pod unready
(sign-in fails with a 502 and a message; the planner keeps working from the browser's storage).

## 8. Network

**Inbound:** TCP 8080 from the ingress (Traefik). Plain HTTP; TLS ends upstream. No WebSockets.

**Outbound, accounts off:** none.

**Outbound, accounts on:** the issuer, and nothing else. The server calls `OIDC_ISSUER` for:

- discovery, `<OIDC_ISSUER>.well-known/openid-configuration`, on the first sign-in after start
  (cached; refetched after a failed code exchange);
- the token endpoint the discovery document names, once per sign-in.

It does **not** fetch the JWKS (openid-client does not verify the ID token's signature in the code
flow; it trusts the token endpoint's TLS) and does not call userinfo. Both requests time out after
10 s. DNS is needed to resolve the issuer's host. The browser, separately, visits the issuer's
authorize endpoint to sign in and its end-session endpoint to sign out; those are browser
navigations, not server egress.

## 9. Behind the proxies

- **`X-Forwarded-Proto` is not consulted, and does not need to be.** Every absolute URL the server
  makes (the OIDC `redirect_uri`, the post-logout redirect) is built from `APP_URL`, and the
  cookies' `Secure` flag follows `APP_URL`'s scheme. Set `APP_URL` to the https origin and the
  proxy chain cannot get it wrong.
- No scheme-based HTTPS redirect, so no loop.
- The client IP is not used: no rate limiting, and request logs carry no address.
- Cookies (accounts on only): `sdp_session` (HttpOnly, SameSite=Lax, Secure on https, Path=/, 30
  days sliding) and `sdp_login` (HttpOnly, SameSite=Lax, Path=/auth, 10 minutes, during sign-in).
  CSRF: writes require `Content-Type: application/json` (`readJson` answers 415 otherwise), which
  with SameSite=Lax is the guard.
- The app is public: no Cloudflare Access policy is needed. If one is ever put in front of the
  hostname, the browser-facing `/auth/callback` must still reach the app after the issuer redirects
  back, and `/healthz` and `/readyz` are probed in-cluster.

## 10. The identity provider (Authentik)

The server is a confidential OIDC client using Authorization Code with PKCE (`server/auth.mjs`).
In Authentik:

1. **An OAuth2/OpenID provider**:
   - client type **confidential**; its client id and secret go into the sealed secret;
   - redirect URI, strict: `https://sourdough.ralton.dev/auth/callback`;
   - **post-logout redirect URI: `https://sourdough.ralton.dev/`** (with the trailing slash).
     Sign-out sends the browser to Authentik's `end_session_endpoint` with
     `post_logout_redirect_uri=<APP_URL>/` and the client id; an unregistered value leaves the user
     on Authentik's page;
   - scopes `openid profile email` (what the server asks for);
   - a signing key (RS256); the app does not fetch it but a standard ID token needs one;
   - issuer mode per provider (Authentik's default), so the issuer is
     `https://<authentik-host>/application/o/<slug>/` and equals `OIDC_ISSUER` exactly: discovery
     checks that the document's `issuer` matches the URL it was fetched from.
2. **An application** bound to that provider; its slug is the `<slug>` above. Who may sign in is
   Authentik's policy binding on the application; the app accepts any user the issuer signs in.

Claims kept: `iss` and `sub` (the account's identity, unique together), `email`, and `name`,
falling back to `preferred_username` when the issuer sends no `name`. Nothing else from the token
is stored. An `error=access_denied` callback (the user cancelled, or a policy refused them) lands
on `/?signin=denied`, which the app explains in place.

## 11. Backup and restore

- **Snapshot the volume; do not copy the file.** A WAL-mode SQLite file copied while the app runs
  is not a consistent backup (the `-wal` holds committed pages not yet in the main file). A volume
  snapshot taken as one unit is. The app adds nothing for backup.
- Restore: stop the pod (scale to 0), restore the volume, start it. Migrations at boot bring an
  older snapshot's schema forward.
- Each user's document can also be exported from the app (Presets page, Backup card) as JSON;
  that is a user's own backup, not the operator's.

## 12. Rollback

- **Accounts off, data kept:** set `OIDC_ISSUER=""` in the ConfigMap and restart. The app goes
  back to local-only; everyone's browser still has its own copy (the browser's storage is what the
  app renders from in either mode); the database and the secrets stay for turning accounts back
  on.
- **Image rollback:** pin the previous `sha-` tag. Migrations are forward-only and additive by
  rule, so an older image runs against a newer schema: it skips migrations it has no file for and
  ignores tables it does not know. An image from before accounts (before `56ae878` on `main`)
  ignores the account variables and the volume, which is the same as accounts off.

## 13. How a release reaches the cluster

Push to `main` builds and pushes `ghcr.io/ralton-dev/sourdough-planner:sha-<full sha>` (and
`latest`); the tag is printed in the job summary. A human bumps the tag (and `APP_VERSION`) in the
manifest repo; Argo rolls it out. Nothing here deploys itself, and the running version can be
behind `main`.

## 14. Open questions

Only what the source cannot answer:

1. **The Authentik application slug and host**, which make `OIDC_ISSUER`
   (`https://<authentik-host>/application/o/<slug>/`). Any slug works; the app has no opinion.
2. **How the pod reaches the issuer.** `OIDC_ISSUER` must be the issuer's public URL (it has to
   equal the `iss` in the ID token and the `issuer` in discovery), so the egress rule depends on
   how the cluster routes a pod's request to that public hostname: out through Cloudflare and back,
   or resolved to an in-cluster address. That decides the NetworkPolicy's destination.
3. **Which storage class backs the PVC.** SQLite in WAL mode needs a local filesystem with working
   locks and shared memory; a network filesystem (NFS) is a known risk for it. A node-local class
   ties the pod to one node; a CSI class that supports snapshots is what section 11 assumes. The
   choice, and the snapshot schedule, are the cluster's.
4. **Whether CI should gain a second smoke step with accounts on**: the image started with all six
   variables, a tmpfs at `/data` and the fake issuer, proving the read-only root holds with a
   database open and `/readyz` covers it. Today only the local-only mode is smoke-tested in CI; the
   accounts path is covered by the server's vitest suite over HTTP.
