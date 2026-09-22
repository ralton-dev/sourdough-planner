# Homelab deployment contract — sourdough-planner

This app runs on a small self-hosted Kubernetes cluster: k3s across two arm64 Raspberry Pi 5s
and one amd64 Mac Mini. Deployment is GitOps — a separate repo holds the manifests and Argo
CD reconciles them. Nothing in this repo deploys itself. You will not have access to that
cluster from here and do not need it; everything below is a property of _this_ repo.

The app is a static single-page app served by a dependency-free Node server, with all state
in the browser's localStorage. That removes most of the contract: no database, no
migrations, no outbound calls, no auth of its own. What remains, and where it is satisfied:

## Checklist

| Requirement                                                                              | Status           | Where                                                                                                       |
| ---------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Multi-arch `linux/amd64` + `linux/arm64` image                                           | **done**         | `.github/workflows/ci.yml` — per-platform native builds pushed by digest, merged into one manifest list     |
| Tagged `sha-<full sha>` + `latest`, immutable, on `ghcr.io/ralton-dev/sourdough-planner` | **done**         | `docker-merge` job, `docker/metadata-action` with `type=sha,format=long`                                    |
| `homelab-arm64` runner selected only on push-to-main                                     | **done**         | the `runs-on` expression in the `docker` job, copied verbatim from finance-planner                          |
| Repo added to the **`homelab` runner group**                                             | **manual — Ben** | see §Runner below                                                                                           |
| `/healthz` and `/readyz`, unauthenticated, meaningfully different                        | **done**         | `server/index.mjs` — liveness is "process answers", readiness is "bundle readable from disk"                |
| `APP_VERSION` surfaced by `/healthz`                                                     | **done**         | `server/index.mjs` `readConfig`; default `dev`                                                              |
| Runs as uid 1000, read-only root, no capabilities, port > 1024                           | **done**         | `Dockerfile` — `USER 1000:1000`, `PORT=8080`; CI smoke-starts it with `--read-only --cap-drop ALL`          |
| Writes only to `/tmp` or a declared mount; tolerates unwritable `$HOME`                  | **done**         | the server never writes; Node needs no writable `$HOME` here                                                |
| Every setting an env var, documented, defaults, fails loudly                             | **done**         | `README.md` §Running it; bad `PORT` exits 1 naming the variable                                             |
| Postgres TLS                                                                             | n/a              | no database                                                                                                 |
| Migrations                                                                               | n/a              | no database                                                                                                 |
| Inbound and outbound network paths enumerated                                            | **done**         | `README.md` §Network — inbound 8080 only, zero egress                                                       |
| Binds `0.0.0.0`; no unlisted outbound calls                                              | **done**         | `HOST` default; bundle self-contained (no fonts, CDNs, analytics). Footer links are user-initiated only     |
| `X-Forwarded-Proto`, `Secure` cookies, no scheme redirect                                | n/a / done       | no cookies, no absolute URLs, no redirects                                                                  |
| Endpoints that must bypass an interactive login                                          | **none**         | health probes are hit by the kubelet inside the cluster, not through Cloudflare; no webhooks or API clients |
| Tracing                                                                                  | none             | no SDK is loaded; nothing to gate                                                                           |

## Runner

The arm64 image leg uses the in-cluster self-hosted runner `homelab-arm64` on push to
`main`. Access is granted per repository by the `homelab` runner group, and **if the repo is
not in that group the arm64 job queues forever with no error.**

> Add this repo to the group before the first push to `main`:
> <https://github.com/organizations/ralton-dev/settings/actions/runner-groups/3>
> _Runner groups → homelab → Repository access → add `sourdough-planner`._

On `pull_request` the arm64 leg falls back to GitHub's hosted `ubuntu-24.04-arm`, so PRs from
forks never touch the self-hosted runner. Do not change the `runs-on` expression.

## Public-repo hardening

This is a public repository under `ralton-dev`, and the runner is privileged on a home LAN,
so the workflow condition is the real guard and the repo settings are the backstop. Set
these once, in _Settings → Actions → General_:

- **Fork pull request workflows:** "Require approval for all outside collaborators."
- **Workflow permissions:** "Read repository contents and packages permissions" (the workflow
  requests `packages: write` explicitly on the two image jobs and nothing else).
- Leave "Allow GitHub Actions to create and approve pull requests" off.
- Under _Settings → Actions → Runners_ confirm the repo appears in the `homelab` group only
  after the step above, not by default.

The workflow itself already: sets `permissions: contents: read` at the top level, logs in to
GHCR only on push-to-main, and pushes nothing on `pull_request`.

## How deployment happens

1. Push to `main`. CI builds and pushes `ghcr.io/ralton-dev/sourdough-planner:sha-<full sha>`.
   The _Multi-arch manifest_ job summary prints the exact tag.
2. A human edits the manifest repo to point at that tag, sets `APP_VERSION` to the same
   string, bumps the `config-rev` annotation if config changed, and commits.
3. Argo CD notices within a few minutes and rolls it out.

A merge to `main` is not a release; the running version can be behind `main`.

## What the manifest needs to know

- Image: `ghcr.io/ralton-dev/sourdough-planner:sha-<sha>`, manifest list for amd64 + arm64.
- Container port `8080`, named `http`.
- Probes: `GET /healthz` liveness, `GET /readyz` readiness, both on `http`.
- Env: `APP_VERSION=<tag>`. Nothing else is required; `PORT`, `HOST`, `STATIC_DIR` and
  `LOG_REQUESTS` are optional overrides.
- No volumes. No `emptyDir` is needed, not even `/tmp`.
- Security context exactly as the cluster default: `runAsNonRoot`, uid/gid 1000,
  `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, drop `ALL`, `RuntimeDefault`
  seccomp.
- NetworkPolicy: ingress from the ingress controller on 8080; **no egress** at all.
- Resources are tiny: the server idles at a few MB; 25m/32Mi requests and 200m/128Mi limits
  as for finance-planner's web are ample.
- Auth: none in the app, and none needed: the hostname is public. It has no server-side
  state, accepts only `GET`/`HEAD`, and every visitor's data stays in their own browser. Keep
  the hostname in Terraform with an allow-everyone policy so the exposure is deliberate, and
  rely on Cloudflare caching, rate limiting and bot protection rather than Access.
