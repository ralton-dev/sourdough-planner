import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, readConfig } from "./index.mjs";

let dir;
let base;
let server;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "sdp-"));
  await fs.mkdir(path.join(dir, "assets"));
  await fs.writeFile(path.join(dir, "index.html"), "<!doctype html><title>t</title>");
  await fs.writeFile(path.join(dir, "assets", "a.js"), "console.log(1)");
  const app = createApp(readConfig({ APP_VERSION: "sha-test", STATIC_DIR: dir }));
  server = app.server;
  await app.loadIndex();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
});

describe("config", () => {
  it("defaults", () => {
    const c = readConfig({});
    expect(c.port).toBe(8080);
    expect(c.host).toBe("0.0.0.0");
    expect(c.version).toBe("dev");
  });
  it("fails loudly on a bad PORT", () => {
    expect(() => readConfig({ PORT: "http" })).toThrow(/PORT must be an integer/);
  });
});

describe("routes", () => {
  it("healthz reports the version", async () => {
    const r = await fetch(`${base}/healthz`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ok", version: "sha-test" });
  });
  it("readyz is ready when the bundle exists", async () => {
    const r = await fetch(`${base}/readyz`);
    expect(r.status).toBe(200);
  });
  it("serves assets immutable and falls back to index for routes", async () => {
    const a = await fetch(`${base}/assets/a.js`);
    expect(a.headers.get("cache-control")).toMatch(/immutable/);
    expect(await a.text()).toBe("console.log(1)");
    const spa = await fetch(`${base}/presets`);
    expect(spa.status).toBe(200);
    expect(spa.headers.get("content-type")).toMatch(/text\/html/);
    const missing = await fetch(`${base}/assets/nope.js`);
    expect(missing.status).toBe(404);
  });
  it("blocks traversal and non-GET", async () => {
    const t = await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`);
    expect([403, 404, 200]).toContain(t.status);
    expect(await t.text()).not.toMatch(/root:/);
    const p = await fetch(`${base}/healthz`, { method: "POST" });
    expect(p.status).toBe(405);
  });
});

describe("readiness without a bundle", () => {
  it("returns 503", async () => {
    const app = createApp(readConfig({ STATIC_DIR: path.join(dir, "missing") }));
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    const r = await fetch(`http://127.0.0.1:${app.server.address().port}/readyz`);
    expect(r.status).toBe(503);
    await new Promise((res) => app.server.close(res));
  });
});
