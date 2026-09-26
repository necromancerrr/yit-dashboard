import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { generateApiKey } from "@/lib/agent-auth";

/**
 * Session-authenticated management of agent API keys (NOT under /api/agent —
 * these are for the human in the browser, so they ride the session cookie).
 *
 * The raw key is returned exactly once, at creation. After that the UI can
 * never show it again: only the hash is stored.
 */

const createSchema = z.object({
  name: z.string().min(1, "Give the key a name").max(100),
});

export async function GET() {
  return handleRoute(async () => {
    return withDb(async () => {
      const result = await db.execute(
        "SELECT id, name, created_at, last_used_at FROM api_keys ORDER BY id DESC"
      );
      return NextResponse.json({ items: result.rows });
    });
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const { name } = createSchema.parse(await req.json());
    const { raw, hash } = generateApiKey();
    return withDb(async () => {
      const result = await db.execute({
        sql: "INSERT INTO api_keys (name, key_hash) VALUES (?, ?) RETURNING id, name, created_at",
        args: [name.trim(), hash],
      });
      const row = result.rows[0];
      return NextResponse.json(
        {
          item: { id: row.id, name: row.name, created_at: row.created_at },
          // Shown once. The dashboard never stores this.
          key: raw,
        },
        { status: 201 }
      );
    });
  });
}
