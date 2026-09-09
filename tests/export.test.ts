import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The export is the promise that nothing you log here is locked in. That
 * promise is kept by hand — someone adds a table to `SCHEMA` and has to
 * remember `/api/export` — and a table missed there fails silently: the export
 * still downloads, still looks complete, and is quietly missing a year of your
 * data. You find out when you need the file, which is the worst moment.
 *
 * So this reads both files and fails when they drift. Three tables are
 * deliberately excluded, and each exclusion is named here as well as in the
 * route, because "why isn't this in the export?" must never be answered by
 * guessing.
 */

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

/** Tables that must NOT be exported, and the reason each one is out. */
const DELIBERATELY_EXCLUDED: Record<string, string> = {
  // An export ends up in cloud storage and email attachments.
  passkeys: "holds credential material",
  // Restoring it into a fresh database would suppress backfills still due.
  schema_migrations: "bookkeeping about the database, not data about the owner",
  // Deleted as it is read; anything left is in flight, not history.
  shared_images: "a transient handoff",
};

function schemaTables(): string[] {
  const db = read("src/lib/db.ts");
  return [...db.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
}

function exportedTables(): string[] {
  const route = read("src/app/api/export/route.ts");
  return [...route.matchAll(/FROM (\w+)/g)].map((m) => m[1]);
}

describe("the export stays complete", () => {
  test("the source files parse — otherwise the checks below are vacuous", () => {
    assert.ok(schemaTables().length >= 15, "failed to read table names out of SCHEMA");
    assert.ok(exportedTables().length >= 10, "failed to read table names out of the export route");
  });

  test("every table in SCHEMA is either exported or deliberately excluded", () => {
    const exported = new Set(exportedTables());
    for (const table of schemaTables()) {
      if (DELIBERATELY_EXCLUDED[table]) continue;
      assert.ok(
        exported.has(table),
        `${table} is in SCHEMA but not in /api/export. Add it there, or add it to ` +
          `DELIBERATELY_EXCLUDED in this test with the reason it stays out.`
      );
    }
  });

  test("nothing excluded has crept into the export", () => {
    const exported = new Set(exportedTables());
    for (const [table, reason] of Object.entries(DELIBERATELY_EXCLUDED)) {
      assert.ok(!exported.has(table), `${table} must stay out of the export: it ${reason}.`);
    }
  });

  test("every excluded table still exists — a stale exclusion hides a real gap", () => {
    const tables = new Set(schemaTables());
    for (const table of Object.keys(DELIBERATELY_EXCLUDED)) {
      assert.ok(
        tables.has(table),
        `${table} is excluded here but no longer exists in SCHEMA. Remove the exclusion.`
      );
    }
  });

  test("the exported payload names every table it queries", () => {
    // A table can be SELECTed and then dropped on the floor when building the
    // JSON — the query proves nothing on its own.
    const route = read("src/app/api/export/route.ts");
    const payload = route.slice(route.indexOf("const payload = {"), route.indexOf("return new NextResponse"));
    for (const table of exportedTables()) {
      assert.ok(
        payload.includes(`${table}:`),
        `${table} is queried by the export but never put in the payload.`
      );
    }
  });

  test("integrations is read column-by-column, not with SELECT *", () => {
    // It holds no secrets today. Listing columns is what keeps that true if one
    // is ever added.
    const route = read("src/app/api/export/route.ts");
    assert.ok(
      !/SELECT \* FROM integrations/.test(route),
      "integrations must list its columns explicitly, so a secret added later is not exported by default."
    );
  });
});
