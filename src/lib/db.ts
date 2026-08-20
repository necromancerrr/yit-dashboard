import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_LOCAL_PATH = path.join(process.cwd(), "db", "local.db");

function resolveUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url && url.length > 0) return url;
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

-- Permanent log of every day a checklist item was completed. The done/done_date
-- columns above are only *current* state (and get cleared when a recurring
-- habit rolls over to a new day), so history lives here instead — that's what
-- the activity heatmap reads.
CREATE TABLE IF NOT EXISTS checklist_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  UNIQUE(item_id, date)
);
CREATE INDEX IF NOT EXISTS idx_checklist_completions_date ON checklist_completions(date);

-- Registered passkeys (WebAuthn credentials) for biometric sign-in.
-- Note what is NOT here: no fingerprint, no face data, no password. Only the
-- PUBLIC half of a keypair whose private half never leaves the device. A dump
-- of this table lets an attacker verify signatures, never create them.
CREATE TABLE IF NOT EXISTS passkeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  label TEXT NOT NULL DEFAULT 'Device',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_passkeys_credential ON passkeys(credential_id);

-- Backfill for databases created before the completions table existed: seed it
-- from whatever done_date each item is currently carrying. Idempotent (the
-- UNIQUE constraint plus OR IGNORE), so it is safe to re-run on every boot.
INSERT OR IGNORE INTO checklist_completions (item_id, date)
  SELECT id, done_date FROM checklist_items WHERE done = 1 AND done_date IS NOT NULL;
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
