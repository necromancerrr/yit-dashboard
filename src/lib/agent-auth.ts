import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withDb } from "@/lib/api-helpers";

/**
 * Machine credentials for the agent API (`/api/agent/*`).
 *
 * The dashboard's normal auth is a session cookie in a browser. An agent
 * calling from a server has no browser, so these routes take
 * `Authorization: Bearer <key>` instead. Keys are random 32-byte tokens
 * shown once at creation; only the SHA-256 hash is stored, so a database
 * leak doesn't hand out access.
 *
 * The proxy lets `/api/agent/*` through without a session cookie (see
 * proxy.ts) — every route under it must call `requireAgentKey`, no
 * exceptions.
 */

const KEY_PREFIX = "yit_";

function hashKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** A new raw key plus its hash. The raw key is shown once, then forgotten. */
export function generateApiKey(): { raw: string; hash: string } {
  const raw = KEY_PREFIX + randomBytes(32).toString("base64url");
  return { raw, hash: hashKey(raw) };
}

export interface AgentKey {
  id: number;
  name: string;
}

/**
 * Verify the request's Bearer token against api_keys. Returns the key on
 * success, or a 401-shaped error message on failure. Also bumps last_used_at
 * — a key that never shows a "last used" date after setup is a key whose
 * wiring is broken, and that's worth seeing on the Security page.
 */
export async function requireAgentKey(req: NextRequest): Promise<AgentKey | { error: string }> {
  const header = req.headers.get("authorization");
  const raw = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
  if (!raw) return { error: "Missing Authorization: Bearer <key>" };

  return withDb(async () => {
    const found = await db.execute({
      sql: "SELECT id, name FROM api_keys WHERE key_hash = ?",
      args: [hashKey(raw)],
    });
    const row = found.rows[0];
    if (!row) return { error: "Invalid API key" };
    const key: AgentKey = { id: Number(row.id), name: String(row.name) };
    await db.execute({
      sql: "UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?",
      args: [key.id],
    });
    return key;
  });
}

/** Type guard for the requireAgentKey result. */
export function isAgentKeyError(value: AgentKey | { error: string }): value is { error: string } {
  return "error" in value;
}
