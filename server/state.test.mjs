// THE RED PIN (PLAN-accounts §7): the state round trip of decision 43 and its 401s, every case
// `it.fails` until P3 fills state.mjs and flips them to `it`. Today they fail on 404 (no route).
// The session is minted straight through the store and session.mjs, on a second connection to the
// same file, so this file does not depend on login (P2) or on createApp's return shape.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, migrate, openDatabase } from "./db.mjs";
import { createApp, readConfig } from "./index.mjs";
import { SESSION_COOKIE, signSessionId } from "./session.mjs";
import { createStore } from "./store.mjs";

const SECRET = "pin-".repeat(8);

/** Today's export shape by hand (storage.ts `exportBundle`, version 2); P3 mirrors the check. */
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
let cookie;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "sdp-state-"));
  const staticDir = path.join(dir, "static");
  await fs.mkdir(staticDir);
  await fs.writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>t</title>");
  const config = readConfig({
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
  const store = createStore(db, config.accounts);
  const user = store.upsertUser({ issuer: config.accounts.issuer, subject: "pin", name: "Pin" });
  const session = store.createSession(user.id);
  cookie = `${SESSION_COOKIE}=${signSessionId(session.id, SECRET)}`;
});

afterAll(async () => {
  closeDatabase(db);
  await new Promise((r) => app.server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
});

const put = (body, headers = { cookie }) =>
  fetch(`${base}/api/state`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("/api/state (red until P3)", () => {
  it.fails("PUT with baseVersion 0 stores version 1", async () => {
    const r = await put({ baseVersion: 0, bundle });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.version).toBe(1);
    expect(typeof body.updatedAt).toBe("string");
  });

  it.fails("GET returns the stored bundle", async () => {
    const r = await fetch(`${base}/api/state`, { headers: { cookie } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.version).toBe(1);
    expect(body.bundle).toEqual(bundle);
  });

  it.fails("a second PUT with baseVersion 0 is 409 carrying version 1", async () => {
    const r = await put({ baseVersion: 0, bundle: { ...bundle, presets: [{ id: "late" }] } });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.version).toBe(1);
    expect(body.bundle).toEqual(bundle);
  });

  it.fails("GET without a session is 401", async () => {
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
  });

  it.fails("PUT without a session is 401", async () => {
    expect((await put({ baseVersion: 0, bundle }, {})).status).toBe(401);
  });
});
