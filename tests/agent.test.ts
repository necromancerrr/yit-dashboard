import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { NextRequest } from "next/server";

// A throwaway database: the agent routes write, so they must never run
// against the real dev file. Set before the db module first loads (all db
// imports below are dynamic, inside before()).
const TEST_DB = `/tmp/yit-agent-test-${process.pid}.db`;
process.env.DATABASE_URL = `file:${TEST_DB}`;

type AgentAuth = typeof import("@/lib/agent-auth");
type Db = typeof import("@/lib/db");
type ApiHelpers = typeof import("@/lib/api-helpers");
type LogRoute = typeof import("@/app/api/agent/log/route");
type RecentRoute = typeof import("@/app/api/agent/recent/route");

let agentAuth: AgentAuth;
let db: Db["db"];
let withDb: ApiHelpers["withDb"];
let logPOST: LogRoute["POST"];
let recentGET: RecentRoute["GET"];

before(async () => {
  agentAuth = await import("@/lib/agent-auth");
  const dbMod = await import("@/lib/db");
  db = dbMod.db;
  withDb = (await import("@/lib/api-helpers")).withDb;
  logPOST = (await import("@/app/api/agent/log/route")).POST;
  recentGET = (await import("@/app/api/agent/recent/route")).GET;
});

after(() => {
  try {
    fs.unlinkSync(TEST_DB);
  } catch {
    // Already gone or never created.
  }
});

function authedRequest(raw: string | null, path = "/api/agent/log"): NextRequest {
  const headers: Record<string, string> = {};
  if (raw) headers.authorization = `Bearer ${raw}`;
  return new NextRequest(`http://localhost${path}`, { headers });
}

async function seedKey(name: string): Promise<string> {
  const { raw, hash } = agentAuth.generateApiKey();
  await withDb(async () => {
    await db.execute({ sql: "INSERT INTO api_keys (name, key_hash) VALUES (?, ?)", args: [name, hash] });
  });
  return raw;
}

function postLog(rawKey: string | null, payload: unknown): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (rawKey) headers.authorization = `Bearer ${rawKey}`;
  return logPOST(
    new NextRequest("http://localhost/api/agent/log", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    })
  ) as Promise<Response>;
}

describe("agent API keys", () => {
  test("generateApiKey returns a show-once raw key and a stored hash", () => {
    const a = agentAuth.generateApiKey();
    const b = agentAuth.generateApiKey();
    assert.ok(a.raw.startsWith("yit_"));
    assert.match(a.hash, /^[0-9a-f]{64}$/);
    assert.notEqual(a.raw, b.raw);
    assert.notEqual(a.hash, b.hash);
  });

  test("requireAgentKey rejects missing and wrong credentials", async () => {
    const missing = await agentAuth.requireAgentKey(authedRequest(null));
    assert.ok(agentAuth.isAgentKeyError(missing));
    assert.match(missing.error, /Missing/i);

    const wrong = await agentAuth.requireAgentKey(authedRequest("yit_wrong"));
    assert.ok(agentAuth.isAgentKeyError(wrong));
    assert.match(wrong.error, /Invalid/i);
  });

  test("a created key authenticates and bumps last_used_at", async () => {
    const raw = await seedKey("test");
    const ok = await agentAuth.requireAgentKey(authedRequest(raw));
    assert.ok(!agentAuth.isAgentKeyError(ok));
    assert.equal(ok.name, "test");

    const rows = await withDb(async () =>
      db.execute({ sql: "SELECT last_used_at FROM api_keys WHERE name = ?", args: ["test"] })
    );
    assert.ok(rows.rows[0].last_used_at);
  });
});

describe("POST /api/agent/log", () => {
  let rawKey: string;

  test("setup: create a key", async () => {
    rawKey = await seedKey("agent-test");
  });

  test("401 without a key", async () => {
    const res = await postLog(null, { type: "leetcode", problem_name: "Two Sum" });
    assert.equal(res.status, 401);
  });

  test("logs a LeetCode solve attributed to Muse", async () => {
    const res = await postLog(rawKey, { type: "leetcode", problem_name: "LC 206", difficulty: "Easy" });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { item: Record<string, unknown>; deduped: boolean };
    assert.equal(body.item.problem_name, "LC 206");
    assert.equal(body.item.source, "Muse");
    assert.equal(body.deduped, false);
  });

  test("the same problem twice in one day dedupes", async () => {
    const res = await postLog(rawKey, { type: "leetcode", problem_name: "lc 206", difficulty: "Easy" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { deduped: boolean };
    assert.equal(body.deduped, true);
  });

  test("logs a workout and a checklist item", async () => {
    const workout = await postLog(rawKey, { type: "workout", workout_type: "Push", duration_min: 45 });
    assert.equal(workout.status, 201);
    const wbody = (await workout.json()) as { item: Record<string, unknown> };
    assert.equal(wbody.item.source, "Muse");

    const item = await postLog(rawKey, { type: "checklist", title: "Read 20 min" });
    assert.equal(item.status, 201);
  });

  test("422 on an unknown entry type", async () => {
    const res = await postLog(rawKey, { type: "teleport" });
    assert.equal(res.status, 422);
  });
});

describe("GET /api/agent/recent", () => {
  test("returns recent entries for the agent to check before writing", async () => {
    const raw = await seedKey("recent-test");
    const res = (await recentGET(
      new NextRequest("http://localhost/api/agent/recent?type=leetcode&limit=5", {
        headers: { authorization: `Bearer ${raw}` },
      })
    )) as Response;
    assert.equal(res.status, 200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    assert.ok(body.items.some((i) => i.problem_name === "LC 206"));
  });

  test("401 without a key", async () => {
    const res = (await recentGET(
      new NextRequest("http://localhost/api/agent/recent?type=leetcode")
    )) as Response;
    assert.equal(res.status, 401);
  });
});
