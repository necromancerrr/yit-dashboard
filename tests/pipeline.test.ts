import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import type { NormalizedMessage } from "@/lib/ingest/types";

/**
 * End-to-end pipeline tests against a real SQLite database.
 *
 * DATABASE_URL is set before the modules are imported because src/lib/db
 * resolves it once, at module load. AI is switched off so these exercise the
 * deterministic path only — a test whose result depends on a model round trip
 * is not a test.
 */
const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yit-test-")), "test.db");
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.AI_PROVIDER = "none";
process.env.APP_TIMEZONE = "America/Los_Angeles";

type Mod = {
  db: typeof import("@/lib/db").db;
  ensureDb: typeof import("@/lib/db").ensureDb;
  ingestMessages: typeof import("@/lib/ingest/pipeline").ingestMessages;
  patchInbox: typeof import("@/app/api/inbox/[id]/route").PATCH;
};
let mod: Mod;

function msg(over: Partial<NormalizedMessage> & { providerMessageId: string }): NormalizedMessage {
  return {
    threadId: null,
    receivedOn: "2026-08-20",
    subject: "",
    senderName: null,
    senderEmail: null,
    snippet: "",
    ...over,
  };
}

const OA_EMAIL = msg({
  providerMessageId: "hr-002",
  threadId: "thread-oa",
  subject: "Your HackerRank test for Goldman Sachs is ready",
  senderName: "HackerRank",
  senderEmail: "noreply@hackerrank.com",
  snippet:
    "You have been invited to complete an online assessment for your application to Goldman Sachs. The assessment is due by August 24, 2026.",
});

async function seedApplication(company: string, role: string | null, status = "Applied") {
  const res = await mod.db.execute({
    sql: `INSERT INTO applications (company, role, status, applied_date, last_activity_date)
          VALUES (?, ?, ?, '2026-08-01', '2026-08-01') RETURNING id`,
    args: [company, role, status],
  });
  const id = Number(res.rows[0].id);
  await mod.db.execute({
    sql: `INSERT INTO application_events (application_id, kind, to_status, occurred_on, source)
          VALUES (?, 'created', ?, '2026-08-01', 'manual')`,
    args: [id, status],
  });
  return id;
}

async function statusOf(id: number) {
  const r = await mod.db.execute({ sql: "SELECT status, next_action_date FROM applications WHERE id = ?", args: [id] });
  return r.rows[0] as unknown as { status: string; next_action_date: string | null };
}

async function inboxItems() {
  const r = await mod.db.execute(
    `SELECT id, kind, title, proposed_status, proposed_company, proposed_role,
            proposed_next_action_date, application_id, state, dedupe_key
       FROM inbox_items`
  );
  return r.rows as unknown as {
    id: number; kind: string; title: string; proposed_status: string | null;
    proposed_company: string | null; proposed_role: string | null;
    proposed_next_action_date: string | null;
    application_id: number | null; state: string; dedupe_key: string;
  }[];
}

async function confirmInboxItem(id: number) {
  return mod.patchInbox(
    new NextRequest(`http://localhost/api/inbox/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "confirmed" }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
}

async function editInboxItem(id: number, body: Record<string, unknown>) {
  return mod.patchInbox(
    new NextRequest(`http://localhost/api/inbox/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
}

before(async () => {
  const dbMod = await import("@/lib/db");
  const pipeline = await import("@/lib/ingest/pipeline");
  const inbox = await import("@/app/api/inbox/[id]/route");
  mod = {
    db: dbMod.db,
    ensureDb: dbMod.ensureDb,
    ingestMessages: pipeline.ingestMessages,
    patchInbox: inbox.PATCH,
  };
  await mod.ensureDb();
});

beforeEach(async () => {
  for (const table of ["inbox_items", "application_events", "applications", "external_events"]) {
    await mod.db.execute(`DELETE FROM ${table}`);
  }
});

describe("ingestion pipeline", () => {
  test("an OA email advances a matched application and records its deadline", async () => {
    const id = await seedApplication("Goldman Sachs", "SWE Intern");
    const out = await mod.ingestMessages("gmail", [OA_EMAIL]);

    assert.equal(out.ingested, 1);
    assert.equal(out.applied, 1);
    const app = await statusOf(id);
    assert.equal(app.status, "OA");
    assert.equal(app.next_action_date, "2026-08-24");
  });

  test("the applied change is written to the timeline with its source", async () => {
    const id = await seedApplication("Goldman Sachs", "SWE Intern");
    await mod.ingestMessages("gmail", [OA_EMAIL]);

    const events = await mod.db.execute({
      sql: "SELECT kind, to_status, source, external_event_id FROM application_events WHERE application_id = ? AND kind = 'status_change'",
      args: [id],
    });
    assert.equal(events.rows.length, 1);
    assert.equal(events.rows[0].source, "gmail");
    assert.ok(events.rows[0].external_event_id, "event links back to the message it came from");
  });

  test("re-delivering the same message changes nothing", async () => {
    const id = await seedApplication("Goldman Sachs", "SWE Intern");
    await mod.ingestMessages("gmail", [OA_EMAIL]);
    const second = await mod.ingestMessages("gmail", [OA_EMAIL]);

    assert.equal(second.ingested, 0, "already-seen message is skipped before classification");
    const events = await mod.db.execute({
      sql: "SELECT COUNT(*) c FROM application_events WHERE application_id = ? AND kind = 'status_change'",
      args: [id],
    });
    assert.equal(Number(events.rows[0].c), 1, "no duplicate timeline entry");
  });

  test("a repeated reminder does not add a second timeline event", async () => {
    const id = await seedApplication("Goldman Sachs", "SWE Intern");
    await mod.ingestMessages("gmail", [OA_EMAIL]);
    // Different message id, same situation — a real reminder, two days later.
    await mod.ingestMessages("gmail", [
      msg({
        ...OA_EMAIL,
        providerMessageId: "hr-003",
        receivedOn: "2026-08-22",
        subject: "Reminder: your HackerRank test for Goldman Sachs expires soon",
      }),
    ]);

    const events = await mod.db.execute({
      sql: "SELECT COUNT(*) c FROM application_events WHERE application_id = ? AND kind = 'status_change'",
      args: [id],
    });
    assert.equal(Number(events.rows[0].c), 1, "already in OA, so nothing new to record");
  });

  test("two roles at one company become a question, never a guess", async () => {
    await seedApplication("Amazon", "SDE Intern");
    await seedApplication("Amazon", "Data Engineer Intern");

    const out = await mod.ingestMessages("gmail", [
      msg({
        providerMessageId: "amz-100",
        subject: "Amazon - scheduling an introductory call",
        senderEmail: "recruiting@amazon.com",
        senderName: "Amazon Recruiting",
        snippet: "I would love to set up a recruiter call to discuss next steps.",
      }),
    ]);

    assert.equal(out.applied, 0);
    assert.equal(out.proposed, 1);
    const items = await inboxItems();
    assert.equal(items[0].kind, "ambiguous_match");
    assert.equal(items[0].application_id, null, "no application is touched while it is unclear");
  });

  test("an email for a company with no application proposes creating one", async () => {
    const before = await mod.db.execute("SELECT COUNT(*) c FROM applications");
    const out = await mod.ingestMessages("gmail", [
      msg({
        providerMessageId: "snow-101",
        subject: "Thank you for applying to Snowflake",
        senderEmail: "no-reply@snowflake.com",
        senderName: "Snowflake",
        snippet: "We have received your application and will review it shortly.",
      }),
    ]);

    assert.equal(out.proposed, 1);
    const after = await mod.db.execute("SELECT COUNT(*) c FROM applications");
    assert.equal(Number(after.rows[0].c), Number(before.rows[0].c), "ingestion waits for confirmation");
    const [item] = await inboxItems();
    assert.equal(item.kind, "unmatched_career_email");
    assert.equal(item.proposed_status, "Applied");
    assert.equal(item.proposed_company, "Snowflake");
  });

  test("confirming an unmatched email creates the Career application", async () => {
    await mod.ingestMessages("gmail", [
      msg({
        providerMessageId: "snow-102",
        threadId: "snow-thread",
        subject: "Thank you for applying to Snowflake",
        senderEmail: "no-reply@snowflake.com",
        senderName: "Snowflake",
        snippet: "We have received your application and will review it shortly.",
      }),
    ]);
    const [item] = await inboxItems();

    const response = await confirmInboxItem(item.id);
    assert.equal(response.status, 200);

    const apps = await mod.db.execute("SELECT id, company, status, source FROM applications");
    assert.equal(apps.rows.length, 1);
    assert.equal(apps.rows[0].company, "Snowflake");
    assert.equal(apps.rows[0].status, "Applied");
    assert.equal(apps.rows[0].source, "gmail");

    const events = await mod.db.execute({
      sql: "SELECT kind, to_status, source, external_event_id FROM application_events WHERE application_id = ?",
      args: [Number(apps.rows[0].id)],
    });
    assert.equal(events.rows.length, 1);
    assert.equal(events.rows[0].kind, "created");
    assert.equal(events.rows[0].to_status, "Applied");
    assert.equal(events.rows[0].source, "gmail");
    assert.ok(events.rows[0].external_event_id, "created event links to the email");
  });

  test("a proposal can be corrected before it creates an application", async () => {
    await mod.ingestMessages("gmail", [
      msg({
        providerMessageId: "ats-incorrect-001",
        threadId: "ats-incorrect-thread",
        subject: "Thank you for applying to SAP",
        senderEmail: "notifications@successfactors.com",
        senderName: "SAP SuccessFactors",
        snippet: "We received your application for the iXp Software Engineer Intern role.",
      }),
    ]);
    const [item] = await inboxItems();

    const edited = await editInboxItem(item.id, {
      proposed_company: "SAP",
      proposed_role: "iXp Software Engineer Intern",
      proposed_status: "Applied",
      proposed_next_action_date: null,
    });
    assert.equal(edited.status, 200);

    const response = await confirmInboxItem(item.id);
    assert.equal(response.status, 200);
    const apps = await mod.db.execute("SELECT company, role, status FROM applications");
    assert.equal(apps.rows.length, 1);
    assert.equal(apps.rows[0].company, "SAP");
    assert.equal(apps.rows[0].role, "iXp Software Engineer Intern");
    assert.equal(apps.rows[0].status, "Applied");
  });

  test("confirming a create proposal rematches first to avoid duplicates", async () => {
    await mod.ingestMessages("gmail", [
      msg({
        providerMessageId: "ramp-102",
        threadId: "ramp-thread",
        subject: "Codility assessment for your application to Ramp",
        senderEmail: "noreply@codility.com",
        senderName: "Codility",
        snippet: "You have been invited to complete an online assessment for your application to Ramp.",
      }),
    ]);
    const [item] = await inboxItems();
    const existingId = await seedApplication("Ramp", "SWE Intern", "Applied");

    const response = await confirmInboxItem(item.id);
    assert.equal(response.status, 200);

    const apps = await mod.db.execute("SELECT COUNT(*) c FROM applications");
    assert.equal(Number(apps.rows[0].c), 1, "no duplicate application is created");
    assert.equal((await statusOf(existingId)).status, "OA");
  });

  test("legacy no-match inbox notices are upgraded into create proposals", async () => {
    const external = await mod.db.execute({
      sql: `INSERT INTO external_events
              (provider, provider_message_id, thread_id, occurred_at, subject, sender, snippet, processing_status)
            VALUES ('gmail', 'legacy-gs-001', 'legacy-gs-thread', '2026-08-20',
                    'Goldman Sachs: Complete Your Technical Assessment',
                    'noreply@hackerrank.com',
                    'Please complete your online assessment for your application to Goldman Sachs.',
                    'processed')
            RETURNING id`,
      args: [],
    });
    await mod.db.execute({
      sql: `INSERT INTO inbox_items
              (kind, title, detail, severity, external_event_id, dedupe_key)
            VALUES ('unmatched_career_email',
                    'gs — OA, but no matching application',
                    'Goldman Sachs: Complete Your Technical Assessment · No existing application for gs',
                    'attention', ?, 'ingest:unmatched:legacy-gs-thread')`,
      args: [Number(external.rows[0].id)],
    });
    await mod.db.execute({
      sql: "DELETE FROM schema_migrations WHERE name = ?",
      args: ["2026-08-inbox-create-proposals-from-unmatched-email"],
    });
    (globalThis as typeof globalThis & { __dashboardDbReady?: Promise<void> }).__dashboardDbReady =
      undefined;

    await mod.ensureDb();

    const [item] = await inboxItems();
    assert.equal(item.title, "Create Goldman Sachs as OA?");
    assert.equal(item.proposed_status, "OA");
    assert.equal(item.proposed_company, "Goldman Sachs");

    const response = await confirmInboxItem(item.id);
    assert.equal(response.status, 200);
    const apps = await mod.db.execute("SELECT company, status FROM applications");
    assert.equal(apps.rows.length, 1);
    assert.equal(apps.rows[0].company, "Goldman Sachs");
    assert.equal(apps.rows[0].status, "OA");
  });

  test("a job alert is ignored without reaching the matcher", async () => {
    await seedApplication("Meta", "SWE Intern");
    const out = await mod.ingestMessages("gmail", [
      msg({
        providerMessageId: "alert-102",
        subject: "10 new jobs matching your search",
        senderEmail: "jobs-noreply@linkedin.com",
        snippet: "New jobs you may be interested in: Software Engineer at Meta. Apply now to be considered.",
      }),
    ]);

    assert.equal(out.ignored, 1);
    assert.equal(out.applied, 0);
    assert.equal((await inboxItems()).length, 0, "marketing mail must not reach the inbox");
  });

  test("a stale email cannot walk an application backwards", async () => {
    const id = await seedApplication("Stripe", "SWE Intern", "Technical");
    const out = await mod.ingestMessages("gmail", [
      msg({
        providerMessageId: "strp-103",
        subject: "Thank you for applying to Stripe",
        senderEmail: "no-reply@stripe.com",
        senderName: "Stripe",
        snippet: "We have received your application and will be in touch.",
      }),
    ]);

    assert.equal((await statusOf(id)).status, "Technical", "status is unchanged");
    assert.equal(out.applied, 0);
    const items = await inboxItems();
    assert.equal(items[0].kind, "rejected_inference", "the refusal is surfaced, not silently dropped");
  });

  test("a rejection closes an application", async () => {
    const id = await seedApplication("Amazon", "SDE Intern", "Technical");
    await mod.ingestMessages("gmail", [
      msg({
        providerMessageId: "amz-104",
        subject: "Update on your Amazon application",
        senderEmail: "recruiting@amazon.com",
        senderName: "Amazon Recruiting",
        snippet: "After careful consideration, unfortunately we will not be moving forward with your application.",
      }),
    ]);
    assert.equal((await statusOf(id)).status, "Rejected");
  });

  test("a forwarded copy still classifies and matches", async () => {
    const id = await seedApplication("Goldman Sachs", "SWE Intern");
    await mod.ingestMessages("gmail", [
      msg({
        providerMessageId: "fwd-105",
        subject: "Fwd: Re: Your HackerRank test for Goldman Sachs is ready",
        senderName: "Yit",
        senderEmail: "yejigu@uw.edu",
        snippet:
          "You have been invited to complete an online assessment for your application to Goldman Sachs. Due by August 24, 2026.",
      }),
    ]);
    assert.equal((await statusOf(id)).status, "OA");
  });

  test("every processed message is accounted for in external_events", async () => {
    await seedApplication("Goldman Sachs", "SWE Intern");
    await mod.ingestMessages("gmail", [OA_EMAIL]);
    const rows = await mod.db.execute("SELECT provider_message_id, processing_status, snippet FROM external_events");
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].processing_status, "processed");
    assert.ok((rows.rows[0].snippet as string).length <= 300, "only a bounded excerpt is stored");
  });
});
