# Build the SPA, then serve it from the Node server in server/: static files always; with
# accounts configured, also login and the state API over SQLite in $DATA_DIR (PLAN-accounts §3).
# Pinned to 22.23: node:sqlite's API is still "active development" and the pin absorbs it.
FROM node:22.23-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:22.23-alpine AS runtime
# NODE_OPTIONS: node:sqlite prints an ExperimentalWarning on every start in 22.x; the pin above
# is the deliberate acceptance of that API, so the warning is noise in the logs.
ENV NODE_ENV=production \
    NODE_OPTIONS=--no-warnings=ExperimentalWarning \
    PORT=8080 \
    HOST=0.0.0.0 \
    STATIC_DIR=/app/dist \
    APP_VERSION=dev
WORKDIR /app
# Production dependencies only (the server's openid-client); root-owned and read-only at runtime.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=1000:1000 --from=build /app/dist ./dist
COPY --chown=1000:1000 server ./server
# The official image's `node` user is uid/gid 1000; use the numeric id so the
# cluster's runAsUser: 1000 matches what the files are owned by. With accounts on,
# DATA_DIR (e.g. /data) is the one writable mount and must be writable by uid 1000.
USER 1000:1000
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "server/index.mjs"]
