import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";

const updateSchema = z.object({
  course: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(["Pending", "In Progress", "Done"]).optional(),
  grade: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleRoute(async () => {
    const { id } = await params;
    const body = updateSchema.parse(await req.json());
    const fields = Object.entries(body).filter(([, v]) => v !== undefined);
    if (fields.length === 0) return NextResponse.json({ ok: true });
    return withDb(async () => {
      const setClause = fields.map(([k]) => `${k} = ?`).join(", ");
      const args = fields.map(([, v]) => v as string | null);
      await db.execute({
        sql: `UPDATE school_tasks SET ${setClause}, updated_at = datetime('now') WHERE id = ?`,
        args: [...args, id],
      });
      const result = await db.execute({ sql: "SELECT * FROM school_tasks WHERE id = ?", args: [id] });
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
      await db.execute({ sql: "DELETE FROM school_tasks WHERE id = ?", args: [id] });
      return NextResponse.json({ ok: true });
    });
  });
}
