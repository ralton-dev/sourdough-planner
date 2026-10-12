// Users, sessions and states over prepared statements (decision 40). This is the seam: a Postgres
// store would export the same `createStore` shape. Times are ISO strings (UTC, fixed width), so
// they compare as text.
import { randomBytes } from "node:crypto";
import { transaction } from "./db.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

const toUser = (r) =>
  r && {
    id: r.id,
    issuer: r.issuer,
    subject: r.subject,
    email: r.email,
    name: r.name,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  };

const toSession = (r) =>
  r && {
    id: r.id,
    userId: r.user_id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    lastSeenAt: r.last_seen_at,
  };

/**
 * @param db an open, migrated database (db.mjs)
 * @param opts.sessionDays sliding session lifetime (config.accounts.sessionDays)
 * @param opts.now clock, for tests
 */
export function createStore(db, { sessionDays = 30, now = () => new Date() } = {}) {
  const lifetime = sessionDays * DAY_MS;
  const iso = () => now().toISOString();
  const expiry = () => new Date(now().getTime() + lifetime).toISOString();

  const q = {
    getUser: db.prepare("SELECT * FROM users WHERE id = ?"),
    upsertUser: db.prepare(
      `INSERT INTO users (issuer, subject, email, name, created_at, last_seen_at)
       VALUES (:issuer, :subject, :email, :name, :now, :now)
       ON CONFLICT (issuer, subject) DO UPDATE SET
         email = excluded.email, name = excluded.name, last_seen_at = excluded.last_seen_at
       RETURNING *`,
    ),
    seeUser: db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?"),
    createSession: db.prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
    ),
    getSession: db.prepare("SELECT * FROM sessions WHERE id = ? AND expires_at > ?"),
    sweepSessions: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
    touchSession: db.prepare(
      "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ? RETURNING *",
    ),
    deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
    getState: db.prepare("SELECT version, updated_at, body FROM states WHERE user_id = ?"),
    putState: db.prepare(
      `INSERT INTO states (user_id, version, updated_at, body) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         version = excluded.version, updated_at = excluded.updated_at, body = excluded.body`,
    ),
  };

  const readState = (userId) => {
    const r = q.getState.get(userId);
    return r ? { version: r.version, updatedAt: r.updated_at, bundle: JSON.parse(r.body) } : null;
  };

  return {
    /** The user, or null. */
    getUser(id) {
      return toUser(q.getUser.get(id)) ?? null;
    },

    /** Creates or refreshes the user keyed by issuer + subject (decision 42); returns it. */
    upsertUser({ issuer, subject, email = null, name = null }) {
      return toUser(q.upsertUser.get({ issuer, subject, email, name, now: iso() }));
    },

    /** A new session for the user: 32 random bytes, base64url, expiring `sessionDays` from now. */
    createSession(userId) {
      const at = iso();
      const id = randomBytes(32).toString("base64url");
      return toSession(q.createSession.get(id, userId, at, expiry(), at));
    },

    /** The live session, or null when missing or expired. Read-only: does not slide. */
    getSession(id) {
      return toSession(q.getSession.get(id, iso())) ?? null;
    },

    /**
     * Sweeps every expired session, then slides this one (expires `sessionDays` from now) and marks
     * its user seen. Returns `{ session, user }`, or null when it is missing or had expired.
     */
    touchSession(id) {
      return transaction(db, () => {
        const at = iso();
        q.sweepSessions.run(at);
        const row = q.touchSession.get(at, expiry(), id);
        if (!row) return null;
        q.seeUser.run(at, row.user_id);
        return { session: toSession(row), user: toUser(q.getUser.get(row.user_id)) };
      });
    },

    /** True when a session was deleted. */
    deleteSession(id) {
      return q.deleteSession.run(id).changes > 0;
    },

    /** `{ version, updatedAt, bundle }`, or null when the user has stored nothing. */
    getState(userId) {
      return readState(userId);
    },

    /**
     * Stores `bundle` (any JSON value; the caller checks its shape) when `baseVersion` equals the
     * stored version (0 when none is stored), bumping the version, in one transaction.
     * Returns `{ ok: true, version, updatedAt }`, or `{ ok: false, current }` where `current` is the
     * stored `{ version, updatedAt, bundle }` (version 0, nulls when none is stored).
     */
    putState(userId, baseVersion, bundle) {
      return transaction(db, () => {
        const current = readState(userId);
        const version = current?.version ?? 0;
        if (baseVersion !== version) {
          return { ok: false, current: current ?? { version: 0, updatedAt: null, bundle: null } };
        }
        const updatedAt = iso();
        q.putState.run(userId, version + 1, updatedAt, JSON.stringify(bundle));
        return { ok: true, version: version + 1, updatedAt };
      });
    },
  };
}
