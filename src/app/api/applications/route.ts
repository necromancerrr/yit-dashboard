import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { todayISO } from "@/lib/date";
import { ALL_STATUSES } from "@/lib/career";
import type { ApplicationStatus } from "@/lib/types";

const statusEnum = z.enum(ALL_STATUSES as [ApplicationStatus, ...ApplicationStatus[]]);

const createSchema = z.object({
  company: z.string().min(1, "Company is required"),
  role: z.string().optional().nullable(),
  status: statusEnum.default("Applied"),
  applied_date: z.string().optional().nullable(),
  next_action_date: z.string().optional().nullable(),
  next_action_label: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "200");
    return withDb(async () => {
      // Open applications first, then by the date that matters next, so the
      // list already reads as a work queue rather than a filing cabinet.
      const result = await db.execute({
        sql: `SELECT * FROM applications
              ORDER BY
                CASE WHEN status IN ('Rejected', 'Withdrawn') THEN 1 ELSE 0 END,
                (next_action_date IS NULL),
                next_action_date ASC,
                id DESC
              LIMIT ?`,
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
      const appliedDate = body.applied_date ?? todayISO();
      // status_locked stays 0: picking a starting status is filing an
      // application, not correcting one, so it must not stop this application
      // from advancing on its own later.
      const result = await db.execute({
        sql: `INSERT INTO applications
                (company, role, status, applied_date, next_action_date, next_action_label,
                 location, url, notes, source, status_locked, last_activity_date)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 0, ?)
              RETURNING *`,
        args: [
          body.company,
          body.role ?? null,
          body.status,
          appliedDate,
          body.next_action_date ?? null,
          body.next_action_label ?? null,
          body.location ?? null,
          body.url ?? null,
          body.notes ?? null,
          appliedDate,
        ],
      });

      // Seed the timeline immediately. An application whose history is empty
      // cannot explain its own status, which defeats the event log.
      const application = result.rows[0];
      await db.execute({
        sql: `INSERT INTO application_events
                (application_id, kind, from_status, to_status, occurred_on, detail, source)
              VALUES (?, 'created', NULL, ?, ?, 'Application added', 'manual')`,
        args: [Number(application.id), body.status, appliedDate],
      });

      return NextResponse.json({ item: application }, { status: 201 });
    });
  });
}
