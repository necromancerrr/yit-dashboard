import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, jsonError, withDb } from "@/lib/api-helpers";
import { applyEvent, ALL_STATUSES } from "@/lib/career";
import { todayISO } from "@/lib/date";
import { matchApplication, type MatchCandidate } from "@/lib/ingest/match";
import type { ApplicationStatus } from "@/lib/types";

const statusSchema = z.enum(ALL_STATUSES as [ApplicationStatus, ...ApplicationStatus[]]);
const updateSchema = z
  .object({
    state: z.enum(["open", "confirmed", "dismissed"]).optional(),
    proposed_company: z.string().trim().min(1).max(160).nullable().optional(),
    proposed_role: z.string().trim().max(240).nullable().optional(),
    proposed_status: statusSchema.nullable().optional(),
    proposed_next_action_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "No changes supplied",
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

      const hasProposalEdits =
        body.proposed_company !== undefined ||
        body.proposed_role !== undefined ||
        body.proposed_status !== undefined ||
        body.proposed_next_action_date !== undefined;

      if (hasProposalEdits) {
        await db.execute({
          sql: `UPDATE inbox_items SET
                  proposed_company = CASE WHEN ? = 1 THEN ? ELSE proposed_company END,
                  proposed_role = CASE WHEN ? = 1 THEN ? ELSE proposed_role END,
                  proposed_status = CASE WHEN ? = 1 THEN ? ELSE proposed_status END,
                  proposed_next_action_date = CASE
                    WHEN ? = 1 THEN ? ELSE proposed_next_action_date END
                WHERE id = ?`,
          args: [
            body.proposed_company !== undefined ? 1 : 0,
            body.proposed_company ?? null,
            body.proposed_role !== undefined ? 1 : 0,
            body.proposed_role ?? null,
            body.proposed_status !== undefined ? 1 : 0,
            body.proposed_status ?? null,
            body.proposed_next_action_date !== undefined ? 1 : 0,
            body.proposed_next_action_date ?? null,
            id,
          ],
        });
      }

      let current = await db.execute({ sql: "SELECT * FROM inbox_items WHERE id = ?", args: [id] });
      let item = current.rows[0];

      if (hasProposalEdits && item.proposed_status) {
        const application = item.application_id
          ? await db.execute({
              sql: "SELECT company, role FROM applications WHERE id = ?",
              args: [Number(item.application_id)],
            })
          : null;
        const applicationRow = application?.rows[0];
        const company =
          (applicationRow?.company as string | null) ??
          (item.proposed_company as string | null) ??
          "an employer";
        const roleName =
          (item.proposed_role as string | null) ??
          (applicationRow?.role as string | null) ??
          null;
        const role = roleName ? ` · ${roleName}` : "";
        const title = item.application_id
          ? `${company}${role} — move to ${item.proposed_status as string}?`
          : `Create ${company}${role} as ${item.proposed_status as string}?`;
        await db.execute({
          sql: "UPDATE inbox_items SET title = ? WHERE id = ?",
          args: [title, id],
        });
        current = await db.execute({ sql: "SELECT * FROM inbox_items WHERE id = ?", args: [id] });
        item = current.rows[0];
      }

      if (!body.state) {
        return NextResponse.json({ item });
      }

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
        !item.application_id
      ) {
        const company = (item.proposed_company as string | null)?.trim();
        if (!company || /^an? employer$/i.test(company)) {
          return jsonError("Correct the employer before confirming this proposal.", 400);
        }
        const applicationId = await createApplicationFromInboxItem(item);
        if (!applicationId) return jsonError("This proposal could not create an application.", 400);
        await db.execute({
          sql: "UPDATE inbox_items SET application_id = ? WHERE id = ?",
          args: [applicationId, id],
        });
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
