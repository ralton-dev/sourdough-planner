// readConfig's accounts rules and createApp's database wiring: /readyz and the API fallbacks.
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_FILE, closeDatabase, openDatabase } from "./db.mjs";
import { ACCOUNT_VARS, createApp, readConfig } from "./index.mjs";

const full = (over = {}) => ({
  DATA_DIR: "/data",
  APP_URL: "https://sourdough.example/",
  OIDC_ISSUER: "https://id.example/application/o/sdp/",
  OIDC_CLIENT_ID: "client",
  OIDC_CLIENT_SECRET: "secret",
  SESSION_SECRET: "x".repeat(32),
  ...over,
});

describe("readConfig accounts", () => {
  it("nothing set is accounts off", () => {
    expect(readConfig({}).accounts).toBeNull();
  });

  it("all six set is accounts on, SESSION_DAYS defaulting to 30, Secure from https", () => {
    expect(readConfig(full()).accounts).toEqual({
      dataDir: "/data",
      appUrl: "https://sourdough.example",
      issuer: "https://id.example/application/o/sdp/",
      clientId: "client",
      clientSecret: "secret",
      sessionSecret: "x".repeat(32),
      sessionDays: 30,
      secureCookies: true,
    });
    expect(readConfig(full({ APP_URL: "http://localhost:8080" })).accounts.secureCookies).toBe(
      false,
    );
    expect(readConfig(full({ SESSION_DAYS: "7" })).accounts.sessionDays).toBe(7);
  });

  it("any subset throws naming exactly the missing variables", () => {
    expect(() => readConfig({ DATA_DIR: "/data" })).toThrow(
      /missing APP_URL, OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, SESSION_SECRET\./,
    );
    for (const name of ACCOUNT_VARS) {
      const env = full({ [name]: undefined });
      if (name === "OIDC_ISSUER") delete env.OIDC_ISSUER;
      expect(() => readConfig(env)).toThrow(new RegExp(`missing ${name}\\.`));
    }
  });

  it("an empty value counts as missing, except OIDC_ISSUER empty, which switches accounts off", () => {
    expect(() => readConfig(full({ SESSION_SECRET: "" }))).toThrow(/missing SESSION_SECRET\./);
    expect(readConfig(full({ OIDC_ISSUER: "" })).accounts).toBeNull();
  });

  it("validates the secret length, the URLs and SESSION_DAYS", () => {
    expect(() => readConfig(full({ SESSION_SECRET: "x".repeat(31) }))).toThrow(/at least 32 bytes/);
    expect(readConfig(full({ SESSION_SECRET: "é".repeat(16) })).accounts).not.toBeNull();
    expect(() => readConfig(full({ APP_URL: "sourdough.example" }))).toThrow(/APP_URL must be/);
    expect(() => readConfig(full({ OIDC_ISSUER: "ftp://id.example" }))).toThrow(/OIDC_ISSUER/);
    for (const bad of ["0", "-1", "1.5", "a"]) {
      expect(() => readConfig(full({ SESSION_DAYS: bad }))).toThrow(/SESSION_DAYS/);
    }
  });
});

describe("createApp with a database", () => {
  let dir;
  let staticDir;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sdp-app-"));
    staticDir = path.join(dir, "static");
    await fs.mkdir(staticDir);
    await fs.writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>t</title>");
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function serve(env) {
    const app = createApp(readConfig({ STATIC_DIR: staticDir, ...env }));
    await app.loadIndex();
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const close = () => new Promise((r) => app.server.close(r));
    return { app, base, close };
  }

  it("accounts off opens nothing, and an unclaimed /api path is a JSON 404, not index.html", async () => {
    const { app, base, close } = await serve({});
    try {
      expect(app.store).toBeNull();
      expect((await fetch(`${base}/readyz`)).status).toBe(200);
      const r = await fetch(`${base}/api/nothing`);
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "not found" });
      expect((await fetch(`${base}/auth/login`, { method: "POST" })).status).toBe(404);
      expect((await fetch(`${base}/presets`)).status).toBe(200);
    } finally {
      await close();
    }
  });

  it("accounts on creates and migrates the file; /readyz is 200", async () => {
    const data = path.join(dir, "data");
    const { app, base, close } = await serve(full({ DATA_DIR: data }));
    try {
      expect(existsSync(path.join(data, DB_FILE))).toBe(true);
      expect(app.store).not.toBeNull();
      expect(app.dbError).toBeNull();
      const r = await fetch(`${base}/readyz`);
      expect(r.status).toBe(200);
    } finally {
      await close();
    }
  });

  it("DATA_DIR that is a file: /readyz is 503 naming the database, the API is 503", async () => {
    const file = path.join(dir, "a-file");
    await fs.writeFile(file, "x");
    const { app, base, close } = await serve(full({ DATA_DIR: file }));
    try {
      expect(app.dbError).toBeInstanceOf(Error);
      const r = await fetch(`${base}/readyz`);
      expect(r.status).toBe(503);
      expect((await r.json()).reason).toMatch(/^database: /);
      expect((await fetch(`${base}/api/state`)).status).toBe(503);
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      expect((await fetch(`${base}/`)).status).toBe(200);
    } finally {
      await close();
    }
  });

  it.skipIf(process.getuid?.() === 0)("an unwritable DATA_DIR: /readyz is 503", async () => {
    const ro = path.join(dir, "read-only");
    await fs.mkdir(ro, { mode: 0o555 });
    const { base, close } = await serve(full({ DATA_DIR: ro }));
    try {
      expect((await fetch(`${base}/readyz`)).status).toBe(503);
    } finally {
      await close();
      await fs.chmod(ro, 0o755);
    }
  });

  it("planner.sqlite that is not a database: /readyz is 503", async () => {
    const data = path.join(dir, "not-sqlite");
    await fs.mkdir(data);
    await fs.writeFile(path.join(data, DB_FILE), "not a sqlite database ".repeat(40));
    const { base, close } = await serve(full({ DATA_DIR: data }));
    try {
      expect((await fetch(`${base}/readyz`)).status).toBe(503);
    } finally {
      await close();
    }
  });

  it("a database 001 cannot migrate: /readyz is 503 naming the migration", async () => {
    const data = path.join(dir, "bad-schema");
    const pre = openDatabase(data);
    pre.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)"); // no expires_at: 001's index fails
    closeDatabase(pre);
    const { base, close } = await serve(full({ DATA_DIR: data }));
    try {
      const r = await fetch(`${base}/readyz`);
      expect(r.status).toBe(503);
      expect((await r.json()).reason).toMatch(/migration 001_init\.sql failed/);
    } finally {
      await close();
    }
  });
});
