import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, migrate, openDatabase } from "./db.mjs";
import { readConfig } from "./index.mjs";
import { parseCookies, serializeCookie } from "./router.mjs";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  readSession,
  setSessionCookie,
  signSessionId,
  verifySessionId,
} from "./session.mjs";
import { createStore } from "./store.mjs";

const SECRET = "s".repeat(32);
const env = (over = {}) => ({
  DATA_DIR: "/tmp/unused",
  APP_URL: "https://sourdough.example",
  OIDC_ISSUER: "https://id.example/application/o/sdp/",
  OIDC_CLIENT_ID: "client",
  OIDC_CLIENT_SECRET: "secret",
  SESSION_SECRET: SECRET,
  ...over,
});

/** Runs `fn(req, res)` behind a real server and returns the response. */
async function roundTrip(fn, headers = {}) {
  const server = createServer((req, res) => {
    fn(req, res);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}/`, { headers });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe("signing", () => {
  it("round-trips an id", () => {
    const signed = signSessionId("abc_-123", SECRET);
    expect(signed).toMatch(/^abc_-123\.[A-Za-z0-9_-]{43}$/);
    expect(verifySessionId(signed, SECRET)).toBe("abc_-123");
  });

  it("rejects a forged id, a wrong secret, a truncated mac and junk", () => {
    const signed = signSessionId("abc", SECRET);
    const mac = signed.slice(4);
    expect(verifySessionId(`abd.${mac}`, SECRET)).toBeNull();
    expect(verifySessionId(signed, "t".repeat(32))).toBeNull();
    expect(verifySessionId(signed.slice(0, -1), SECRET)).toBeNull();
    for (const junk of [undefined, "", "abc", ".abc", "abc.", 42]) {
      expect(verifySessionId(junk, SECRET)).toBeNull();
    }
  });
});

describe("cookie flags (decision 39)", () => {
  it("https APP_URL: Secure, HttpOnly, SameSite=Lax, Path=/, Max-Age SESSION_DAYS", async () => {
    const config = readConfig(env({ SESSION_DAYS: "7" }));
    const r = await roundTrip((_req, res) => setSessionCookie(res, "v.m", config));
    expect(r.headers.getSetCookie()).toEqual([
      `${SESSION_COOKIE}=v.m; Path=/; Max-Age=${7 * 86400}; HttpOnly; SameSite=Lax; Secure`,
    ]);
  });

  it("http APP_URL: no Secure", async () => {
    const config = readConfig(env({ APP_URL: "http://localhost:8080" }));
    const r = await roundTrip((_req, res) => setSessionCookie(res, "v.m", config));
    const [cookie] = r.headers.getSetCookie();
    expect(cookie).toMatch(/HttpOnly; SameSite=Lax$/);
    expect(cookie).not.toMatch(/Secure/);
  });

  it("clear sets an empty value with Max-Age=0 and keeps other cookies", async () => {
    const config = readConfig(env());
    const r = await roundTrip((_req, res) => {
      res.setHeader("set-cookie", "other=1");
      clearSessionCookie(res, config);
    });
    expect(r.headers.getSetCookie()).toEqual([
      "other=1",
      `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`,
    ]);
  });
});

describe("parseCookies / serializeCookie", () => {
  it("parses, decodes, keeps the first duplicate and skips junk", () => {
    expect(parseCookies('a=1; b="two"; a=3; junk; c=%7Bx%7D; d=%E0%A4%A')).toEqual({
      a: "1",
      b: "two",
      c: "{x}",
      d: "%E0%A4%A",
    });
    expect(parseCookies(undefined)).toEqual({});
  });

  it("serializes with defaults and encodes the value", () => {
    expect(serializeCookie("n", "a b;")).toBe("n=a%20b%3B; Path=/; HttpOnly; SameSite=Lax");
  });
});

describe("readSession", () => {
  let dir;
  let db;
  let store;
  let config;
  let user;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sdp-session-"));
    db = openDatabase(dir);
    migrate(db);
    config = readConfig(env({ DATA_DIR: dir }));
    store = createStore(db, config.accounts);
    user = store.upsertUser({ issuer: "https://id.example/", subject: "s", name: "Ben" });
  });

  afterEach(async () => {
    closeDatabase(db);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const req = (cookie) => ({ headers: cookie === undefined ? {} : { cookie } });

  it("returns the session and user for a good cookie, and slides it", () => {
    const s = store.createSession(user.id);
    const found = readSession(req(`x=1; ${SESSION_COOKIE}=${signSessionId(s.id, SECRET)}`), {
      config,
      store,
    });
    expect(found.user).toMatchObject({ id: user.id, name: "Ben" });
    expect(found.session.id).toBe(s.id);
    expect(found.session.lastSeenAt >= s.lastSeenAt).toBe(true);
  });

  it("re-sets the cookie when given res", async () => {
    const s = store.createSession(user.id);
    const signed = signSessionId(s.id, SECRET);
    const r = await roundTrip(
      (rq, res) => {
        expect(readSession(rq, { config, store, res })).not.toBeNull();
      },
      { cookie: `${SESSION_COOKIE}=${signed}` },
    );
    expect(r.headers.getSetCookie()[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=${signed};`));
  });

  it("is null without a cookie, with a forged one, for a deleted session, or accounts off", () => {
    const s = store.createSession(user.id);
    expect(readSession(req(undefined), { config, store })).toBeNull();
    expect(readSession(req(`${SESSION_COOKIE}=${s.id}.forged`), { config, store })).toBeNull();
    const signed = `${SESSION_COOKIE}=${signSessionId(s.id, SECRET)}`;
    expect(readSession(req(signed), { config: readConfig({}), store: null })).toBeNull();
    store.deleteSession(s.id);
    expect(readSession(req(signed), { config, store })).toBeNull();
  });
});
