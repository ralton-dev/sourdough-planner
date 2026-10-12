// The database: one SQLite file through Node's built-in driver (decision 40), migrated at boot
// from numbered SQL files (decision 41). Opened only when accounts are on (DATA_DIR set).
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const DB_FILE = "planner.sqlite";
export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/** `NNN_name.sql`; anything else in the folder is ignored. */
const MIGRATION_FILE = /^(\d{3}_[a-z0-9_]+)\.sql$/;

/** Opens (creating if needed) `$dataDir/planner.sqlite`: WAL, foreign keys on, 5 s busy timeout. */
export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, DB_FILE));
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

export function closeDatabase(db) {
  if (db?.isOpen) db.close();
}

/**
 * Runs `fn` inside one write transaction (BEGIN IMMEDIATE, so a concurrent writer waits on the
 * busy timeout instead of failing at COMMIT); rolls back and rethrows on any error.
 */
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Applies every `NNN_name.sql` in `dir` not yet in `schema_migrations`, in order, one transaction
 * each. Returns the ids applied this run (empty on a second run). A failing file rolls back alone
 * and throws an error naming it; the ones before it stay applied.
 */
export function migrate(db, dir = MIGRATIONS_DIR) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const done = new Set(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((r) => r.id),
  );
  const files = readdirSync(dir)
    .map((f) => MIGRATION_FILE.exec(f))
    .filter((m) => m !== null)
    .sort((a, b) => a[1].localeCompare(b[1]));
  const applied = [];
  for (const [file, id] of files) {
    if (done.has(id)) continue;
    const sql = readFileSync(path.join(dir, file), "utf8");
    try {
      transaction(db, () => {
        db.exec(sql);
        db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
          id,
          new Date().toISOString(),
        );
      });
    } catch (err) {
      throw new Error(`migration ${file} failed: ${err.message}`, { cause: err });
    }
    applied.push(id);
  }
  return applied;
}
