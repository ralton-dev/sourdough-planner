// The state API of decision 43 over HTTP (PLAN-accounts P3; P1 wrote the first five cases as the
// red pin). Sessions are minted straight through the store and session.mjs, on a second connection
// to the same file, so this file does not depend on login (P2) or on createApp's return shape.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SHAPE_CASES, V2_EXPORT, V3_BUNDLE } from "../src/lib/bundle.fixtures.ts";
import { closeDatabase, migrate, openDatabase } from "./db.mjs";
import { createApp, readConfig } from "./index.mjs";
import { SESSION_COOKIE, signSessionId } from "./session.mjs";
import { isBundleShape, STATE_LIMIT_BYTES, stateRoutes } from "./state.mjs";
import { createStore } from "./store.mjs";

const SECRET = "pin-".repeat(8);

/** Today's export shape by hand (storage.ts `exportBundle`, version 2). */
const bundle = {
  app: "sourdough-planner",
  version: 2,
  exportedAt: "2026-10-12T08:00:00.000Z",
  presets: [],
  doughs: [],
  bulkTable: [],
  savedPlans: [],
  plan: {
    id: "plan-1",
    mode: "items",
    items: [],
    settings: {},
    startTime: "2026-10-12T09:00:00.000Z",
  },
};

let dir;
let app;
let base;
let db;
let store;
let config;
let cookie;

/** A fresh user with a live session; returns `{ user, cookie }`. */
function signIn(subject) {
  const user = store.upsertUser({ issuer: config.accounts.issuer, subject, name: subject });
  const session = store.createSession(user.id);
  return { user, cookie: `${SESSION_COOKIE}=${signSessionId(session.id, SECRET)}` };
}

/** The stored body column, exactly as written. */
const storedBody = (userId) =>
  db.prepare("SELECT body FROM states WHERE user_id = ?").get(userId)?.body;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "sdp-state-"));
  const staticDir = path.join(dir, "static");
  await fs.mkdir(staticDir);
  await fs.writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>t</title>");
  config = readConfig({
    STATIC_DIR: staticDir,
    DATA_DIR: path.join(dir, "data"),
    APP_URL: "http://127.0.0.1",
    OIDC_ISSUER: "http://127.0.0.1:9/issuer",
    OIDC_CLIENT_ID: "client",
    OIDC_CLIENT_SECRET: "secret",
    SESSION_SECRET: SECRET,
  });
  app = createApp(config);
  await app.loadIndex();
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${app.server.address().port}`;

  db = openDatabase(config.accounts.dataDir);
  migrate(db);
  store = createStore(db, config.accounts);
  ({ cookie } = signIn("pin"));
});

afterAll(async () => {
  closeDatabase(db);
  await new Promise((r) => app.server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
});

const get = (headers = { cookie }) => fetch(`${base}/api/state`, { headers });

const put = (body, headers = { cookie }) =>
  fetch(`${base}/api/state`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("/api/state", () => {
  it("GET before any PUT is 204, no-store", async () => {
    const r = await get();
    expect(r.status).toBe(204);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.text()).toBe("");
  });

  it("PUT with baseVersion 0 stores version 1", async () => {
    const r = await put({ baseVersion: 0, bundle });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = await r.json();
    expect(body.version).toBe(1);
    expect(typeof body.updatedAt).toBe("string");
    expect(Object.keys(body).sort()).toEqual(["updatedAt", "version"]);
  });

  it("GET returns the stored bundle", async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = await r.json();
    expect(body.version).toBe(1);
    expect(typeof body.updatedAt).toBe("string");
    expect(body.bundle).toEqual(bundle);
  });

  it("a second PUT with baseVersion 0 is 409 carrying version 1", async () => {
    const r = await put({ baseVersion: 0, bundle: { ...bundle, presets: [{ id: "late" }] } });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.version).toBe(1);
    expect(body.bundle).toEqual(bundle);
  });

  it("GET without a session is 401", async () => {
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
  });

  it("PUT without a session is 401", async () => {
    expect((await put({ baseVersion: 0, bundle }, {})).status).toBe(401);
  });

  it("a forged session cookie is 401", async () => {
    const forged = `${SESSION_COOKIE}=${signSessionId("nope", "x".repeat(32))}`;
    expect((await get({ cookie: forged })).status).toBe(401);
    expect((await put({ baseVersion: 0, bundle }, { cookie: forged })).status).toBe(401);
  });
});

describe("/api/state conflicts", () => {
  it("the 409 payload is the stored document, byte for byte, and nothing is written", async () => {
    const { user, cookie: c } = signIn("conflict");
    const first = { ...V3_BUNDLE, presets: [{ id: "first", note: "naïve – ünïcødé 🍞" }] };
    const ok = await (await put({ baseVersion: 0, bundle: first }, { cookie: c })).json();
    const before = storedBody(user.id);

    const r = await put({ baseVersion: 0, bundle: V3_BUNDLE }, { cookie: c });
    expect(r.status).toBe(409);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = await r.json();
    expect(Object.keys(body).sort()).toEqual(["bundle", "updatedAt", "version"]);
    expect(body.version).toBe(ok.version);
    expect(body.updatedAt).toBe(ok.updatedAt);
    expect(JSON.stringify(body.bundle)).toBe(before);
    expect(JSON.stringify(body.bundle)).toBe(JSON.stringify(first));
    expect(storedBody(user.id)).toBe(before);
  });

  it("a baseVersion ahead of the stored one is 409 too", async () => {
    const { cookie: c } = signIn("ahead");
    const r = await put({ baseVersion: 5, bundle }, { cookie: c });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ version: 0, updatedAt: null, bundle: null });
    expect((await get({ cookie: c })).status).toBe(204);
  });

  it("a PUT after a 409 with the returned version succeeds", async () => {
    const { cookie: c } = signIn("retry");
    await put({ baseVersion: 0, bundle }, { cookie: c });
    await put(
      { baseVersion: 1, bundle: { ...bundle, presets: [{ id: "device-a" }] } },
      { cookie: c },
    );

    const stale = await put({ baseVersion: 1, bundle: V3_BUNDLE }, { cookie: c });
    expect(stale.status).toBe(409);
    const { version } = await stale.json();
    expect(version).toBe(2);

    const retried = await put({ baseVersion: version, bundle: V3_BUNDLE }, { cookie: c });
    expect(retried.status).toBe(200);
    expect((await retried.json()).version).toBe(3);
    const now = await (await get({ cookie: c })).json();
    expect(now.version).toBe(3);
    expect(now.bundle).toEqual(V3_BUNDLE);
  });

  it("two users do not see each other's state", async () => {
    const a = signIn("alice");
    const b = signIn("bob");
    const aBundle = { ...V3_BUNDLE, presets: [{ id: "alice-only" }] };
    expect((await put({ baseVersion: 0, bundle: aBundle }, { cookie: a.cookie })).status).toBe(200);

    expect((await get({ cookie: b.cookie })).status).toBe(204);
    const bPut = await put({ baseVersion: 0, bundle: V3_BUNDLE }, { cookie: b.cookie });
    expect(bPut.status).toBe(200);
    expect((await bPut.json()).version).toBe(1);

    expect((await (await get({ cookie: a.cookie })).json()).bundle).toEqual(aBundle);
    expect((await (await get({ cookie: b.cookie })).json()).bundle).toEqual(V3_BUNDLE);
    expect(storedBody(a.user.id)).toBe(JSON.stringify(aBundle));
    expect(storedBody(b.user.id)).toBe(JSON.stringify(V3_BUNDLE));
  });
});

describe("/api/state refusals", () => {
  /** A PUT body of exactly `bytes` bytes, the bundle padded in a string field. */
  const paddedBody = (bytes) => {
    const envelope = (pad) => JSON.stringify({ baseVersion: 0, bundle: { ...V3_BUNDLE, pad } });
    const text = envelope("x".repeat(bytes - Buffer.byteLength(envelope(""))));
    expect(Buffer.byteLength(text)).toBe(bytes);
    return text;
  };

  it("a body of 1 MiB + 1 byte is 413 and nothing is stored; exactly 1 MiB is stored", async () => {
    const { user, cookie: c } = signIn("big");
    expect(STATE_LIMIT_BYTES).toBe(1024 * 1024);
    const over = await put(paddedBody(STATE_LIMIT_BYTES + 1), { cookie: c });
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: "body too large" });
    expect(storedBody(user.id)).toBeUndefined();

    const at = await put(paddedBody(STATE_LIMIT_BYTES), { cookie: c });
    expect(at.status).toBe(200);
    expect((await (await get({ cookie: c })).json()).bundle.pad.length).toBeGreaterThan(1000000);
  });

  it("a wrong content type is 415 and nothing is stored (the CSRF guard)", async () => {
    const { user, cookie: c } = signIn("csrf");
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const r = await fetch(`${base}/api/state`, {
        method: "PUT",
        headers: { cookie: c, "content-type": type },
        body: JSON.stringify({ baseVersion: 0, bundle }),
      });
      expect(r.status).toBe(415);
      expect(await r.json()).toEqual({ error: "expected application/json" });
    }
    expect(storedBody(user.id)).toBeUndefined();
    expect((await get({ cookie: c })).status).toBe(204);
  });

  it("a non-bundle is 400 and nothing is stored", async () => {
    const { user, cookie: c } = signIn("junk");
    const cases = [
      { baseVersion: 0, bundle: { hello: 1 } },
      { baseVersion: 0, bundle: null },
      { baseVersion: 0 },
      { baseVersion: 0, bundle: { ...V3_BUNDLE, ui: undefined } },
      { baseVersion: 0, bundle: { ...V3_BUNDLE, version: 4 } },
    ];
    for (const body of cases) {
      const r = await put(body, { cookie: c });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "bundle is not a sourdough-planner bundle" });
    }
    for (const body of [[], "bundle", 3, null]) {
      const r = await put(JSON.stringify(body), { cookie: c });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "expected { baseVersion, bundle }" });
    }
    const notJson = await put("{ not json", { cookie: c });
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ error: "body is not JSON" });
    expect(storedBody(user.id)).toBeUndefined();
  });

  it("a bad baseVersion is 400 and nothing is stored", async () => {
    const { user, cookie: c } = signIn("badversion");
    for (const baseVersion of [-1, 1.5, "0", null, undefined, true, 1e300, [0]]) {
      const r = await put({ baseVersion, bundle }, { cookie: c });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "baseVersion must be a non-negative integer" });
    }
    expect(storedBody(user.id)).toBeUndefined();
  });

  it("other methods are 405", async () => {
    const r = await fetch(`${base}/api/state`, { method: "POST", headers: { cookie } });
    expect(r.status).toBe(405);
    expect(r.headers.get("allow")).toBe("GET, PUT");
  });
});

describe("isBundleShape (the server's mirror of storage.ts)", () => {
  it.each(SHAPE_CASES.map((c) => [c.name, c.value, c.ok]))("%s", (_name, value, ok) => {
    expect(isBundleShape(value)).toBe(ok);
  });

  it("covers all 23 shared cases", () => {
    expect(SHAPE_CASES.length).toBe(23);
  });

  it("accepts the version-3 bundle and the version-2 export", () => {
    expect(isBundleShape(V3_BUNDLE)).toBe(true);
    expect(isBundleShape(JSON.parse(V2_EXPORT))).toBe(true);
  });

  it("agrees after a JSON round trip, as the server sees bundles", () => {
    for (const c of SHAPE_CASES) {
      if (c.value === undefined) continue;
      expect(isBundleShape(JSON.parse(JSON.stringify(c.value)))).toBe(c.ok);
    }
  });
});

describe("stateRoutes with accounts off", () => {
  it("mounts nothing", () => {
    expect(stateRoutes({ config: { accounts: null }, store: null })).toEqual([]);
  });
});
