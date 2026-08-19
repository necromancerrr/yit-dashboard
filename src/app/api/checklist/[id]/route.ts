import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, withDb, todayISO } from "@/lib/api-helpers";

const updateSchema = z.object({
  done: z.boolean().optional(),
  title: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleRoute(async () => {
    const { id } = await params;
    const body = updateSchema.parse(await req.json());
    return withDb(async () => {
      if (body.done !== undefined) {
        await db.execute({
          sql: "UPDATE checklist_items SET done = ?, done_date = ? WHERE id = ?",
          args: [body.done ? 1 : 0, body.done ? todayISO() : null, id],
        });
      }
      if (body.title !== undefined) {
        await db.execute({ sql: "UPDATE checklist_items SET title = ? WHERE id = ?", args: [body.title, id] });
      }
      if (body.category !== undefined) {
        await db.execute({ sql: "UPDATE checklist_items SET category = ? WHERE id = ?", args: [body.category, id] });
      }
      const result = await db.execute({ sql: "SELECT * FROM checklist_items WHERE id = ?", args: [id] });
      return NextResponse.json({ item: result.rows[0] });
    });
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleRoute(async () => {
    const { id } = await params;
    return withDb(async () => {
      await db.execute({ sql: "DELETE FROM checklist_items WHERE id = ?", args: [id] });
      return NextResponse.json({ ok: true });
    });
  });
}
