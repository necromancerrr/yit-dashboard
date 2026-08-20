import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, jsonError, withDb } from "@/lib/api-helpers";
import { applyEvent } from "@/lib/career";

const updateSchema = z.object({
  state: z.enum(["open", "confirmed", "dismissed"]),
});

/**
 * Resolve an inbox item.
 *
 * Confirming an item that carries a proposed status is the moment inference
 * becomes fact: the transition is written through applyEvent with source
 * 'manual', because you confirming it is a decision you made, and it should
 * lock the status against later contradiction the same way a hand edit does.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { id } = await params;
    const body = updateSchema.parse(await req.json());

    return withDb(async () => {
      const existing = await db.execute({
        sql: "SELECT * FROM inbox_items WHERE id = ?",
        args: [id],
      });
      if (existing.rows.length === 0) return jsonError("Not found", 404);

      const item = existing.rows[0];

      if (body.state === "confirmed" && item.proposed_status && item.application_id) {
        await applyEvent({
          applicationId: Number(item.application_id),
          kind: "status_change",
          toStatus: item.proposed_status as string,
          detail: `Confirmed: ${item.title as string}`,
          source: "manual",
          externalEventId: item.external_event_id ? Number(item.external_event_id) : null,
        });
      }

      await db.execute({
        sql: `UPDATE inbox_items
              SET state = ?, resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE datetime('now') END
              WHERE id = ?`,
        args: [body.state, body.state, id],
      });

      const updated = await db.execute({ sql: "SELECT * FROM inbox_items WHERE id = ?", args: [id] });
      return NextResponse.json({ item: updated.rows[0] });
    });
  });
}
