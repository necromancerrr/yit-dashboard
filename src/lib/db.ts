import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_LOCAL_PATH = path.join(process.cwd(), "db", "local.db");

function resolveUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url && url.length > 0) return url;
  // Serverless platforms have an ephemeral, largely read-only filesystem, so
  // the local-file fallback below can't work there: mkdirSync either throws
  // EROFS or "succeeds" into a sandbox that's discarded between invocations,
  // silently losing every write. Fail loudly with the actual fix instead.
  if (process.env.VERCEL) {
    throw new Error(
      "DATABASE_URL is not set. Vercel's filesystem is ephemeral, so the local " +
        "SQLite fallback can't be used here — point DATABASE_URL at a hosted " +
        "libSQL/Turso database (and set DATABASE_AUTH_TOKEN) in the project's " +
        "Environment Variables, then redeploy."
    );
  }
  // Local/self-hosted fallback: a plain file next to the project.
  const dir = path.dirname(DEFAULT_LOCAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return `file:${DEFAULT_LOCAL_PATH}`;
}

declare global {
  var __dashboardDb: Client | undefined;
  var __dashboardDbReady: Promise<void> | undefined;
}

function getClient(): Client {
  if (!global.__dashboardDb) {
    global.__dashboardDb = createClient({
      url: resolveUrl(),
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
  }
  return global.__dashboardDb;
}

export const db = getClient();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS gym_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  workout_type TEXT NOT NULL,
  duration_min INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gym_logs_date ON gym_logs(date);

CREATE TABLE IF NOT EXISTS leetcode_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  problem_name TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'Medium',
  topic TEXT,
  url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leetcode_logs_date ON leetcode_logs(date);

CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  role TEXT,
  stage TEXT NOT NULL DEFAULT 'Applied',
  date TEXT,
  status TEXT NOT NULL DEFAULT 'Upcoming',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_interviews_date ON interviews(date);

CREATE TABLE IF NOT EXISTS school_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course TEXT NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  grade TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_school_tasks_due ON school_tasks(due_date);

CREATE TABLE IF NOT EXISTS finance_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'expense',
  category TEXT NOT NULL DEFAULT 'Other',
  amount REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_finance_date ON finance_transactions(date);

CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  recurring INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  done_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_checklist_category ON checklist_items(category);
`;

async function migrate(): Promise<void> {
  const statements = SCHEMA.split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.execute(statement);
  }
}

export function ensureDb(): Promise<void> {
  if (!global.__dashboardDbReady) {
    global.__dashboardDbReady = migrate();
  }
  return global.__dashboardDbReady;
}
