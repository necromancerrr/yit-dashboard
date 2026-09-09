import { NextRequest, NextResponse } from "next/server";
import { handleRoute, withDb, jsonError } from "@/lib/api-helpers";
import { undoAction } from "@/lib/autonomy/journal";

/**
 * Take back one thing the sync did on its own.
 *
 * Durable, unlike the five-second undo on a manual delete: a receipt
 * auto-applied in March is still undoable in June. The journal is permanent and
 * costs a few kilobytes, while the moment you notice a wrong row is not
 * something the app gets to schedule.
 *
 * If you already edited the row, it is kept as you left it and the response
 * says so. Undo must never cost you an edit you made deliberately.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { id } = await params;
    const actionId = Number(id);
    if (!Number.isInteger(actionId)) return jsonError("Not a valid action", 422);

    return withDb(async () => {
      try {
        const { result, message } = await undoAction(actionId);
        return NextResponse.json({ ok: true, result, message });
      } catch {
        return jsonError("No such action", 404);
      }
    });
  });
}
