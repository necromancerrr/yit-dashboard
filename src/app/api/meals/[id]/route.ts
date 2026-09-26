import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  source_url: z.string().url().nullable().optional(),
  source_author: z.string().max(200).nullable().optional(),
  cover_image_url: z.string().url().nullable().optional(),
  ingredients: z.array(z.string().min(1)).max(100).nullable().optional(),
  steps: z.array(z.string().min(1)).max(100).nullable().optional(),
  prep_min: z.coerce.number().int().nonnegative().max(10080).nullable().optional(),
  cook_min: z.coerce.number().int().nonnegative().max(10080).nullable().optional(),
  servings: z.coerce.number().int().positive().max(100).nullable().optional(),
  calories: z.coerce.number().int().nonnegative().max(20000).nullable().optional(),
  protein_g: z.coerce.number().nonnegative().max(1000).nullable().optional(),
  tags: z.string().max(500).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  times_cooked: z.coerce.number().int().nonnegative().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleRoute(async () => {
    const { id } = await params;
    const body = updateSchema.parse(await req.json());
    // Arrays cross the API boundary as arrays and rest in the DB as JSON
    // text; encode here so the SET clause below only ever sees scalars.
    const encoded: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      encoded[k] = Array.isArray(v) ? (v.length > 0 ? JSON.stringify(v) : null) : (v as string | number | null);
    }
    const fields = Object.entries(encoded);
    if (fields.length === 0) return NextResponse.json({ ok: true });
    return withDb(async () => {
      const setClause = fields.map(([k]) => `${k} = ?`).join(", ");
      const args = fields.map(([, v]) => v);
      await db.execute({
        sql: `UPDATE meal_preps SET ${setClause}, updated_at = datetime('now') WHERE id = ?`,
        args: [...args, id],
      });
      const result = await db.execute({ sql: "SELECT * FROM meal_preps WHERE id = ?", args: [id] });
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
      await db.execute({ sql: "DELETE FROM meal_preps WHERE id = ?", args: [id] });
      return NextResponse.json({ ok: true });
    });
  });
}
