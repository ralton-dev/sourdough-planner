// Login, logout and /api/me over HTTP against the fake issuer (PLAN-accounts P2, §9's awkward
// shapes). Each `rig` is an app on a temp DATA_DIR pointed at its own fake issuer.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase } from "./db.mjs";
import { startFakeIssuer } from "./fake-issuer.mjs";
import { createApp, readConfig } from "./index.mjs";
import { SESSION_COOKIE, signSessionId } from "./session.mjs";
import { createStore } from "./store.mjs";

const SECRET = "auth-test-".repeat(4);
const rigs = [];

async function rig({ appUrl = "http://127.0.0.1:8080", issuer, accounts = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sdp-auth-"));
  const staticDir = path.join(dir, "static");
  await fs.mkdir(staticDir);
  await fs.writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>t</title>");
  const fake = issuer ?? (accounts ? await startFakeIssuer() : null);
  const env = { STATIC_DIR: staticDir };
  if (accounts) {
    Object.assign(env, {
      DATA_DIR: path.join(dir, "data"),
      APP_URL: appUrl,
      OIDC_ISSUER: fake.issuer,
      OIDC_CLIENT_ID: fake.clientId,
      OIDC_CLIENT_SECRET: fake.clientSecret,
      SESSION_SECRET: SECRET,
    });
  }
  const config = readConfig(env);
  const app = createApp(config);
  await app.loadIndex();
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const db = accounts ? openDatabase(config.accounts.dataDir) : null;
  const r = { dir, fake, config, app, base, db };
  rigs.push(r);
  return r;
}

afterAll(async () => {
  for (const r of rigs) {
    closeDatabase(r.db);
    await new Promise((done) => r.app.server.close(done));
    await r.fake?.close();
    await fs.rm(r.dir, { recursive: true, force: true });
  }
});

const get = (url, headers = {}) => fetch(url, { redirect: "manual", headers });
const cookieNamed = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const pair = (setCookie) => setCookie.split(";")[0];

/** /auth/login → the issuer's /authorize → the callback URL, rebased onto the app under test. */
async function startLogin(r) {
  const login = await get(`${r.base}/auth/login`);
  const loginCookie = cookieNamed(login, "sdp_login");
  const authorize = new URL(login.headers.get("location"));
  const back = await get(authorize);
  const cb = new URL(back.headers.get("location"));
  return { login, loginCookie, authorize, callback: `${r.base}${cb.pathname}${cb.search}`, cb };
}

async function signIn(r) {
  const s = await startLogin(r);
  const res = await get(s.callback, { cookie: pair(s.loginCookie) });
  return { ...s, res, session: cookieNamed(res, SESSION_COOKIE) };
}

describe("accounts off", () => {
  let r;
  beforeAll(async () => {
    r = await rig({ accounts: false });
  });

  it("/api/me is { enabled: false }, cacheable for an hour", async () => {
    const res = await get(`${r.base}/api/me`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("max-age=3600");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it("/auth/* is not mounted", async () => {
    for (const p of ["/auth/login", "/auth/callback"]) {
      expect((await get(`${r.base}${p}`)).status).toBe(404);
    }
    expect((await fetch(`${r.base}/auth/logout`, { method: "POST" })).status).toBe(404);
  });
});

describe("sign in and out", () => {
  let r;
  beforeAll(async () => {
    r = await rig();
  });

  it("/api/me before sign-in is { enabled: true }, not cached", async () => {
    const res = await get(`${r.base}/api/me`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ enabled: true });
  });

  it("/auth/login redirects to the issuer with state, nonce and an S256 PKCE challenge", async () => {
    const res = await get(`${r.base}/auth/login`);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location"));
    expect(`${to.origin}${to.pathname}`).toBe(`${r.fake.issuer}authorize`);
    const q = to.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe(r.fake.clientId);
    expect(q.get("redirect_uri")).toBe("http://127.0.0.1:8080/auth/callback");
    expect(q.get("scope")).toBe("openid profile email");
    expect(q.get("state")).toMatch(/^[\w-]{20,}$/);
    expect(q.get("nonce")).toMatch(/^[\w-]{20,}$/);
    expect(q.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(q.get("code_challenge_method")).toBe("S256");
    const cookie = cookieNamed(res, "sdp_login");
    expect(cookie).toMatch(/; Path=\/auth; Max-Age=600; HttpOnly; SameSite=Lax$/);
    // The verifier and nonce ride in the cookie, never in the URL.
    expect(cookie).not.toContain(q.get("state"));
  });

  it("a callback with a wrong or missing state, or no login cookie, is 400", async () => {
    const s = await startLogin(r);
    const wrong = new URL(s.callback);
    wrong.searchParams.set("state", "forged");
    expect((await get(wrong, { cookie: pair(s.loginCookie) })).status).toBe(400);
    const none = new URL(s.callback);
    none.searchParams.delete("state");
    expect((await get(none, { cookie: pair(s.loginCookie) })).status).toBe(400);
    const res = await get(s.callback);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
    // A tampered login cookie is as good as none.
    expect((await get(s.callback, { cookie: `${pair(s.loginCookie)}x` })).status).toBe(400);
  });

  it("a good callback sets the session cookie, clears the login cookie, and stores user and session", async () => {
    const { res, session } = await signIn(r);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(session).toMatch(/; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/);
    expect(session).not.toContain("Secure");
    expect(cookieNamed(res, "sdp_login")).toMatch(/^sdp_login=; Path=\/auth; Max-Age=0;/);
    const users = r.db.prepare("SELECT issuer, subject, email, name FROM users").all();
    expect(users.map((u) => ({ ...u }))).toEqual([
      {
        issuer: r.fake.issuer,
        subject: "fake-user-1",
        email: "baker@example.test",
        name: "Test Baker",
      },
    ]);
    const id = decodeURIComponent(pair(session).split("=")[1]).split(".")[0];
    expect(r.db.prepare("SELECT user_id FROM sessions WHERE id = ?").get(id)).toBeTruthy();
  });

  it("a code replayed after sign-in is not a second session", async () => {
    const s = await startLogin(r);
    const ok = await get(s.callback, { cookie: pair(s.loginCookie) });
    expect(ok.status).toBe(303);
    const again = await get(s.callback, { cookie: pair(s.loginCookie) });
    expect(again.status).toBe(502);
    // A failed exchange drops the cached discovery; the next sign-in fetches it again.
    const before = r.fake.hits.discovery;
    await get(`${r.base}/auth/login`);
    expect(r.fake.hits.discovery).toBe(before + 1);
  });

  it("/api/me shows the signed-in user and slides the cookie", async () => {
    const { session } = await signIn(r);
    const res = await get(`${r.base}/api/me`, { cookie: pair(session) });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      enabled: true,
      user: { name: "Test Baker", email: "baker@example.test" },
    });
    expect(cookieNamed(res, SESSION_COOKIE)).toBe(session);
  });

  it("signing in again replaces this browser's session", async () => {
    const first = await signIn(r);
    const s = await startLogin(r);
    const res = await get(s.callback, { cookie: `${pair(s.loginCookie)}; ${pair(first.session)}` });
    expect(res.status).toBe(303);
    const me = await get(`${r.base}/api/me`, { cookie: pair(first.session) });
    expect(await me.json()).toEqual({ enabled: true });
  });

  it("logout deletes the session, clears the cookie and goes to the end-session URL", async () => {
    const { session } = await signIn(r);
    const id = decodeURIComponent(pair(session).split("=")[1]).split(".")[0];
    const res = await fetch(`${r.base}/auth/logout`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: pair(session), "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location"));
    expect(`${to.origin}${to.pathname}`).toBe(`${r.fake.issuer}end-session`);
    expect(to.searchParams.get("post_logout_redirect_uri")).toBe("http://127.0.0.1:8080/");
    expect(to.searchParams.get("client_id")).toBe(r.fake.clientId);
    expect(cookieNamed(res, SESSION_COOKIE)).toMatch(/^sdp_session=; Path=\/; Max-Age=0;/);
    expect(r.db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(id)).toBeUndefined();
    const me = await get(`${r.base}/api/me`, { cookie: pair(session) });
    expect(await me.json()).toEqual({ enabled: true });
    // The issuer sends the browser home.
    const home = await get(to);
    expect(home.headers.get("location")).toBe("http://127.0.0.1:8080/");
  });

  it("a forged cookie shows no user", async () => {
    const { session } = await signIn(r);
    const id = decodeURIComponent(pair(session).split("=")[1]).split(".")[0];
    for (const cookie of [
      `${SESSION_COOKIE}=${id}.forged`,
      `${SESSION_COOKIE}=${signSessionId(id, "another-secret-".repeat(3))}`,
      `${SESSION_COOKIE}=${id}`,
    ]) {
      const res = await get(`${r.base}/api/me`, { cookie });
      expect(await res.json()).toEqual({ enabled: true });
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it("an expired session shows no user", async () => {
    const past = createStore(r.db, { sessionDays: 1, now: () => new Date(Date.now() - 2 * 864e5) });
    const user = past.upsertUser({ issuer: r.fake.issuer, subject: "old", name: "Old" });
    const s = past.createSession(user.id);
    const res = await get(`${r.base}/api/me`, {
      cookie: `${SESSION_COOKIE}=${signSessionId(s.id, SECRET)}`,
    });
    expect(await res.json()).toEqual({ enabled: true });
  });
});

describe("Secure cookies when APP_URL is https", () => {
  it("sets Secure on sdp_login and sdp_session", async () => {
    const r = await rig({ appUrl: "https://sourdough.example" });
    const { loginCookie, res, session } = await signIn(r);
    expect(loginCookie).toMatch(/; Secure$/);
    expect(res.status).toBe(303);
    expect(session).toMatch(/; HttpOnly; SameSite=Lax; Secure$/);
    expect(session).toMatch(/; Path=\/;/);
  });
});

describe("the awkward shapes (§9)", () => {
  it("error=access_denied on the callback goes home with ?signin=denied", async () => {
    const r = await rig();
    r.fake.setDeny(true);
    const s = await startLogin(r);
    expect(s.cb.searchParams.get("error")).toBe("access_denied");
    const res = await get(s.callback, { cookie: pair(s.loginCookie) });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?signin=denied");
    expect(cookieNamed(res, "sdp_login")).toMatch(/Max-Age=0/);
    expect(cookieNamed(res, SESSION_COOKIE)).toBeUndefined();
    const other = new URL(s.callback);
    other.searchParams.set("error", "server_error");
    expect((await get(other)).headers.get("location")).toBe("/?signin=error");
    r.fake.setDeny(false);
    expect((await signIn(r)).res.status).toBe(303);
  });

  it("an issuer down at login is 502, and discovery is retried on the next request", async () => {
    const fake = await startFakeIssuer();
    const port = new URL(fake.url).port;
    await fake.close();
    const r = await rig({ issuer: fake });
    const res = await get(`${r.base}/auth/login`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: expect.any(String) });
    expect(res.headers.getSetCookie()).toEqual([]);
    // Logout still signs out locally when the issuer is down.
    const out = await fetch(`${r.base}/auth/logout`, { method: "POST", redirect: "manual" });
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/");
    // The issuer comes back on the same port: the failure was not cached.
    const back = await startFakeIssuer({ port: Number(port) });
    r.fake = back;
    const again = await get(`${r.base}/auth/login`);
    expect(again.status).toBe(302);
    expect(back.hits.discovery).toBe(1);
  });

  it("an issuer down at token exchange is 502 and nothing is stored", async () => {
    const r = await rig();
    const s = await startLogin(r);
    await r.fake.close();
    const res = await get(s.callback, { cookie: pair(s.loginCookie) });
    expect(res.status).toBe(502);
    expect(cookieNamed(res, SESSION_COOKIE)).toBeUndefined();
    expect(r.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n).toBe(0);
    r.fake = null;
  });

  it("keys rotated between discovery and callback, or between sign-ins, do not break sign-in", async () => {
    const r = await rig();
    const s = await startLogin(r); // discovery done
    r.fake.rotateKeys();
    expect((await get(s.callback, { cookie: pair(s.loginCookie) })).status).toBe(303);
    r.fake.rotateKeys();
    expect((await signIn(r)).res.status).toBe(303);
    // Why: the ID token comes from the token endpoint over the issuer's TLS, and openid-client
    // checks its claims (iss, aud, exp, nonce) without the JWKS. If enableNonRepudiationChecks is
    // ever turned on, the JWKS joins the path and this test must grow the 60 s cooldown case.
    expect(r.fake.hits.jwks).toBe(0);
    expect(r.fake.hits.discovery).toBe(1);
  });

  it("a code minted for another login (its PKCE challenge and nonce) is 502", async () => {
    const r = await rig();
    const a = await startLogin(r);
    const b = await startLogin(r);
    // b's code (minted for b's nonce) with a's state in the URL and a's cookie.
    const crossed = new URL(b.callback);
    crossed.searchParams.set("state", new URL(a.callback).searchParams.get("state"));
    expect((await get(crossed, { cookie: pair(a.loginCookie) })).status).toBe(502);
  });

  it("an http issuer off this machine is refused at startup", async () => {
    const env = {
      DATA_DIR: path.join(os.tmpdir(), "sdp-auth-never"),
      APP_URL: "https://sourdough.example",
      OIDC_ISSUER: "http://id.example/application/o/sdp/",
      OIDC_CLIENT_ID: "c",
      OIDC_CLIENT_SECRET: "s",
      SESSION_SECRET: SECRET,
    };
    const { authRoutes } = await import("./auth.mjs");
    expect(() => authRoutes({ config: readConfig(env), store: null })).toThrow(/must be https/);
  });
});
