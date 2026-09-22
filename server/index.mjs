// Dependency-free static server for the built SPA.
//
// Why not nginx: the cluster runs containers as uid 1000 with a read-only root
// filesystem and wants /healthz to report APP_VERSION. Node does that in ~100
// lines with nothing to chown and no writable dirs to mount.
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

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

export function createApp(config) {
  let index = null;
  let indexError = null;

  async function loadIndex() {
    try {
      index = await fs.readFile(path.join(config.staticDir, "index.html"));
      indexError = null;
    } catch (err) {
      index = null;
      indexError = err;
    }
  }

  const json = (res, status, body) => {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  };

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
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      return res.end();
    }

    // Liveness: the process answers. Readiness: the bundle is on disk to serve.
    if (url.pathname === "/healthz")
      return json(res, 200, { status: "ok", version: config.version });
    if (url.pathname === "/readyz") {
      if (!index) await loadIndex();
      return index
        ? json(res, 200, { status: "ready", version: config.version })
        : json(res, 503, {
            status: "not ready",
            reason: String(indexError?.message ?? "no index"),
          });
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

  return { server, loadIndex };
}

export async function start(config = readConfig()) {
  const { server, loadIndex } = createApp(config);
  await loadIndex();
  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  console.log(
    `sourdough-planner ${config.version} listening on http://${config.host}:${config.port} serving ${config.staticDir}`,
  );
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
