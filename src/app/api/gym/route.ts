import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, withDb, todayISO } from "@/lib/api-helpers";

const createSchema = z.object({
  date: z.string().min(1).default(() => todayISO()),
  workout_type: z.string().min(1, "Workout type is required"),
  duration_min: z.coerce.number().int().nonnegative().nullable().optional(),
  notes: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "100");
    return withDb(async () => {
      const result = await db.execute({
        sql: "SELECT * FROM gym_logs ORDER BY date DESC, id DESC LIMIT ?",
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
        sql: "INSERT INTO gym_logs (date, workout_type, duration_min, notes) VALUES (?, ?, ?, ?) RETURNING *",
        args: [body.date, body.workout_type, body.duration_min ?? null, body.notes ?? null],
      });
      return NextResponse.json({ item: result.rows[0] }, { status: 201 });
    });
  });
}
