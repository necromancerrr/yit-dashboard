import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, jsonError, withDb } from "@/lib/api-helpers";
import { applyEvent, ALL_STATUSES } from "@/lib/career";
import { todayISO } from "@/lib/date";
import { matchApplication, type MatchCandidate } from "@/lib/ingest/match";
import type { ApplicationStatus } from "@/lib/types";

const updateSchema = z.object({
  state: z.enum(["open", "confirmed", "dismissed"]),
});

async function matchExistingApplication(
  company: string,
  role: string | null,
  threadId: string | null
): Promise<number | null> {
  const candidateRows = await db.execute({
    sql: `SELECT a.id, a.company, a.role, a.status,
                 (SELECT e.thread_id FROM external_events e
                   JOIN application_events ae ON ae.external_event_id = e.id
                  WHERE ae.application_id = a.id AND e.thread_id IS NOT NULL
                  ORDER BY ae.id DESC LIMIT 1) AS thread_id
            FROM applications a`,
    args: [],
  });
  const candidates = candidateRows.rows as unknown as MatchCandidate[];
  const match = matchApplication({ company, role }, candidates, threadId);
  return match.ambiguous ? null : match.applicationId;
}

async function createApplicationFromInboxItem(item: Record<string, unknown>): Promise<number | null> {
  const status = item.proposed_status as ApplicationStatus | null;
  const company = item.proposed_company as string | null;
  if (!status || !company || !ALL_STATUSES.includes(status)) return null;

  const external = item.external_event_id
    ? await db.execute({
        sql: "SELECT * FROM external_events WHERE id = ?",
        args: [Number(item.external_event_id)],
      })
    : null;
  const message = external?.rows[0] ?? null;
  const occurredOn = (message?.occurred_at as string | null) ?? todayISO();
  const role = (item.proposed_role as string | null) ?? null;
  const existingId = await matchExistingApplication(
    company,
    role,
    (message?.thread_id as string | null) ?? null
  );

  if (existingId) {
    await applyEvent({
      applicationId: existingId,
      kind: "status_change",
      toStatus: status,
      occurredOn,
      detail: `Confirmed from email: ${(message?.subject as string | null) ?? item.title}`,
      source: "manual",
      externalEventId: item.external_event_id ? Number(item.external_event_id) : null,
      confidence: typeof item.confidence === "number" ? item.confidence : null,
    });
    return existingId;
  }

  const nextActionDate = (item.proposed_next_action_date as string | null) ?? null;
  const created = await db.batch(
    [
      {
        sql: `INSERT INTO applications
                (company, role, status, applied_date, next_action_date, next_action_label,
                 source, status_locked, last_activity_date)
              VALUES (?, ?, ?, ?, ?, ?, 'gmail', 0, ?)
              RETURNING id`,
        args: [
          company,
          role,
          status,
          status === "Applied" ? occurredOn : null,
          nextActionDate,
          nextActionDate ? `${status} due` : null,
          occurredOn,
        ],
      },
      {
        sql: `INSERT INTO application_events
                (application_id, kind, from_status, to_status, occurred_on, detail, source,
                 external_event_id, confidence)
              VALUES (last_insert_rowid(), 'created', NULL, ?, ?, ?, 'gmail', ?, ?)`,
        args: [
          status,
          occurredOn,
          `Created from confirmed email: ${(message?.subject as string | null) ?? item.title}`,
          item.external_event_id ? Number(item.external_event_id) : null,
          typeof item.confidence === "number" ? item.confidence : null,
        ],
      },
    ],
    "write"
  );
  const applicationId = Number(created[0].rows[0].id);

  return applicationId;
}

/**
 * Resolve an inbox item.
 *
 * Confirming an item that carries a proposed status is the moment inference
 * becomes fact: the transition is written through applyEvent with source
 * 'manual', because you confirming it is a decision you made, and it should
 * lock the status against later contradiction the same way a hand edit does.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { id } = await params;
    const body = updateSchema.parse(await req.json());

    return withDb(async () => {
      const existing = await db.execute({
        sql: "SELECT * FROM inbox_items WHERE id = ?",
        args: [id],
      });
      if (existing.rows.length === 0) return jsonError("Not found", 404);

      const item = existing.rows[0];

      if (body.state === "confirmed" && item.proposed_status && item.application_id) {
        await applyEvent({
          applicationId: Number(item.application_id),
          kind: "status_change",
          toStatus: item.proposed_status as string,
          detail: `Confirmed: ${item.title as string}`,
          source: "manual",
          externalEventId: item.external_event_id ? Number(item.external_event_id) : null,
        });
      }

      if (
        body.state === "confirmed" &&
        item.proposed_status &&
        !item.application_id &&
        item.proposed_company
      ) {
        const applicationId = await createApplicationFromInboxItem(item);
        if (applicationId) {
          await db.execute({
            sql: "UPDATE inbox_items SET application_id = ? WHERE id = ?",
            args: [applicationId, id],
          });
        }
      }

      await db.execute({
        sql: `UPDATE inbox_items
              SET state = ?, resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE datetime('now') END
              WHERE id = ?`,
        args: [body.state, body.state, id],
      });

      const updated = await db.execute({ sql: "SELECT * FROM inbox_items WHERE id = ?", args: [id] });
      return NextResponse.json({ item: updated.rows[0] });
    });
  });
}
