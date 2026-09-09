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
