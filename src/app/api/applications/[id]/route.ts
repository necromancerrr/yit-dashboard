import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { ALL_STATUSES, applyEvent } from "@/lib/career";
import type { ApplicationStatus } from "@/lib/types";

const statusEnum = z.enum(ALL_STATUSES as [ApplicationStatus, ...ApplicationStatus[]]);

const updateSchema = z.object({
  company: z.string().min(1).optional(),
  role: z.string().nullable().optional(),
  status: statusEnum.optional(),
  applied_date: z.string().nullable().optional(),
  next_action_date: z.string().nullable().optional(),
  next_action_label: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { id } = await params;
    return withDb(async () => {
      const [app, events] = await Promise.all([
        db.execute({ sql: "SELECT * FROM applications WHERE id = ?", args: [id] }),
        db.execute({
          sql: `SELECT * FROM application_events
                WHERE application_id = ?
                ORDER BY occurred_on DESC, id DESC`,
          args: [id],
        }),
      ]);
      if (app.rows.length === 0) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ item: app.rows[0], events: events.rows });
    });
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { id } = await params;
    const body = updateSchema.parse(await req.json());

    return withDb(async () => {
      // Status is not an ordinary column: it is the projection of the event
      // log. Route it through applyEvent so the change lands in the timeline,
      // and update only the plain fields here.
      const { status, ...plain } = body;

      const fields = Object.entries(plain).filter(([, v]) => v !== undefined);
      if (fields.length > 0) {
        const setClause = fields.map(([k]) => `${k} = ?`).join(", ");
        await db.execute({
          sql: `UPDATE applications SET ${setClause}, updated_at = datetime('now') WHERE id = ?`,
          args: [...fields.map(([, v]) => v as string | null), id],
        });
      }

      if (status !== undefined) {
        await applyEvent({
          applicationId: Number(id),
          kind: "status_change",
          toStatus: status,
          detail: "Status changed",
          source: "manual",
        });
      }

      const result = await db.execute({
        sql: "SELECT * FROM applications WHERE id = ?",
        args: [id],
      });
      return NextResponse.json({ item: result.rows[0] });
    });
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { id } = await params;
    return withDb(async () => {
      // The event log is meaningless without its application, and inbox items
      // pointing at a deleted row would render as orphans.
      await db.execute({ sql: "DELETE FROM application_events WHERE application_id = ?", args: [id] });
      await db.execute({ sql: "DELETE FROM inbox_items WHERE application_id = ?", args: [id] });
      await db.execute({ sql: "DELETE FROM applications WHERE id = ?", args: [id] });
      return NextResponse.json({ ok: true });
    });
  });
}
