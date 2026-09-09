import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import type { TodayData } from "@/lib/types";

/**
 * The Today route against a real SQLite database.
 *
 * DATABASE_URL is set before anything is imported, because src/lib/db resolves
 * it once at module load. AI is off: the briefing is additive and a test whose
 * result depends on a model round trip is not a test.
 */
const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "today-test-")), "today.db");
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.AI_PROVIDER = "none";

let db: typeof import("@/lib/db").db;
let GET: typeof import("@/app/api/today/route").GET;
let todayISO: typeof import("@/lib/date").todayISO;

before(async () => {
  ({ db } = await import("@/lib/db"));
  const { ensureDb } = await import("@/lib/db");
  await ensureDb();
  ({ GET } = await import("@/app/api/today/route"));
  ({ todayISO } = await import("@/lib/date"));
});

beforeEach(async () => {
  for (const table of [
    "checklist_completions",
    "checklist_items",
    "school_tasks",
    "applications",
    "gym_logs",
    "finance_transactions",
  ]) {
    await db.execute(`DELETE FROM ${table}`);
  }
});

async function addHabit(title: string, category = "Health") {
  const res = await db.execute({
    sql: "INSERT INTO checklist_items (title, category, recurring, done) VALUES (?, ?, 1, 0) RETURNING id",
    args: [title, category],
  });
  return Number(res.rows[0].id);
}

async function fetchToday(): Promise<TodayData> {
  const res = await GET(new NextRequest("http://localhost/api/today"));
  assert.equal(res.status, 200);
  return (await res.json()) as TodayData;
}

describe("Today lists habits individually", () => {
  test("each unfinished habit is its own row, carrying the id that ticks it", async () => {
    const readId = await addHabit("Read 20 pages", "Growth");
    const walkId = await addHabit("Walk the dog", "Health");

    const data = await fetchToday();
    const habits = data.items.filter((i) => i.kind === "habit");

    assert.deepEqual(
      habits.map((h) => h.title),
      ["Read 20 pages", "Walk the dog"]
    );
    assert.deepEqual(
      habits.map((h) => h.checklistItemId),
      [readId, walkId]
    );
    // The id is what makes a row tickable; nothing else may carry one.
    for (const item of data.items) {
      if (item.kind !== "habit") {
        assert.equal(item.checklistItemId, undefined, `${item.id} must not be tickable`);
      }
    }
  });

  test("a habit done today drops off the list and out of the count", async () => {
    const id = await addHabit("Read 20 pages");
    await addHabit("Walk the dog");

    await db.execute({
      sql: "UPDATE checklist_items SET done = 1, done_date = ? WHERE id = ?",
      args: [todayISO(), id],
    });

    const data = await fetchToday();
    assert.deepEqual(
      data.items.filter((i) => i.kind === "habit").map((h) => h.title),
      ["Walk the dog"]
    );
    assert.equal(data.checklistDoneToday, 1);
    assert.equal(data.checklistTotalToday, 2);
  });

  test("a habit completed on an earlier day is due again", async () => {
    // This is the rollover the checklist relies on: `done` is current state,
    // not history, and a stale `done_date` must not hide today's habit.
    const id = await addHabit("Read 20 pages");
    await db.execute({
      sql: "UPDATE checklist_items SET done = 1, done_date = ? WHERE id = ?",
      args: ["2020-01-01", id],
    });

    const data = await fetchToday();
    assert.equal(data.items.filter((i) => i.kind === "habit").length, 1);
    assert.equal(data.checklistDoneToday, 0);
  });

  test("non-recurring items are not habits and never appear", async () => {
    await db.execute({
      sql: "INSERT INTO checklist_items (title, category, recurring, done) VALUES (?, ?, 0, 0)",
      args: ["Renew passport", "Admin"],
    });

    const data = await fetchToday();
    assert.deepEqual(data.items.filter((i) => i.kind === "habit"), []);
    assert.equal(data.checklistTotalToday, 0);
  });

  test("beyond three, the rest collapse into one countable row", async () => {
    for (const title of ["A", "B", "C", "D", "E"]) await addHabit(title);

    const data = await fetchToday();
    const habits = data.items.filter((i) => i.kind === "habit");
    const rollup = data.items.find((i) => i.id === "checklist");

    assert.deepEqual(habits.map((h) => h.title), ["A", "B", "C"]);
    assert.equal(rollup?.title, "2 more habits left today");
    assert.equal(rollup?.detail, "0 of 5 done");
    // The rollup goes somewhere, but it is not something you tick from here.
    assert.equal(rollup?.checklistItemId, undefined);
  });

  test("exactly three habits produce no rollup row", async () => {
    for (const title of ["A", "B", "C"]) await addHabit(title);
    const data = await fetchToday();
    assert.equal(data.items.find((i) => i.id === "checklist"), undefined);
  });

  test("nothing outstanding means nothing listed", async () => {
    const id = await addHabit("Read 20 pages");
    await db.execute({
      sql: "UPDATE checklist_items SET done = 1, done_date = ? WHERE id = ?",
      args: [todayISO(), id],
    });
    const data = await fetchToday();
    assert.deepEqual(data.items, []);
  });
});

describe("monthNet counts this month, and only this month", () => {
  /**
   * The add form accepts any date. An unbounded `date >= <month>-01` counts a
   * transaction dated next year toward this month — and keeps counting it
   * every month until it finally arrives.
   */
  async function spend(date: string, amount: number) {
    await db.execute({
      sql: "INSERT INTO finance_transactions (date, type, category, amount) VALUES (?,?,?,?)",
      args: [date, "expense", "Rent", amount],
    });
  }

  test("a transaction dated in a future month is not this month's spending", async () => {
    const { shiftISODate } = await import("@/lib/date");
    const today = todayISO();
    await spend(today, 100);
    // Comfortably into a later month, whatever today is.
    await spend(shiftISODate(today, 45), 5000);

    const data = await fetchToday();
    assert.equal(data.monthNet, -100);
  });

  test("last month's spending is not this month's either", async () => {
    const { shiftISODate } = await import("@/lib/date");
    const today = todayISO();
    await spend(today, 100);
    await spend(shiftISODate(today, -45), 5000);

    const data = await fetchToday();
    assert.equal(data.monthNet, -100);
  });

  test("income and expense net out within the month", async () => {
    const today = todayISO();
    await db.execute({
      sql: "INSERT INTO finance_transactions (date, type, category, amount) VALUES (?,?,?,?)",
      args: [today, "income", "Paycheck", 500],
    });
    await spend(today, 120);

    const data = await fetchToday();
    assert.equal(data.monthNet, 380);
  });
});

describe("overdue work says it is overdue", () => {
  /**
   * `relativeDay` collapsed everything in the past into "today", so an
   * assignment three weeks late rendered as "Assignment 4 due today" on the
   * home screen. That is the one fact you most need, stated backwards — and you
   * keep deprioritising the thing precisely because the app says it is fine.
   */
  async function task(title: string, dueOffsetDays: number, course = "CSE 143") {
    const { shiftISODate } = await import("@/lib/date");
    await db.execute({
      sql: "INSERT INTO school_tasks (course, title, due_date, status) VALUES (?,?,?,?)",
      args: [course, title, shiftISODate(todayISO(), dueOffsetDays), "Pending"],
    });
  }

  test("a missed deadline is never called 'today'", async () => {
    await task("Assignment 4", -21);
    const data = await fetchToday();
    const row = data.items.find((i) => i.kind === "school");
    assert.match(row!.title, /21 days ago/);
    assert.doesNotMatch(row!.title, /due today/);
  });

  test("yesterday and today read as themselves", async () => {
    await task("Late one", -1);
    await task("Due now", 0);
    const titles = (await fetchToday()).items.map((i) => i.title);
    assert.ok(titles.some((t) => /was due yesterday/.test(t)), titles.join(" | "));
    assert.ok(titles.some((t) => /due today/.test(t)), titles.join(" | "));
  });

  test("old overdue work cannot bury this week's deadlines", async () => {
    // The bug: `ORDER BY due_date ASC LIMIT 10` handed the whole list to the
    // ten *oldest* things never marked done, so tomorrow's exam never appeared.
    for (let i = 1; i <= 15; i++) await task(`Abandoned ${i}`, -100 - i);
    await task("Exam tomorrow", 1);

    const data = await fetchToday();
    const titles = data.items.map((i) => i.title);
    assert.ok(
      titles.some((t) => t.includes("Exam tomorrow")),
      `upcoming work was crowded out: ${titles.join(" | ")}`
    );
  });

  test("only the most recently missed are listed; the rest are counted", async () => {
    for (let i = 1; i <= 8; i++) await task(`Missed ${i}`, -i);

    const data = await fetchToday();
    const overdue = data.items.filter((i) => /was due/.test(i.title));
    assert.equal(overdue.length, 3);
    // Two different questions, answered differently on purpose. *Which* three
    // are listed: the most recently missed, because Friday is still actionable
    // and last term is a decision about whether it matters at all. What order
    // they appear in: most overdue first, because among things you missed this
    // week the one you missed earliest is the most urgent.
    assert.deepEqual(
      overdue.map((i) => i.title.split(" was due")[0]),
      ["Missed 3", "Missed 2", "Missed 1"]
    );

    const rollup = data.items.find((i) => i.id === "overdue-rollup");
    assert.equal(rollup?.title, "5 more things already overdue");
  });

  test("no rollup when nothing is hidden", async () => {
    await task("Missed 1", -1);
    await task("Missed 2", -2);
    const data = await fetchToday();
    assert.equal(data.items.find((i) => i.id === "overdue-rollup"), undefined);
  });

  test("overdue career actions count toward the same rollup", async () => {
    const { shiftISODate } = await import("@/lib/date");
    for (let i = 1; i <= 5; i++) {
      await db.execute({
        sql: `INSERT INTO applications (company, role, status, next_action_date, next_action_label)
              VALUES (?, ?, 'Applied', ?, 'OA due')`,
        args: [`Co ${i}`, "SWE", shiftISODate(todayISO(), -i)],
      });
    }
    const data = await fetchToday();
    const rollup = data.items.find((i) => i.id === "overdue-rollup");
    assert.equal(rollup?.title, "2 more things already overdue");
  });

  test("a finished task is never overdue", async () => {
    const { shiftISODate } = await import("@/lib/date");
    await db.execute({
      sql: "INSERT INTO school_tasks (course, title, due_date, status) VALUES (?,?,?,?)",
      args: ["CSE 143", "Handed in", shiftISODate(todayISO(), -30), "Done"],
    });
    assert.deepEqual((await fetchToday()).items, []);
  });

  test("a rejected application stops chasing you", async () => {
    const { shiftISODate } = await import("@/lib/date");
    await db.execute({
      sql: `INSERT INTO applications (company, role, status, next_action_date, next_action_label)
            VALUES (?, ?, 'Rejected', ?, 'OA due')`,
      args: ["Gone Inc", "SWE", shiftISODate(todayISO(), -3)],
    });
    assert.deepEqual((await fetchToday()).items, []);
  });

  test("overdue outranks everything, and the rollup sits just behind it", async () => {
    for (let i = 1; i <= 5; i++) await task(`Missed ${i}`, -i);
    await task("Due today", 0);
    await addHabit("Read 20 pages");

    const data = await fetchToday();
    const kinds = data.items.map((i) => i.id);
    // Three listed overdue, then the rollup, then today's work.
    assert.equal(kinds.indexOf("overdue-rollup"), 3);
    assert.ok(
      kinds.indexOf("overdue-rollup") < kinds.findIndex((k) => k.startsWith("habit-"))
    );
  });
});

describe("Today's ranking", () => {
  test("something due today outranks a habit, which outranks tomorrow", async () => {
    await addHabit("Read 20 pages");
    await db.execute({
      sql: "INSERT INTO school_tasks (course, title, due_date, status) VALUES (?,?,?,?)",
      args: ["CSE 143", "Due today", todayISO(), "Pending"],
    });
    const { shiftISODate } = await import("@/lib/date");
    await db.execute({
      sql: "INSERT INTO school_tasks (course, title, due_date, status) VALUES (?,?,?,?)",
      args: ["CSE 143", "Due tomorrow", shiftISODate(todayISO(), 1), "Pending"],
    });

    const data = await fetchToday();
    const kinds = data.items.map((i) => i.kind);
    assert.deepEqual(kinds, ["school", "habit", "school"]);
  });

  test("habits keep the order they were created in, not the sort's mercy", async () => {
    for (const title of ["First", "Second", "Third"]) await addHabit(title);
    const data = await fetchToday();
    assert.deepEqual(
      data.items.map((i) => i.title),
      ["First", "Second", "Third"]
    );
  });
});
