import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NormalizedMessage } from "@/lib/ingest/types";

/**
 * Autonomy end to end, against a real SQLite file.
 *
 * AUTOMATION_MODE is set per test rather than once, because the whole point of
 * the mode is that the same message produces a question or a row depending on
 * it — and the default must be today's behaviour, so that is asserted too.
 */
const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "autonomy-test-")), "a.db");
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.AI_PROVIDER = "none";

let db: typeof import("@/lib/db").db;
let ingestMessages: typeof import("@/lib/ingest/pipeline").ingestMessages;
let getDigest: typeof import("@/lib/autonomy/journal").getDigest;
let undoAction: typeof import("@/lib/autonomy/journal").undoAction;
let markReviewed: typeof import("@/lib/autonomy/journal").markReviewed;

before(async () => {
  const dbMod = await import("@/lib/db");
  db = dbMod.db;
  await dbMod.ensureDb();
  ({ ingestMessages } = await import("@/lib/ingest/pipeline"));
  ({ getDigest, undoAction, markReviewed } = await import("@/lib/autonomy/journal"));
});

beforeEach(async () => {
  for (const table of [
    "automation_actions",
    "finance_transactions",
    "school_tasks",
    "inbox_items",
    "external_events",
    "application_events",
    "applications",
  ]) {
    await db.execute(`DELETE FROM ${table}`);
  }
  delete process.env.AUTOMATION_MODE;
});

let seq = 0;
function receipt(amount: string, merchant = "Spotify"): NormalizedMessage {
  seq += 1;
  return {
    providerMessageId: `msg-${seq}`,
    threadId: `thread-${seq}`,
    subject: `Your ${merchant} receipt`,
    senderName: merchant,
    senderEmail: `billing@${merchant.toLowerCase()}.com`,
    snippet: `Thanks. You were charged $${amount} on 2026-03-04 for your subscription.`,
    receivedOn: "2026-03-04",
  };
}

const countOf = async (sql: string) =>
  Number((await db.execute(sql)).rows[0]?.c ?? 0);

describe("the default is exactly today's behaviour", () => {
  test("with no AUTOMATION_MODE set, a receipt is a question and not a row", async () => {
    await ingestMessages("gmail", [receipt("18.40")]);

    assert.equal(await countOf("SELECT COUNT(*) AS c FROM finance_transactions"), 0);
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM inbox_items WHERE state='open'"), 1);
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM automation_actions"), 0);
  });

  test("AUTOMATION_MODE=off is the same, explicitly", async () => {
    process.env.AUTOMATION_MODE = "off";
    await ingestMessages("gmail", [receipt("18.40")]);
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM finance_transactions"), 0);
  });
});

describe("AUTOMATION_MODE=auto writes a receipt, and records why", () => {
  beforeEach(() => {
    process.env.AUTOMATION_MODE = "auto";
  });

  test("the row is written, marked as coming from email, and journaled", async () => {
    await ingestMessages("gmail", [receipt("18.40")]);

    const rows = await db.execute("SELECT * FROM finance_transactions");
    assert.equal(rows.rows.length, 1);
    assert.equal(Number(rows.rows[0].amount), 18.4);
    assert.equal(rows.rows[0].type, "expense");
    // Provenance: the UI must be able to say this came from email rather than
    // from you.
    assert.equal(rows.rows[0].source, "gmail");
    assert.ok(rows.rows[0].external_event_id);

    const digest = await getDigest();
    assert.equal(digest.actions.length, 1);
    assert.equal(digest.unreviewed, 1);
    assert.match(digest.actions[0].summary, /\$18\.40/);
    // The reason is shown verbatim, so it has to read as a sentence.
    assert.ok(digest.actions[0].because.length > 10);
    assert.equal(digest.actions[0].target.table, "finance_transactions");
  });

  test("no inbox item is raised for something already handled", async () => {
    await ingestMessages("gmail", [receipt("18.40")]);
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM inbox_items WHERE state='open'"), 0);
  });

  test("a charge over the ceiling stays a question", async () => {
    await ingestMessages("gmail", [receipt("340.00", "Airline")]);
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM finance_transactions"), 0);
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM inbox_items WHERE state='open'"), 1);
  });

  test("a second copy of the same charge from another sender is not written twice", async () => {
    // The merchant and the card issuer mail the same purchase; different
    // senders mean different dedupe keys, so nothing else would catch it.
    await ingestMessages("gmail", [receipt("18.40")]);
    await ingestMessages("gmail", [receipt("18.40", "Chase")]);

    assert.equal(await countOf("SELECT COUNT(*) AS c FROM finance_transactions"), 1);
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM inbox_items WHERE state='open'"), 1);
  });

  test("one sync writes at most the run budget, and the rest become questions", async () => {
    const many = Array.from({ length: 14 }, (_, i) => receipt((10 + i).toFixed(2), `Shop${i}`));
    await ingestMessages("gmail", many);

    const written = await countOf("SELECT COUNT(*) AS c FROM finance_transactions");
    assert.equal(written, 10);
    // Nothing is lost — the overflow is visible as questions, which is the
    // point of a budget rather than a cutoff.
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM inbox_items WHERE state='open'"), 4);
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM automation_actions"), 10);
  });
});

describe("undo", () => {
  beforeEach(async () => {
    process.env.AUTOMATION_MODE = "auto";
    await ingestMessages("gmail", [receipt("18.40")]);
  });

  test("an untouched row is removed, and the journal records that", async () => {
    const { actions } = await getDigest();
    const { result, message } = await undoAction(actions[0].id);

    assert.equal(result, "reverted");
    assert.match(message, /Removed/);
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM finance_transactions"), 0);

    const after = await getDigest();
    assert.equal(after.actions[0].undoResult, "reverted");
    assert.ok(after.actions[0].undoneAt);
  });

  test("a row you edited is kept as you left it", async () => {
    // Undo must never cost an edit made deliberately — that is worse than the
    // wrong row it was trying to fix.
    const rows = await db.execute("SELECT id FROM finance_transactions");
    await db.execute({
      sql: "UPDATE finance_transactions SET amount = 22.5, category = 'Music' WHERE id = ?",
      args: [rows.rows[0].id],
    });

    const { actions } = await getDigest();
    const { result, message } = await undoAction(actions[0].id);

    assert.equal(result, "kept_edited");
    assert.match(message, /edited/i);
    const still = await db.execute("SELECT amount, category FROM finance_transactions");
    assert.equal(still.rows.length, 1);
    assert.equal(Number(still.rows[0].amount), 22.5);
    assert.equal(still.rows[0].category, "Music");
  });

  test("a row already deleted by hand is reported as gone, not an error", async () => {
    await db.execute("DELETE FROM finance_transactions");
    const { actions } = await getDigest();
    assert.equal((await undoAction(actions[0].id)).result, "gone");
  });

  test("undoing twice is idempotent", async () => {
    const { actions } = await getDigest();
    await undoAction(actions[0].id);
    const second = await undoAction(actions[0].id);
    assert.equal(second.result, "reverted");
    assert.match(second.message, /Already undone/);
  });

  test("an unknown action throws rather than silently doing nothing", async () => {
    await assert.rejects(() => undoAction(999_999));
  });

  test("undoing counts as having looked at it", async () => {
    const { actions } = await getDigest();
    await undoAction(actions[0].id);
    assert.equal((await getDigest()).unreviewed, 0);
  });
});

describe("reviewing", () => {
  test("'looks right' clears the unreviewed count without touching the rows", async () => {
    process.env.AUTOMATION_MODE = "auto";
    await ingestMessages("gmail", [receipt("18.40"), receipt("4.20", "Cafe")]);

    const before = await getDigest();
    assert.equal(before.unreviewed, 2);

    const reviewed = await markReviewed();
    assert.equal(reviewed, 2);

    const after = await getDigest();
    assert.equal(after.unreviewed, 0);
    assert.equal(after.actions.length, 2, "reviewing hides the badge, not the history");
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM finance_transactions"), 2);
  });

  test("reviewing one run leaves another run's actions outstanding", async () => {
    process.env.AUTOMATION_MODE = "auto";
    await ingestMessages("gmail", [receipt("18.40")]);
    await ingestMessages("gmail", [receipt("4.20", "Cafe")]);

    const { actions } = await getDigest();
    const runs = new Set(actions.map((a) => a.runId));
    assert.equal(runs.size, 2, "one sync is one run");

    await markReviewed(actions[0].runId);
    assert.equal((await getDigest()).unreviewed, 1);
  });
});
