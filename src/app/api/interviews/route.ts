import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";

const createSchema = z.object({
  company: z.string().min(1, "Company is required"),
  role: z.string().optional().nullable(),
  stage: z
    .enum(["Applied", "OA", "Phone Screen", "Technical", "Onsite", "Offer", "Rejected"])
    .default("Applied"),
  date: z.string().optional().nullable(),
  status: z.enum(["Upcoming", "Completed", "Waiting", "Closed"]).default("Upcoming"),
  notes: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "200");
    return withDb(async () => {
      const result = await db.execute({
        sql: "SELECT * FROM interviews ORDER BY (date IS NULL), date ASC, id DESC LIMIT ?",
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
        sql: `INSERT INTO interviews (company, role, stage, date, status, notes)
              VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
        args: [
          body.company,
          body.role ?? null,
          body.stage,
          body.date ?? null,
          body.status,
          body.notes ?? null,
        ],
      });
      return NextResponse.json({ item: result.rows[0] }, { status: 201 });
    });
  });
}
