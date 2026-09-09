import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleRoute, jsonError, withDb } from "@/lib/api-helpers";

/**
 * Hand a shared image to the page, exactly once.
 *
 * The row is deleted as it is read. A shared screenshot is a one-time
 * handoff, not a library — leaving it behind would mean the app quietly
 * accumulated copies of everything you ever shared into it.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { id } = await params;
    return withDb(async () => {
      const result = await db.execute({
        sql: "SELECT media_type, data FROM shared_images WHERE id = ?",
        args: [id],
      });
      const row = result.rows[0];
      if (!row) return jsonError("That shared image is no longer available.", 404);

      await db.execute({ sql: "DELETE FROM shared_images WHERE id = ?", args: [id] });

      return NextResponse.json({
        image: `data:${row.media_type as string};base64,${row.data as string}`,
      });
    });
  });
}
