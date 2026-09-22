# Build the SPA, then serve it from a dependency-free Node server (server/index.mjs).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    STATIC_DIR=/app/dist \
    APP_VERSION=dev
WORKDIR /app
# Runtime has no npm dependencies: only the bundle and the server script.
COPY --chown=1000:1000 --from=build /app/dist ./dist
COPY --chown=1000:1000 server/index.mjs ./server/index.mjs
# The official image's `node` user is uid/gid 1000; use the numeric id so the
# cluster's runAsUser: 1000 matches what the files are owned by.
USER 1000:1000
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "server/index.mjs"]
