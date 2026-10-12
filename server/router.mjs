// A route table and the few HTTP helpers the API modules share. Dependency-free.
//
// A route is `{ method, path, handler }`: `path` is exact ("/api/state") or a prefix ending in
// "/*" ("/auth/*" matches "/auth/x" and "/auth/x/y", not "/auth"). Handlers are
// `async (req, res, url) => void` and must answer the request; throwing an `HttpError` answers
// `{ error: message }` with its status, any other throw answers 500 (logged, without the body).

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** `body` as JSON. `cache-control: no-store` unless `headers` says otherwise. */
export function json(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}

/**
 * The request body parsed as JSON. Throws HttpError 415 unless the content type is
 * application/json (with SameSite=Lax this is the CSRF guard, decision 43), 413 beyond
 * `limitBytes`, 400 when it does not parse.
 */
export async function readJson(req, limitBytes) {
  const type = String(req.headers["content-type"] ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "expected application/json");
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limitBytes) {
    req.resume();
    throw new HttpError(413, "body too large");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      req.resume();
      throw new HttpError(413, "body too large");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "body is not JSON");
  }
}

/** The Cookie header as `{ name: value }`; the first of duplicate names wins. */
export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/**
 * One Set-Cookie value. Defaults are decision 39's: Path=/, HttpOnly, SameSite=Lax; `secure` and
 * `maxAge` (seconds; 0 clears) are the caller's.
 */
export function serializeCookie(
  name,
  value,
  { maxAge, path = "/", httpOnly = true, sameSite = "Lax", secure = false } = {},
) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (httpOnly) parts.push("HttpOnly");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Adds a Set-Cookie header, keeping any already set on this response. */
export function appendSetCookie(res, cookie) {
  const prev = res.getHeader("set-cookie");
  const list = prev === undefined ? [] : Array.isArray(prev) ? prev : [String(prev)];
  res.setHeader("set-cookie", [...list, cookie]);
}

export function createRouter(routes = []) {
  const table = [];

  function addRoute(method, path, handler) {
    if (path.endsWith("/*")) table.push({ method, prefix: path.slice(0, -1), handler });
    else table.push({ method, exact: path, handler });
  }
  for (const r of routes) addRoute(r.method, r.path, r.handler);

  const hits = (route, pathname) =>
    route.exact !== undefined ? pathname === route.exact : pathname.startsWith(route.prefix);

  /**
   * Answers the request when a route's path matches: its handler when the method matches, else
   * 405 with Allow. Returns false (and writes nothing) when no route's path matches.
   */
  async function handle(req, res, url) {
    const matching = table.filter((r) => hits(r, url.pathname));
    if (matching.length === 0) return false;
    const route = matching.find((r) => r.method === req.method);
    if (!route) {
      res.writeHead(405, { allow: [...new Set(matching.map((r) => r.method))].join(", ") });
      res.end();
      return true;
    }
    try {
      await route.handler(req, res, url);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
      } else if (err instanceof HttpError) {
        json(res, err.status, { error: err.message });
      } else {
        console.error(`${req.method} ${url.pathname} failed: ${err?.stack ?? err}`);
        json(res, 500, { error: "internal error" });
      }
    }
    return true;
  }

  return { addRoute, handle };
}
