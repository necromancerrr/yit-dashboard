import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
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
let getRule: typeof import("@/lib/autonomy/trust").getRule;
let recordConfirmation: typeof import("@/lib/autonomy/trust").recordConfirmation;
let setRuleMode: typeof import("@/lib/autonomy/trust").setRuleMode;
let inboxPatch: typeof import("@/app/api/inbox/[id]/route").PATCH;

before(async () => {
  const dbMod = await import("@/lib/db");
  db = dbMod.db;
  await dbMod.ensureDb();
  ({ ingestMessages } = await import("@/lib/ingest/pipeline"));
  ({ getDigest, undoAction, markReviewed } = await import("@/lib/autonomy/journal"));
  ({ getRule, recordConfirmation, setRuleMode } = await import("@/lib/autonomy/trust"));
  ({ PATCH: inboxPatch } = await import("@/app/api/inbox/[id]/route"));
});

beforeEach(async () => {
  for (const table of [
    "automation_rules",
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

/**
 * Give a sender the standing it would have earned by being confirmed by hand.
 *
 * Every test that expects an unattended write has to do this, and that is the
 * point of the ledger rather than an inconvenience: looking like a receipt is
 * not grounds for acting alone, so nothing auto-applies until a sender has
 * actually been right a few times.
 */
async function teach(domain: "money" | "school" | "career", scopeKey: string, times = 3) {
  for (let i = 0; i < times; i++) await recordConfirmation(domain, scopeKey);
}

/**
 * Confirm through the real route rather than writing the counter directly, so
 * the path a person actually takes is the path under test.
 */
async function confirmInboxItem(id: number) {
  const res = await inboxPatch(
    new NextRequest(`http://localhost/api/inbox/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "confirmed" }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 200);
}

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

describe("a sender must earn the right before anything is written", () => {
  beforeEach(() => {
    process.env.AUTOMATION_MODE = "auto";
  });

  test("a receipt from a sender it has never seen is still a question", async () => {
    // The whole difference between this and a static allow-list: a
    // billing-shaped address says the mail looks like a receipt and nothing
    // about whether this sender has ever been read correctly.
    await ingestMessages("gmail", [receipt("18.40")]);

    assert.equal(await countOf("SELECT COUNT(*) AS c FROM finance_transactions"), 0);
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM inbox_items WHERE state='open'"), 1);
  });

  test("confirming three proposals is what turns it on", async () => {
    for (const amount of ["1.00", "2.00", "3.00"]) {
      await ingestMessages("gmail", [receipt(amount)]);
    }
    // Three questions, nothing written.
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM finance_transactions"), 0);

    const open = await db.execute("SELECT id FROM inbox_items WHERE state='open'");
    for (const row of open.rows) {
      await confirmInboxItem(Number(row.id));
    }

    const rule = await getRule("money", "spotify.com");
    assert.equal(rule?.confirms, 3);

    // The fourth is written without asking.
    await ingestMessages("gmail", [receipt("4.00")]);
    const written = await db.execute(
      "SELECT * FROM finance_transactions WHERE source = 'gmail'"
    );
    assert.equal(written.rows.length, 1);
    assert.equal(Number(written.rows[0].amount), 4);
  });

  test("a sender you turned off never acts, however much it has earned", async () => {
    await teach("money", "spotify.com", 20);
    const rule = await getRule("money", "spotify.com");
    await setRuleMode(rule!.id, "never");

    await ingestMessages("gmail", [receipt("18.40")]);
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM finance_transactions"), 0);
  });

  test("a sender you allowed by hand acts immediately, with no confirmations", async () => {
    await recordConfirmation("money", "spotify.com");
    const rule = await getRule("money", "spotify.com");
    await setRuleMode(rule!.id, "auto");
    await db.execute("UPDATE automation_rules SET confirms = 0");

    await ingestMessages("gmail", [receipt("18.40")]);
    assert.equal(await countOf("SELECT COUNT(*) AS c FROM finance_transactions"), 1);
  });
});

describe("AUTOMATION_MODE=auto writes a receipt, and records why", () => {
  beforeEach(async () => {
    process.env.AUTOMATION_MODE = "auto";
    await teach("money", "spotify.com");
    await teach("money", "chase.com");
    for (let i = 0; i < 20; i++) await teach("money", `shop${i}.com`, 3);
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
    await teach("money", "spotify.com");
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
    await teach("money", "spotify.com");
    await teach("money", "cafe.com");
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
    await teach("money", "spotify.com");
    await teach("money", "cafe.com");
    await ingestMessages("gmail", [receipt("18.40")]);
    await ingestMessages("gmail", [receipt("4.20", "Cafe")]);

    const { actions } = await getDigest();
    const runs = new Set(actions.map((a) => a.runId));
    assert.equal(runs.size, 2, "one sync is one run");

    await markReviewed(actions[0].runId);
    assert.equal((await getDigest()).unreviewed, 1);
  });
});

describe("a correction takes the right back", () => {
  beforeEach(async () => {
    process.env.AUTOMATION_MODE = "auto";
    await teach("money", "spotify.com");
  });

  test("undoing resets the sender's confirmations and raises the bar", async () => {
    await ingestMessages("gmail", [receipt("18.40")]);
    const { actions } = await getDigest();
    await undoAction(actions[0].id);

    const rule = await getRule("money", "spotify.com");
    assert.equal(rule?.confirms, 0, "a single correction demotes — there is no averaging");
    assert.equal(rule?.corrections, 1);

    // And it does not act again until it has earned more than it did before.
    await ingestMessages("gmail", [receipt("5.00")]);
    assert.equal(
      await countOf("SELECT COUNT(*) AS c FROM finance_transactions WHERE source='gmail'"),
      0
    );

    // Three is no longer enough; four is.
    await teach("money", "spotify.com", 3);
    await ingestMessages("gmail", [receipt("6.00")]);
    assert.equal(
      await countOf("SELECT COUNT(*) AS c FROM finance_transactions WHERE source='gmail'"),
      0
    );
    await teach("money", "spotify.com", 1);
    await ingestMessages("gmail", [receipt("7.00")]);
    assert.equal(
      await countOf("SELECT COUNT(*) AS c FROM finance_transactions WHERE source='gmail'"),
      1
    );
  });

  test("editing an auto-applied row counts as a correction, without an undo", async () => {
    // The most informative correction there is: the machine got it *nearly*
    // right, which no confidence threshold can see. Waiting for an undo would
    // miss it, because fixing a row is the natural thing to do.
    await ingestMessages("gmail", [receipt("18.40")]);
    const rows = await db.execute("SELECT id FROM finance_transactions WHERE source='gmail'");
    await db.execute({
      sql: "UPDATE finance_transactions SET amount = 22.5 WHERE id = ?",
      args: [rows.rows[0].id],
    });

    const digest = await getDigest();
    assert.equal(digest.actions[0].edited, true);

    const rule = await getRule("money", "spotify.com");
    assert.equal(rule?.corrections, 1);
    assert.equal(rule?.confirms, 0);
  });

  test("an edit is counted once, however often the digest is read", async () => {
    await ingestMessages("gmail", [receipt("18.40")]);
    const rows = await db.execute("SELECT id FROM finance_transactions WHERE source='gmail'");
    await db.execute({
      sql: "UPDATE finance_transactions SET amount = 22.5 WHERE id = ?",
      args: [rows.rows[0].id],
    });

    await getDigest();
    await getDigest();
    await getDigest();

    assert.equal((await getRule("money", "spotify.com"))?.corrections, 1);
  });

  test("deleting a row by hand is not a sender mistake", async () => {
    // You removing something you did not want is already expressed by it being
    // gone. Counting it against the sender would demote on an act that says
    // nothing about how the message was read.
    await ingestMessages("gmail", [receipt("18.40")]);
    await db.execute("DELETE FROM finance_transactions");
    await getDigest();

    const rule = await getRule("money", "spotify.com");
    assert.equal(rule?.corrections, 0);
    assert.equal(rule?.confirms, 3);
  });

  test("'looks right' credits a sender once per batch, not once per row", async () => {
    // Agreeing with a batch is one judgement, not twelve.
    await ingestMessages("gmail", [receipt("1.00"), receipt("2.00"), receipt("3.00")]);
    assert.equal(
      await countOf("SELECT COUNT(*) AS c FROM finance_transactions WHERE source='gmail'"),
      3
    );

    await markReviewed();
    assert.equal((await getRule("money", "spotify.com"))?.confirms, 4);
  });

  test("dismissing a proposal neither promotes nor demotes", async () => {
    // "Not now" and "I already logged that" are the usual reasons, and neither
    // says the message was read wrongly.
    delete process.env.AUTOMATION_MODE;
    await ingestMessages("gmail", [receipt("18.40", "Newshop")]);
    const open = await db.execute("SELECT id FROM inbox_items WHERE state='open'");
    const res = await inboxPatch(
      new NextRequest(`http://localhost/api/inbox/${open.rows[0].id}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "dismissed" }),
      }),
      { params: Promise.resolve({ id: String(open.rows[0].id) }) }
    );
    assert.equal(res.status, 200);
    assert.equal(await getRule("money", "newshop.com"), null);
  });
});
