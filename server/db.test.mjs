import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DB_FILE, MIGRATIONS_DIR, closeDatabase, migrate, openDatabase } from "./db.mjs";

let dir;
let db;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "sdp-db-"));
});

afterEach(async () => {
  closeDatabase(db);
  db = null;
  await fs.rm(dir, { recursive: true, force: true });
});

const tables = (d) =>
  d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => r.name);

describe("openDatabase", () => {
  it("creates the file with WAL, foreign keys and a busy timeout", () => {
    db = openDatabase(path.join(dir, "nested"));
    expect(existsSync(path.join(dir, "nested", DB_FILE))).toBe(true);
    expect(db.prepare("PRAGMA journal_mode").get().journal_mode).toBe("wal");
    expect(db.prepare("PRAGMA foreign_keys").get().foreign_keys).toBe(1);
    expect(db.prepare("PRAGMA busy_timeout").get().timeout).toBe(5000);
  });

  it("throws when the directory is a file", async () => {
    const file = path.join(dir, "file");
    await fs.writeFile(file, "x");
    expect(() => openDatabase(file)).toThrow();
  });
});

describe("migrate", () => {
  it("applies 001 and records it; a second run is a no-op", () => {
    db = openDatabase(dir);
    expect(migrate(db)).toEqual(["001_init"]);
    expect(tables(db)).toEqual(["schema_migrations", "sessions", "states", "users"]);
    const before = db.prepare("SELECT * FROM schema_migrations").all();
    expect(migrate(db)).toEqual([]);
    expect(db.prepare("SELECT * FROM schema_migrations").all()).toEqual(before);
  });

  it("re-running a migration's SQL on a migrated database changes nothing (idempotent)", async () => {
    db = openDatabase(dir);
    migrate(db);
    const schema = () => db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all();
    const before = schema();
    for (const f of await fs.readdir(MIGRATIONS_DIR)) {
      db.exec(await fs.readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
    }
    expect(schema()).toEqual(before);
  });

  it("no migration drops, deletes or truncates (decision 41)", async () => {
    for (const f of await fs.readdir(MIGRATIONS_DIR)) {
      const sql = (await fs.readFile(path.join(MIGRATIONS_DIR, f), "utf8"))
        .replace(/--.*$/gm, "")
        .replace(/ON\s+DELETE/gi, "");
      expect(sql, f).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
    }
  });

  it("a bad SQL file fails loudly, naming it, and rolls back alone", async () => {
    const mig = path.join(dir, "migrations");
    await fs.mkdir(mig);
    await fs.copyFile(path.join(MIGRATIONS_DIR, "001_init.sql"), path.join(mig, "001_init.sql"));
    await fs.writeFile(
      path.join(mig, "002_bad.sql"),
      "CREATE TABLE IF NOT EXISTS half (id INTEGER);\nCREATE TABLE oops (;",
    );
    await fs.writeFile(path.join(mig, "README.txt"), "ignored");
    db = openDatabase(path.join(dir, "data"));
    expect(() => migrate(db, mig)).toThrow(/migration 002_bad\.sql failed/);
    expect(tables(db)).not.toContain("half");
    expect(
      db
        .prepare("SELECT id FROM schema_migrations")
        .all()
        .map((r) => r.id),
    ).toEqual(["001_init"]);
    expect(db.isTransaction).toBe(false);
  });

  it("applies files in numeric order", async () => {
    const mig = path.join(dir, "migrations");
    await fs.mkdir(mig);
    await fs.writeFile(
      path.join(mig, "002_b.sql"),
      "CREATE TABLE IF NOT EXISTS b (a REFERENCES a(id));",
    );
    await fs.writeFile(
      path.join(mig, "001_a.sql"),
      "CREATE TABLE IF NOT EXISTS a (id INTEGER PRIMARY KEY);",
    );
    db = openDatabase(path.join(dir, "data"));
    expect(migrate(db, mig)).toEqual(["001_a", "002_b"]);
  });
});
