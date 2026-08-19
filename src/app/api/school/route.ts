import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";

const createSchema = z.object({
  course: z.string().min(1, "Course is required"),
  title: z.string().min(1, "Title is required"),
  due_date: z.string().optional().nullable(),
  status: z.enum(["Pending", "In Progress", "Done"]).default("Pending"),
  grade: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "200");
    return withDb(async () => {
      const result = await db.execute({
        sql: "SELECT * FROM school_tasks ORDER BY (due_date IS NULL), due_date ASC, id DESC LIMIT ?",
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
        sql: `INSERT INTO school_tasks (course, title, due_date, status, grade, notes)
              VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
        args: [
          body.course,
          body.title,
          body.due_date ?? null,
          body.status,
          body.grade ?? null,
          body.notes ?? null,
        ],
      });
      return NextResponse.json({ item: result.rows[0] }, { status: 201 });
    });
  });
}
