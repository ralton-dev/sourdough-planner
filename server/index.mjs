// The planner's server: static files for the built SPA, /healthz and /readyz, and, when accounts
// are configured, the route table from auth.mjs and state.mjs over a SQLite store (PLAN-accounts
// §3). With no accounts configured it is the file server it always was: no database, no cookies.
//
// Why not nginx: the cluster runs containers as uid 1000 with a read-only root filesystem and
// wants /healthz to report APP_VERSION. Node does that with nothing to chown; the one writable
// path, when accounts are on, is the DATA_DIR mount.
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authRoutes } from "./auth.mjs";
import { closeDatabase, migrate, openDatabase } from "./db.mjs";
import { createRouter, json } from "./router.mjs";
import { stateRoutes } from "./state.mjs";
import { createStore } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Accounts are on only when every one of these is set (§3); any subset is a startup error. */
export const ACCOUNT_VARS = [
  "DATA_DIR",
  "APP_URL",
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "SESSION_SECRET",
];

function httpUrl(name, value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL, got ${JSON.stringify(value)}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`${name} must be an absolute http(s) URL, got ${JSON.stringify(value)}`);
  }
  return u;
}

/**
 * `accounts` is null (off) when none of ACCOUNT_VARS is set, or when OIDC_ISSUER is set to the
 * empty string: that is the documented switch-off that keeps the rest of the config and the data
 * in place. Otherwise all six must be set and valid.
 */
function readAccounts(env) {
  if (env.OIDC_ISSUER === "") return null;
  const missing = ACCOUNT_VARS.filter((k) => !env[k]);
  if (missing.length === ACCOUNT_VARS.length) return null;
  if (missing.length > 0) {
    throw new Error(
      `Accounts need all of ${ACCOUNT_VARS.join(", ")}; missing ${missing.join(", ")}. ` +
        "Set them all, or none (or OIDC_ISSUER to empty) for the local-only app.",
    );
  }
  const appUrl = httpUrl("APP_URL", env.APP_URL);
  const issuer = httpUrl("OIDC_ISSUER", env.OIDC_ISSUER);
  if (Buffer.byteLength(env.SESSION_SECRET, "utf8") < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes");
  }
  const sessionDays = Number(env.SESSION_DAYS ?? "30");
  if (!Number.isInteger(sessionDays) || sessionDays < 1) {
    throw new Error(
      `SESSION_DAYS must be a positive integer, got ${JSON.stringify(env.SESSION_DAYS)}`,
    );
  }
  return {
    dataDir: path.resolve(env.DATA_DIR),
    appUrl: appUrl.origin,
    issuer: issuer.href,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    sessionSecret: env.SESSION_SECRET,
    sessionDays,
    secureCookies: appUrl.protocol === "https:",
  };
}

export function readConfig(env = process.env) {
  const port = Number.parseInt(env.PORT ?? "8080", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got ${JSON.stringify(env.PORT)}`);
  }
  return {
    port,
    host: env.HOST ?? "0.0.0.0",
    version: env.APP_VERSION ?? "dev",
    staticDir: path.resolve(env.STATIC_DIR ?? path.join(here, "..", "dist")),
    logRequests: env.LOG_REQUESTS === "true",
    accounts: readAccounts(env),
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

/** Opens and migrates the database when accounts are on. Never throws: a failure is reported. */
function openStore(config) {
  if (!config.accounts) return { db: null, store: null, dbError: null };
  let db = null;
  try {
    db = openDatabase(config.accounts.dataDir);
    migrate(db);
    return { db, store: createStore(db, config.accounts), dbError: null };
  } catch (err) {
    closeDatabase(db);
    return { db: null, store: null, dbError: err };
  }
}

/** Routes live under these; an unclaimed path there is a JSON 404, never the SPA's index.html. */
const API_PREFIXES = ["/api/", "/auth/"];

export function createApp(config) {
  let index = null;
  let indexError = null;
  const { db, store, dbError } = openStore(config);
  // Accounts on but the database is down: mount nothing, answer the API with 503 (below).
  const router =
    config.accounts && !store
      ? null
      : createRouter([...authRoutes({ config, store }), ...stateRoutes({ config, store })]);

  function databaseError() {
    if (!config.accounts) return null;
    if (dbError) return dbError;
    try {
      db.prepare("SELECT 1").get();
      return null;
    } catch (err) {
      return err;
    }
  }

  async function loadIndex() {
    try {
      index = await fs.readFile(path.join(config.staticDir, "index.html"));
      indexError = null;
    } catch (err) {
      index = null;
      indexError = err;
    }
  }

  const server = createServer(async (req, res) => {
    const started = Date.now();
    res.on("finish", () => {
      if (config.logRequests) {
        console.log(
          JSON.stringify({
            method: req.method,
            path: req.url,
            status: res.statusCode,
            ms: Date.now() - started,
          }),
        );
      }
    });

    const url = new URL(req.url ?? "/", "http://localhost");
    if (router && (await router.handle(req, res, url))) return;
    if (API_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      return router
        ? json(res, 404, { error: "not found" })
        : json(res, 503, { error: "database unavailable" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      return res.end();
    }

    // Liveness: the process answers. Readiness: the bundle is on disk to serve and, with accounts
    // on, the database opened, migrated and answers.
    if (url.pathname === "/healthz")
      return json(res, 200, { status: "ok", version: config.version });
    if (url.pathname === "/readyz") {
      if (!index) await loadIndex();
      const dbErr = databaseError();
      if (!index || dbErr) {
        const reason = !index
          ? String(indexError?.message ?? "no index")
          : `database: ${dbErr.message}`;
        return json(res, 503, { status: "not ready", reason });
      }
      return json(res, 200, { status: "ready", version: config.version });
    }

    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
    const file = path.join(config.staticDir, safe);
    if (!file.startsWith(config.staticDir + path.sep) && file !== config.staticDir) {
      res.writeHead(403);
      return res.end();
    }

    const ext = path.extname(file).toLowerCase();
    if (ext && MIME[ext]) {
      try {
        const body = await fs.readFile(file);
        const immutable = safe.startsWith(`${path.sep}assets${path.sep}`);
        res.writeHead(200, {
          "content-type": MIME[ext],
          "content-length": body.length,
          "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        });
        return res.end(req.method === "HEAD" ? undefined : body);
      } catch {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("not found");
      }
    }

    // SPA fallback: every route is index.html.
    if (!index) await loadIndex();
    if (!index) {
      res.writeHead(503, { "content-type": "text/plain" });
      return res.end("bundle missing");
    }
    res.writeHead(200, {
      "content-type": MIME[".html"],
      "content-length": index.length,
      "cache-control": "no-cache",
    });
    return res.end(req.method === "HEAD" ? undefined : index);
  });

  server.on("close", () => closeDatabase(db));

  return { server, loadIndex, store, dbError };
}

export async function start(config = readConfig()) {
  const { server, loadIndex, dbError } = createApp(config);
  await loadIndex();
  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  const accounts = config.accounts
    ? `accounts on (${config.accounts.issuer}, data in ${config.accounts.dataDir})`
    : "accounts off";
  console.log(
    `sourdough-planner ${config.version} listening on http://${config.host}:${config.port} serving ${config.staticDir}, ${accounts}`,
  );
  if (dbError) console.error(`database unavailable, /readyz will fail: ${dbError.message}`);
  const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
