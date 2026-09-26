import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleRoute, jsonError, withDb } from "@/lib/api-helpers";

/** Revoke an agent API key. Immediate: the next call with it gets a 401. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { id } = await params;
    return withDb(async () => {
      const result = await db.execute({
        sql: "DELETE FROM api_keys WHERE id = ? RETURNING id",
        args: [Number(id)],
      });
      if (result.rows.length === 0) return jsonError("Key not found", 404);
      return NextResponse.json({ ok: true });
    });
  });
}
