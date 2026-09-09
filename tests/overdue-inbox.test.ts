import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The Inbox used to bound its deadline window at `>= today`, so a missed
 * deadline vanished from it the morning after — the exact moment it most needed
 * saying. It cannot stay forever either: something three months past is not a
 * deadline any more, and an Inbox that nags about it indefinitely is one you
 * stop reading, which costs you every *other* item in it.
 */
const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "overdue-test-")), "o.db");
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.AI_PROVIDER = "none";

let db: typeof import("@/lib/db").db;
let refreshDerivedInbox: typeof import("@/lib/inbox").refreshDerivedInbox;
let todayISO: typeof import("@/lib/date").todayISO;
let shiftISODate: typeof import("@/lib/date").shiftISODate;
let OVERDUE_GRACE_DAYS: number;

before(async () => {
  const dbMod = await import("@/lib/db");
  db = dbMod.db;
  await dbMod.ensureDb();
  const inbox = await import("@/lib/inbox");
  refreshDerivedInbox = inbox.refreshDerivedInbox;
  OVERDUE_GRACE_DAYS = inbox.OVERDUE_GRACE_DAYS;
  ({ todayISO, shiftISODate } = await import("@/lib/date"));
});

beforeEach(async () => {
  for (const table of ["inbox_items", "school_tasks", "applications"]) {
    await db.execute(`DELETE FROM ${table}`);
  }
});

async function task(title: string, offset: number) {
  await db.execute({
    sql: "INSERT INTO school_tasks (course, title, due_date, status) VALUES (?,?,?,?)",
    args: ["CSE 143", title, shiftISODate(todayISO(), offset), "Pending"],
  });
}

async function openTitles(): Promise<string[]> {
  await refreshDerivedInbox(todayISO());
  const rows = await db.execute("SELECT title FROM inbox_items WHERE state = 'open'");
  return rows.rows.map((r) => String(r.title));
}

describe("the Inbox keeps a missed deadline in view", () => {
  test("a deadline missed yesterday is still there", async () => {
    await task("Assignment 4", -1);
    const titles = await openTitles();
    assert.equal(titles.length, 1);
    assert.match(titles[0], /was due yesterday/);
  });

  test("it says how late, rather than calling it today", async () => {
    await task("Assignment 4", -5);
    assert.match((await openTitles())[0], /was due 5 days ago/);
  });

  test("it stops asking once it is no longer a deadline", async () => {
    // Past the grace window it is a decision about whether it still matters,
    // and the Inbox is not the place to make that decision every morning.
    await task("Ancient", -(OVERDUE_GRACE_DAYS + 1));
    assert.deepEqual(await openTitles(), []);
  });

  test("the edge of the window is still inside it", async () => {
    await task("Just inside", -OVERDUE_GRACE_DAYS);
    assert.equal((await openTitles()).length, 1);
  });

  test("upcoming deadlines are unaffected and read forwards", async () => {
    await task("Next week", 3);
    assert.match((await openTitles())[0], /due in 3 days/);
  });

  test("re-deriving updates in place rather than stacking copies", async () => {
    // The dedupe key is the situation — this task, this due date — so a missed
    // deadline that is still missed tomorrow is the same item, not a new one.
    await task("Assignment 4", -2);
    await openTitles();
    await openTitles();
    await openTitles();

    const rows = await db.execute("SELECT COUNT(*) AS c FROM inbox_items");
    assert.equal(Number(rows.rows[0].c), 1);
  });

  test("a dismissed overdue item stays dismissed", async () => {
    await task("Assignment 4", -2);
    await openTitles();
    await db.execute("UPDATE inbox_items SET state = 'dismissed'");
    assert.deepEqual(await openTitles(), []);
  });

  test("a finished task leaves the Inbox", async () => {
    await task("Assignment 4", -2);
    await openTitles();
    await db.execute("UPDATE school_tasks SET status = 'Done'");
    // The derived item is gone from the open set once the reason for it is.
    const remaining = await openTitles();
    assert.deepEqual(remaining, []);
  });
});
