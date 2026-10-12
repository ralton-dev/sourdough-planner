import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, migrate, openDatabase } from "./db.mjs";
import { createStore } from "./store.mjs";

const DAY = 24 * 60 * 60 * 1000;
let dir;
let db;
let clock;
let store;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "sdp-store-"));
  db = openDatabase(dir);
  migrate(db);
  clock = new Date("2026-10-12T09:00:00.000Z");
  store = createStore(db, { sessionDays: 30, now: () => clock });
});

afterEach(async () => {
  closeDatabase(db);
  await fs.rm(dir, { recursive: true, force: true });
});

const later = (ms) => {
  clock = new Date(clock.getTime() + ms);
};

const ben = { issuer: "https://id.example/", subject: "abc", email: "b@example.com", name: "Ben" };

describe("users", () => {
  it("upserts by issuer + subject, refreshing email, name and last seen", () => {
    const a = store.upsertUser(ben);
    expect(a).toMatchObject({ ...ben, createdAt: clock.toISOString() });
    later(1000);
    const b = store.upsertUser({ ...ben, email: "new@example.com", name: "Benjamin" });
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ email: "new@example.com", name: "Benjamin" });
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.lastSeenAt).toBe(clock.toISOString());
    expect(store.getUser(a.id)).toEqual(b);
  });

  it("the same subject at another issuer is another user", () => {
    const a = store.upsertUser(ben);
    const b = store.upsertUser({ ...ben, issuer: "https://other.example/" });
    expect(b.id).not.toBe(a.id);
  });

  it("email and name are optional; an unknown id is null", () => {
    expect(store.upsertUser({ issuer: "i", subject: "s" })).toMatchObject({
      email: null,
      name: null,
    });
    expect(store.getUser(999)).toBeNull();
  });
});

describe("sessions", () => {
  it("creates a 32-byte base64url id expiring SESSION_DAYS from now", () => {
    const u = store.upsertUser(ben);
    const s = store.createSession(u.id);
    expect(s.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s).toMatchObject({ userId: u.id, createdAt: clock.toISOString() });
    expect(Date.parse(s.expiresAt) - clock.getTime()).toBe(30 * DAY);
    expect(store.getSession(s.id)).toEqual(s);
    expect(store.createSession(u.id).id).not.toBe(s.id);
  });

  it("touch slides the expiry and returns the user; getSession does not slide", () => {
    const u = store.upsertUser(ben);
    const s = store.createSession(u.id);
    later(10 * DAY);
    expect(store.getSession(s.id).expiresAt).toBe(s.expiresAt);
    const t = store.touchSession(s.id);
    expect(t.user).toMatchObject({ id: u.id, name: "Ben", lastSeenAt: clock.toISOString() });
    expect(t.session.lastSeenAt).toBe(clock.toISOString());
    expect(Date.parse(t.session.expiresAt) - clock.getTime()).toBe(30 * DAY);
  });

  it("expires by expires_at, and touch sweeps every expired session", () => {
    const u = store.upsertUser(ben);
    const old = store.createSession(u.id);
    later(20 * DAY);
    const fresh = store.createSession(u.id);
    later(10 * DAY); // old is exactly 30 days: expired
    expect(store.getSession(old.id)).toBeNull();
    expect(store.touchSession(old.id)).toBeNull();
    expect(
      db
        .prepare("SELECT id FROM sessions")
        .all()
        .map((r) => r.id),
    ).toEqual([fresh.id]);
    expect(store.touchSession(fresh.id)).not.toBeNull();
  });

  it("deletes; deleting twice says so; an unknown id is null", () => {
    const u = store.upsertUser(ben);
    const s = store.createSession(u.id);
    expect(store.deleteSession(s.id)).toBe(true);
    expect(store.deleteSession(s.id)).toBe(false);
    expect(store.getSession(s.id)).toBeNull();
    expect(store.touchSession("nope")).toBeNull();
  });

  it("a session for an unknown user is refused (foreign keys on)", () => {
    expect(() => store.createSession(12345)).toThrow(/FOREIGN KEY/);
  });
});

describe("states", () => {
  const bundle = { app: "sourdough-planner", version: 2, presets: [{ id: "p" }] };

  it("none stored is null", () => {
    expect(store.getState(store.upsertUser(ben).id)).toBeNull();
  });

  it("put with baseVersion 0 stores version 1; get returns it", () => {
    const u = store.upsertUser(ben);
    expect(store.putState(u.id, 0, bundle)).toEqual({
      ok: true,
      version: 1,
      updatedAt: clock.toISOString(),
    });
    expect(store.getState(u.id)).toEqual({ version: 1, updatedAt: clock.toISOString(), bundle });
  });

  it("a stale baseVersion is a conflict carrying the stored document, and writes nothing", () => {
    const u = store.upsertUser(ben);
    store.putState(u.id, 0, bundle);
    const stored = store.getState(u.id);
    later(1000);
    expect(store.putState(u.id, 0, { other: true })).toEqual({ ok: false, current: stored });
    expect(store.putState(u.id, 2, { other: true })).toEqual({ ok: false, current: stored });
    expect(store.getState(u.id)).toEqual(stored);
    expect(store.putState(u.id, 1, { next: true })).toMatchObject({ ok: true, version: 2 });
    expect(store.getState(u.id)).toMatchObject({ version: 2, bundle: { next: true } });
  });

  it("a non-zero baseVersion with nothing stored is a conflict at version 0", () => {
    const u = store.upsertUser(ben);
    expect(store.putState(u.id, 3, bundle)).toEqual({
      ok: false,
      current: { version: 0, updatedAt: null, bundle: null },
    });
  });

  it("users do not share state", () => {
    const a = store.upsertUser(ben);
    const b = store.upsertUser({ ...ben, subject: "other" });
    store.putState(a.id, 0, bundle);
    expect(store.getState(b.id)).toBeNull();
    expect(store.putState(b.id, 0, { b: true })).toMatchObject({ ok: true, version: 1 });
  });
});
