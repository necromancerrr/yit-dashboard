import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "search-test-"));
process.env.DATABASE_URL = `file:${path.join(dir, "search.db")}`;
process.env.AI_PROVIDER = "none";

describe("search", () => {
  before(async () => {
    const { db, ensureDb } = await import("@/lib/db");
    await ensureDb();
    await db.execute({
      sql: "INSERT INTO finance_transactions (date, type, category, amount, note) VALUES (?,?,?,?,?)",
      args: ["2026-03-08", "expense", "Dentist", 240, "cleaning + x-ray"],
    });
    await db.execute({
      sql: "INSERT INTO finance_transactions (date, type, category, amount, note) VALUES (?,?,?,?,?)",
      args: ["2026-01-02", "expense", "Groceries", 62.1, "50% off produce"],
    });
    await db.execute({
      sql: "INSERT INTO school_tasks (course, title, due_date, status) VALUES (?,?,?,?)",
      args: ["CSE 143", "Assignment 4", "2026-04-02", "Pending"],
    });
    await db.execute({
      sql: "INSERT INTO crypto_holdings (symbol, name, quantity) VALUES (?,?,?)",
      args: ["ETH", "Ethereum", 1.25],
    });
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("finds a transaction by category", async () => {
    const { search } = await import("@/lib/search");
    const hits = await search("dentist");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, "money");
    assert.match(hits[0].detail!, /240/);
  });

  test("finds a transaction by its note, not just its category", async () => {
    const { search } = await import("@/lib/search");
    const hits = await search("x-ray");
    assert.equal(hits[0].title, "Dentist");
  });

  test("searches across sections at once", async () => {
    const { search } = await import("@/lib/search");
    const kinds = (await search("e")).map((h) => h.kind);
    // Two characters minimum, so a single letter finds nothing at all.
    assert.deepEqual(kinds, []);
    const found = await search("et");
    assert.ok(found.some((h) => h.kind === "crypto"), "should reach crypto holdings");
  });

  test("a literal % is not a wildcard", async () => {
    // Unescaped, "50%" would match every row in the database.
    const { search } = await import("@/lib/search");
    const hits = await search("50%");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].title, "Groceries");
  });

  test("orders dated rows most-recent first", async () => {
    const { search } = await import("@/lib/search");
    const dates = (await search("e")).map((h) => h.date);
    const withDates = dates.filter(Boolean) as string[];
    const sorted = [...withDates].sort((a, b) => b.localeCompare(a));
    assert.deepEqual(withDates, sorted);
  });

  test("returns nothing for a query too short to be a search", async () => {
    const { search } = await import("@/lib/search");
    assert.deepEqual(await search("d"), []);
    assert.deepEqual(await search("  "), []);
  });
});
