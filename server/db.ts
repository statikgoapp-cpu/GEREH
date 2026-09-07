import path from "path";
// @ts-ignore
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";

const dbPath = path.resolve(process.cwd(), "neural.db");
console.log("SQLite database path:", dbPath);

const sqlite = new Database(dbPath);

function ensureUsersTable() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function ensurePatternsTable() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL,
      svg_url TEXT,
      dxf_url TEXT,
      category TEXT NOT NULL DEFAULT 'pattern',
      size_code TEXT,
      real_diameter_mm REAL,
      vector_diameter_mm REAL,
      hole_diameter_mm REAL,
      status TEXT NOT NULL DEFAULT 'pending',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
}

function ensureFeedbackTable() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      page TEXT NOT NULL DEFAULT '/',
      user_agent TEXT,
      status TEXT NOT NULL DEFAULT 'NEW',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
}

function ensurePatternsColumns() {
  const columns = sqlite.prepare("PRAGMA table_info(patterns)").all() as Array<{ name: string }>;
  const names = new Set(columns.map((col) => col.name));

  const addColumn = (name: string, type: string, defaultValue?: string) => {
    if (names.has(name)) return;
    const defaultSql = defaultValue ? ` DEFAULT ${defaultValue}` : "";
    sqlite.prepare(`ALTER TABLE patterns ADD COLUMN ${name} ${type}${defaultSql}`).run();
  };

  addColumn("user_id", "INTEGER");
  addColumn("name", "TEXT", "''");
  addColumn("category", "TEXT", "'pattern'");
  addColumn("size_code", "TEXT");
  addColumn("real_diameter_mm", "REAL");
  addColumn("vector_diameter_mm", "REAL");
  addColumn("hole_diameter_mm", "REAL");
  addColumn("archived", "INTEGER", "0");
}

try {
  ensureUsersTable();
  ensurePatternsTable();
  ensurePatternsColumns();
  ensureFeedbackTable();
} catch (error) {
  console.error("Failed to ensure schema columns:", error);
}

export const db = drizzle(sqlite, { schema });
