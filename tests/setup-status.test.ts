import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// DATABASE_URL must be set before @/lib/db is imported — that module resolves
// it once at load, the same reason tests/pipeline.test.ts does this.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-test-"));
process.env.DATABASE_URL = `file:${path.join(dir, "setup.db")}`;

const SECRETS = {
  ANTHROPIC_API_KEY: "sk-ant-do-not-leak-me-0123456789",
  DEEPSEEK_API_KEY: "dk-also-secret-9876543210",
  APP_PASSWORD: "hunter2-plaintext",
  AUTH_SECRET: "a-signing-secret-at-least-16-chars",
  DATABASE_AUTH_TOKEN: "turso-token-abcdef",
};

describe("setup status", () => {
  before(() => {
    for (const [k, v] of Object.entries(SECRETS)) process.env[k] = v;
    process.env.APP_TIMEZONE = "America/New_York";
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("never returns a secret, or any part of one", async () => {
    const { ensureDb } = await import("@/lib/db");
    const { getSetupStatus } = await import("@/lib/setup-status");
    await ensureDb();

    const serialized = JSON.stringify(await getSetupStatus());

    for (const [name, value] of Object.entries(SECRETS)) {
      assert.ok(!serialized.includes(value), `${name}'s value leaked into the status`);
      // Also refuse a partial reveal — a "sk-ant-do…" preview is still a leak.
      assert.ok(
        !serialized.includes(value.slice(0, 12)),
        `${name} leaked a recognisable prefix`
      );
    }
  });

  test("reports each capability with a level and a fix when it is wrong", async () => {
    const { getSetupStatus } = await import("@/lib/setup-status");
    const { checks } = await getSetupStatus();

    const ids = checks.map((c) => c.id);
    for (const expected of ["database", "password", "passkeys", "timezone", "text-ai", "vision-ai"]) {
      assert.ok(ids.includes(expected), `missing check: ${expected}`);
    }

    for (const check of checks) {
      assert.ok(check.status.length > 0, `${check.id} has no status`);
      // Anything not OK must say what to do about it, or it is just a red dot.
      if (check.level !== "ok") {
        assert.ok(check.fix && check.fix.length > 0, `${check.id} is ${check.level} with no fix`);
      }
    }
  });

  test("a local file database is flagged, because deploying it loses data", async () => {
    const { getSetupStatus } = await import("@/lib/setup-status");
    const { checks } = await getSetupStatus();
    const database = checks.find((c) => c.id === "database");
    assert.equal(database?.level, "warn");
    assert.match(String(database?.fix), /erased|Turso|libSQL/i);
  });
});
