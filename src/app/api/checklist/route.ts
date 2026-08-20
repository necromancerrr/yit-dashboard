import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { rolloverRecurringChecklist } from "@/lib/checklist";

const createSchema = z.object({
  title: z.string().min(1, "Title is required"),
  category: z.string().min(1).default("General"),
  recurring: z.boolean().default(false),
});

export async function GET() {
  return handleRoute(async () => {
    return withDb(async () => {
      await rolloverRecurringChecklist();
      const result = await db.execute(
        "SELECT * FROM checklist_items ORDER BY done ASC, category ASC, id DESC"
      );
      return NextResponse.json({ items: result.rows });
    });
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const body = createSchema.parse(await req.json());
    return withDb(async () => {
      const result = await db.execute({
        sql: `INSERT INTO checklist_items (title, category, recurring) VALUES (?, ?, ?) RETURNING *`,
        args: [body.title, body.category, body.recurring ? 1 : 0],
      });
      return NextResponse.json({ item: result.rows[0] }, { status: 201 });
    });
  });
}
