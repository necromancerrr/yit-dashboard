import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, withDb, todayISO } from "@/lib/api-helpers";

const createSchema = z.object({
  date: z.string().min(1).default(() => todayISO()),
  problem_name: z.string().min(1, "Problem name is required"),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).default("Medium"),
  topic: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "200");
    return withDb(async () => {
      const result = await db.execute({
        sql: "SELECT * FROM leetcode_logs ORDER BY date DESC, id DESC LIMIT ?",
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
        sql: "INSERT INTO leetcode_logs (date, problem_name, difficulty, topic, url, notes) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
        args: [
          body.date,
          body.problem_name,
          body.difficulty,
          body.topic ?? null,
          body.url ?? null,
          body.notes ?? null,
        ],
      });
      return NextResponse.json({ item: result.rows[0] }, { status: 201 });
    });
  });
}
