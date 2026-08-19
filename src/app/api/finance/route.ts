import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, withDb, todayISO } from "@/lib/api-helpers";

const createSchema = z.object({
  date: z.string().min(1).default(() => todayISO()),
  type: z.enum(["income", "expense"]).default("expense"),
  category: z.string().min(1, "Category is required"),
  amount: z.coerce.number().positive("Amount must be positive"),
  note: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "300");
    return withDb(async () => {
      const result = await db.execute({
        sql: "SELECT * FROM finance_transactions ORDER BY date DESC, id DESC LIMIT ?",
        args: [limit],
      });
      return NextResponse.json({ items: result.rows });
    });
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const body = createSchema.parse(await req.json());
    return withDb(async () => {
      const result = await db.execute({
        sql: `INSERT INTO finance_transactions (date, type, category, amount, note)
              VALUES (?, ?, ?, ?, ?) RETURNING *`,
        args: [body.date, body.type, body.category, body.amount, body.note ?? null],
      });
      return NextResponse.json({ item: result.rows[0] }, { status: 201 });
    });
  });
}
