import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { classifyDeterministic } from "@/lib/ingest/classify";
import { parseSender, senderDomain } from "@/lib/ingest/normalize";
import { TRUST_PROMOTION } from "@/lib/autonomy/policy";
import type { ApplicationStatus } from "@/lib/types";

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

-- Crypto holdings. Deliberately stores the QUANTITY you own, never a dollar
-- value: a stored value is stale the moment it is written. Worth is always
-- derived as quantity x live price at read time.
--
-- coin_id is the price provider's identifier (e.g. "ethereum"). It is resolved
-- from the symbol on first use and cached here, because symbols are ambiguous
-- across chains and an id is not.
-- A screenshot handed over by the OS share sheet, held only long enough for
-- the page to pick it up. A share target is a POST from outside the app, so
-- there is no way to pass the bytes to a client component except through
-- somewhere both sides can see. Rows are deleted on read, and any stragglers
-- are swept on the next share.
CREATE TABLE IF NOT EXISTS shared_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crypto_holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  coin_id TEXT,
  quantity REAL NOT NULL,
  staked_pct INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crypto_symbol ON crypto_holdings(symbol);

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

-- Records which one-time data migrations have run. Everything above is a
-- CREATE ... IF NOT EXISTS or an idempotent INSERT OR IGNORE, safe to re-run on
-- every boot. A *backfill* is different: re-running one resurrects rows the
-- user has since deleted. Those go through runOnce() instead, keyed here.
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Career
-- ---------------------------------------------------------------------------

-- One row per application: a company + role you are pursuing. This is the
-- entity; status is only a cached projection of application_events (see
-- src/lib/career.ts). Never UPDATE status directly — go through applyEvent(),
-- which appends the event and refreshes this column in the same batch, so the
-- history can always explain the current state.
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  role TEXT,
  status TEXT NOT NULL DEFAULT 'Applied',
  applied_date TEXT,
  -- The single date that matters next: an OA deadline, a scheduled interview.
  next_action_date TEXT,
  next_action_label TEXT,
  location TEXT,
  url TEXT,
  notes TEXT,
  -- Where this row came from: 'manual', or a provider like 'gmail'.
  source TEXT NOT NULL DEFAULT 'manual',
  -- Set to 1 once you change the status by hand. A record that you did, not a
  -- gate: whether inference may act is decided from application_events dates,
  -- so touching an application never disables its automation for good.
  status_locked INTEGER NOT NULL DEFAULT 0,
  -- Date of the most recent event, so "nothing has moved in 16 days" is a
  -- plain column comparison rather than a correlated subquery per row.
  last_activity_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_next_action ON applications(next_action_date);

-- Append-only history. Rows are never updated or deleted (except by cascade
-- when the application goes), because this is the audit trail that explains
-- every status the application has ever held — including a wrong one an
-- ingestion proposed and you later corrected.
CREATE TABLE IF NOT EXISTS application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  -- 'created' | 'status_change' | 'note' | 'deadline'
  kind TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  occurred_on TEXT NOT NULL,
  detail TEXT,
  -- 'manual' | 'gmail' | 'ai' — how this transition was decided.
  source TEXT NOT NULL DEFAULT 'manual',
  external_event_id INTEGER,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_application_events_app ON application_events(application_id, occurred_on);

-- ---------------------------------------------------------------------------
-- Ingestion + Inbox
-- ---------------------------------------------------------------------------

-- A connected external account (Gmail, later others). Deliberately stores NO
-- OAuth tokens: credentials belong in the platform's secret store, not in a
-- table that /api/export dumps to a downloadable file. cursor is the
-- provider's own resume point, so a sync processes only new messages.
CREATE TABLE IF NOT EXISTS integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'disconnected',
  account_label TEXT,
  cursor TEXT,
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A normalized message the system has seen. Only the metadata needed to
-- classify and explain a decision is stored — subject, sender, a short
-- snippet. Never the full body: this database is a personal dashboard, not an
-- inbox mirror, and a leak should not cost you your email.
--
-- UNIQUE(provider, provider_message_id) is the deduplication boundary: the
-- same recruiter reminder delivered twice, or a message seen again after a
-- cursor rewind, collapses to one row rather than one event per delivery.
CREATE TABLE IF NOT EXISTS external_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER,
  provider TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  thread_id TEXT,
  occurred_at TEXT,
  subject TEXT,
  sender TEXT,
  snippet TEXT,
  -- 'pending' | 'processed' | 'ignored' | 'failed'
  processing_status TEXT NOT NULL DEFAULT 'pending',
  classification TEXT,
  confidence REAL,
  error TEXT,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  UNIQUE(provider, provider_message_id)
);
CREATE INDEX IF NOT EXISTS idx_external_events_status ON external_events(processing_status);
CREATE INDEX IF NOT EXISTS idx_external_events_thread ON external_events(thread_id);

-- The Yit OS inbox: things the system noticed and thinks deserve a look.
-- Some are derived from data already here (an application that has not moved);
-- later, some will be proposals from ingestion awaiting confirmation.
--
-- dedupe_key is what stops the system from nagging: one open item per real
-- situation, regenerated rather than duplicated on each sweep.
CREATE TABLE IF NOT EXISTS inbox_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  application_id INTEGER,
  external_event_id INTEGER,
  proposed_status TEXT,
  proposed_company TEXT,
  proposed_role TEXT,
  proposed_next_action_date TEXT,
  confidence REAL,
  -- 'open' | 'confirmed' | 'dismissed'
  state TEXT NOT NULL DEFAULT 'open',
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_inbox_state ON inbox_items(state, created_at);

-- Every write the sync made on its own, with enough recorded to explain it and
-- to take it back. This is what makes acting unattended defensible: without a
-- journal, an automatic write is indistinguishable from one you made and
-- forgot, and there is nothing to undo it with.
CREATE TABLE IF NOT EXISTS automation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  tier TEXT NOT NULL,
  action TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  external_event_id INTEGER,
  summary TEXT NOT NULL,
  because TEXT NOT NULL,
  -- The sender domain that authorised this, so undo can demote it without a
  -- join and the digest can name the rule that fired.
  scope_key TEXT,
  -- Set once, when an edit to the written row is first noticed. A correction
  -- must count exactly once, however many times the digest is read.
  edited_at TEXT,
  payload TEXT NOT NULL,
  -- Hash of the fields as written. Undo compares against it, so an edit you
  -- made afterwards is never silently destroyed.
  fingerprint TEXT NOT NULL,
  score REAL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  undone_at TEXT,
  undo_result TEXT
);
CREATE INDEX IF NOT EXISTS idx_automation_run ON automation_actions(run_id, applied_at);
CREATE INDEX IF NOT EXISTS idx_automation_open ON automation_actions(reviewed_at, applied_at);

-- What each sender has earned. Autonomy is granted to a sender by being right,
-- not by looking right: a billing-shaped address is a structural signal and
-- says nothing about whether this particular sender has ever been correct.
--
-- Keyed on the envelope sender *domain*, never the display name. Display names
-- are attacker-controlled; merchantFrom() prefers senderName for the category,
-- which is fine for a label and unacceptable as an authorization key.
CREATE TABLE IF NOT EXISTS automation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'sender_domain',
  scope_key TEXT NOT NULL,
  confirms INTEGER NOT NULL DEFAULT 0,
  corrections INTEGER NOT NULL DEFAULT 0,
  -- 'ask' | 'auto' | 'never'. 'never' is a hard override that no amount of
  -- accumulated confidence overrules — it is how autonomy is taken back per
  -- source rather than globally.
  mode TEXT NOT NULL DEFAULT 'ask',
  last_confirmed_at TEXT,
  last_applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(domain, scope, scope_key)
);
CREATE INDEX IF NOT EXISTS idx_automation_rules_lookup ON automation_rules(domain, scope_key);
`;

/**
 * Run a data migration exactly once, ever.
 *
 * Everything in SCHEMA is safe to re-execute on every boot. Backfills are not:
 * a backfill that re-runs will happily recreate a row you deleted last week.
 * Guarding on schema_migrations makes "already applied" a fact in the database
 * rather than something inferred from whether the data happens to look done.
 */
async function runOnce(name: string, fn: () => Promise<void>): Promise<void> {
  const seen = await db.execute({
    sql: "SELECT 1 FROM schema_migrations WHERE name = ?",
    args: [name],
  });
  if (seen.rows.length > 0) return;
  await fn();
  await db.execute({
    sql: "INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)",
    args: [name],
  });
}

/**
 * Seed applications/application_events from the older `interviews` table.
 *
 * The `interviews` table is deliberately left in place afterwards. It costs
 * nothing, it keeps the export complete, and it means this migration is
 * recoverable if the new model turns out to need reshaping.
 *
 * Each migrated application gets one seed event so its timeline is never
 * empty — an application whose history starts blank cannot explain its own
 * status, which is the whole point of the event log.
 */
async function backfillApplicationsFromInterviews(): Promise<void> {
  const legacy = await db.execute("SELECT * FROM interviews ORDER BY id");
  if (legacy.rows.length === 0) return;

  for (const row of legacy.rows) {
    const stage = (row.stage as string) ?? "Applied";
    const appliedDate = (row.created_at as string | null)?.slice(0, 10) ?? null;
    const inserted = await db.execute({
      sql: `INSERT INTO applications
              (company, role, status, applied_date, next_action_date, notes, source,
               last_activity_date, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)
            RETURNING id`,
      args: [
        row.company as string,
        (row.role as string | null) ?? null,
        stage,
        appliedDate,
        (row.date as string | null) ?? null,
        (row.notes as string | null) ?? null,
        appliedDate,
        (row.created_at as string) ?? new Date().toISOString(),
        (row.updated_at as string) ?? new Date().toISOString(),
      ],
    });

    const applicationId = Number(inserted.rows[0].id);
    await db.execute({
      sql: `INSERT INTO application_events
              (application_id, kind, from_status, to_status, occurred_on, detail, source)
            VALUES (?, 'created', NULL, ?, ?, 'Imported from the interviews tracker', 'manual')`,
      args: [applicationId, stage, appliedDate ?? new Date().toISOString().slice(0, 10)],
    });
  }
}

async function ensureColumn(table: string, column: string, definition: string): Promise<void> {
  const existing = await db.execute(`PRAGMA table_info(${table})`);
  if (existing.rows.some((row) => row.name === column)) return;
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function ensureInboxProposalColumns(): Promise<void> {
  await ensureColumn("inbox_items", "proposed_company", "TEXT");
  await ensureColumn("inbox_items", "proposed_role", "TEXT");
  await ensureColumn("inbox_items", "proposed_next_action_date", "TEXT");
  // Inbox items began career-only, so the columns above are career-shaped.
  // Rather than a new column per domain forever, a domain tag plus a JSON
  // payload carries whatever that domain's own reader produced. Career keeps
  // its original columns, so nothing downstream of it changes.
  await ensureColumn("inbox_items", "domain", "TEXT");
  await ensureColumn("inbox_items", "proposed_payload", "TEXT");
}

/**
 * Where a row came from.
 *
 * Two columns rather than a provenance table, because the UI needs exactly one
 * thing from them: a small "from email" marker, so a row the sync created is
 * never mistaken for one you typed. That marker is most of the trust the
 * feature needs.
 *
 * These tables exist in every deployed database, so `CREATE TABLE IF NOT
 * EXISTS` will not touch them and a bare ALTER inside SCHEMA would throw on the
 * second boot.
 */
/**
 * `automation_actions` shipped before the trust ledger did, so any database
 * booted in between has the table without these two columns. They are in
 * SCHEMA for new databases and added here for existing ones — a bare ALTER
 * inside SCHEMA would throw on the second boot.
 */
async function ensureJournalColumns(): Promise<void> {
  await ensureColumn("automation_actions", "scope_key", "TEXT");
  await ensureColumn("automation_actions", "edited_at", "TEXT");
}

async function ensureProvenanceColumns(): Promise<void> {
  for (const table of ["school_tasks", "finance_transactions"]) {
    await ensureColumn(table, "source", "TEXT");
    await ensureColumn(table, "external_event_id", "INTEGER");
  }
}

const APPLICATION_STATUSES: ApplicationStatus[] = [
  "Applied",
  "OA",
  "Phone Screen",
  "Technical",
  "Onsite",
  "Offer",
  "Rejected",
];

function statusFromLegacyTitle(title: string): ApplicationStatus | null {
  const found = APPLICATION_STATUSES.find((status) =>
    new RegExp(`\\b${status.replace(" ", "\\s+")}\\b`, "i").test(title)
  );
  return found ?? null;
}

function companyFromLegacyTitle(title: string): string | null {
  const match = /^(.+?)\s+[—-]\s+/.exec(title);
  const company = match?.[1]?.trim();
  if (!company || company.length < 2) return null;
  return company;
}

/**
 * PR #4 created "no matching application" notices before Inbox items carried
 * proposed company/status fields. Those rows were already deduped through
 * external_events, so a later sync correctly says "No new mail" and never
 * revisits them. Upgrade them in place so the existing Inbox can be confirmed
 * into Career rows instead of sitting there as un-actionable warnings.
 */
async function backfillInboxCreateProposals(): Promise<void> {
  const legacy = await db.execute({
    sql: `SELECT i.id, i.title, i.detail, e.provider_message_id, e.thread_id,
                 e.occurred_at, e.subject, e.sender, e.snippet
            FROM inbox_items i
            LEFT JOIN external_events e ON e.id = i.external_event_id
           WHERE i.kind = 'unmatched_career_email'
             AND i.state = 'open'
             AND i.proposed_status IS NULL`,
    args: [],
  });

  for (const row of legacy.rows) {
    const status = statusFromLegacyTitle(String(row.title ?? ""));
    if (!status) continue;

    const sender = parseSender(String(row.sender ?? ""));
    const signal =
      row.provider_message_id && row.subject
        ? classifyDeterministic({
            providerMessageId: String(row.provider_message_id),
            threadId: (row.thread_id as string | null) ?? null,
            receivedOn: (row.occurred_at as string | null) ?? new Date().toISOString().slice(0, 10),
            subject: String(row.subject ?? ""),
            senderName: sender.name,
            senderEmail: sender.email,
            snippet: String(row.snippet ?? ""),
          })
        : null;

    const company = signal?.isCareerRelated
      ? signal.company ?? companyFromLegacyTitle(String(row.title ?? ""))
      : companyFromLegacyTitle(String(row.title ?? ""));
    if (!company) continue;

    const label = [company, signal?.isCareerRelated ? signal.role : null].filter(Boolean).join(" · ");
    await db.execute({
      sql: `UPDATE inbox_items
               SET title = ?,
                   proposed_status = ?,
                   proposed_company = ?,
                   proposed_role = ?,
                   proposed_next_action_date = ?,
                   confidence = COALESCE(confidence, ?)
             WHERE id = ?`,
      args: [
        `Create ${label} as ${status}?`,
        status,
        company,
        signal?.isCareerRelated ? signal.role : null,
        signal?.isCareerRelated ? signal.deadline : null,
        signal?.isCareerRelated ? signal.confidence : null,
        row.id,
      ],
    });
  }
}

/**
 * Seed the trust ledger from confirmations you already made.
 *
 * Without this the feature is cold on day one: turning `AUTOMATION_MODE=auto`
 * on would do nothing at all until three fresh confirmations accumulated per
 * sender, which is indistinguishable from a broken switch. Every confirmed
 * inbox item is an explicit act of agreement that already happened, so counting
 * it is reading history rather than inventing evidence.
 *
 * Capped at the promotion bar. The backfill can carry a sender you have
 * genuinely confirmed many times up to the edge of autonomy, but it cannot
 * manufacture a reserve that would let a sender survive corrections it never
 * earned its way past.
 *
 * A backfill and not a SCHEMA statement: re-running it would resurrect trust
 * you have since revoked, which is precisely what `runOnce()` exists to
 * prevent.
 */
async function seedTrustFromConfirmations(): Promise<void> {
  const confirmed = await db.execute(
    `SELECT COALESCE(i.domain, 'career') AS domain, e.sender AS sender, COUNT(*) AS n
       FROM inbox_items i
       JOIN external_events e ON e.id = i.external_event_id
      WHERE i.state = 'confirmed' AND e.sender IS NOT NULL
      GROUP BY domain, e.sender`
  );

  // Senders arrive as full addresses and several may share a domain, so they
  // are folded here rather than in SQL — the key is the domain, never the
  // display name or the local part.
  const totals = new Map<string, number>();
  for (const row of confirmed.rows) {
    const email = String(row.sender);
    if (!email.includes("@")) continue;
    // senderDomain(), not a copy of it. The seed and the pipeline must key on
    // the same string or the backfill credits senders the lookup never finds.
    const domain = senderDomain(email);
    if (!domain) continue;
    const key = `${row.domain}\u0000${domain}`;
    totals.set(key, (totals.get(key) ?? 0) + Number(row.n));
  }

  for (const [key, count] of totals) {
    const [domain, scopeKey] = key.split("\u0000");
    await db.execute({
      sql: `INSERT INTO automation_rules (domain, scope, scope_key, confirms, last_confirmed_at)
            VALUES (?, 'sender_domain', ?, ?, date('now'))
            ON CONFLICT(domain, scope, scope_key) DO NOTHING`,
      args: [domain, scopeKey, Math.min(count, TRUST_PROMOTION)],
    });
  }
}

async function migrate(): Promise<void> {
  // Strip `--` line comments before splitting on `;`. Prose explaining a table
  // will eventually contain a semicolon, and a naive split would slice that
  // comment in half and hand SQLite the second fragment as a statement.
  const statements = SCHEMA.replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.execute(statement);
  }
  await ensureInboxProposalColumns();
  await ensureProvenanceColumns();
  await ensureJournalColumns();
  await runOnce("2026-08-applications-from-interviews", backfillApplicationsFromInterviews);
  await runOnce("2026-08-inbox-create-proposals-from-unmatched-email", backfillInboxCreateProposals);
  await runOnce("2026-09-autonomy-seed-trust-from-confirmed-inbox", seedTrustFromConfirmations);
}

export function ensureDb(): Promise<void> {
  if (!global.__dashboardDbReady) {
    global.__dashboardDbReady = migrate();
  }
  return global.__dashboardDbReady;
}
