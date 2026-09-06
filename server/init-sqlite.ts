import path from "path";
import Database from "better-sqlite3";

const dbPath = path.resolve(process.cwd(), "neural.db");
console.log("INIT DB PATH:", dbPath);

const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

console.log("SQLite table is ready.");
process.exit(0);
