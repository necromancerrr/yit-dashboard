import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, jsonError, withDb } from "@/lib/api-helpers";
import { ALL_STATUSES, applyEvent } from "@/lib/career";
import type { ApplicationStatus } from "@/lib/types";

const statusEnum = z.enum(ALL_STATUSES as [ApplicationStatus, ...ApplicationStatus[]]);

const createSchema = z.object({
  kind: z.enum(["status_change", "note", "deadline"]),
  to_status: statusEnum.optional().nullable(),
  occurred_on: z.string().optional(),
  detail: z.string().optional().nullable(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { id } = await params;
    return withDb(async () => {
      const result = await db.execute({
        sql: `SELECT * FROM application_events
              WHERE application_id = ?
              ORDER BY occurred_on DESC, id DESC`,
        args: [id],
      });
      return NextResponse.json({ items: result.rows });
    });
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { id } = await params;
    const body = createSchema.parse(await req.json());

    return withDb(async () => {
      const result = await applyEvent({
        applicationId: Number(id),
        kind: body.kind,
        toStatus: body.to_status ?? null,
        occurredOn: body.occurred_on,
        detail: body.detail ?? null,
        source: "manual",
      });

      if (!result.applied) return jsonError(result.reason, 409);

      const events = await db.execute({
        sql: `SELECT * FROM application_events
              WHERE application_id = ?
              ORDER BY occurred_on DESC, id DESC`,
        args: [id],
      });
      return NextResponse.json({ items: events.rows }, { status: 201 });
    });
  });
}
