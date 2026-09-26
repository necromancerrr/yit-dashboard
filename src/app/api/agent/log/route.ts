import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, jsonError, withDb, todayISO } from "@/lib/api-helpers";
import { requireAgentKey, isAgentKeyError } from "@/lib/agent-auth";

/**
 * The agent's write path: how Muse logs things to the dashboard from a
 * conversation ("I solved LC 206", "gym done, push day 45 min").
 *
 * Auth is `Authorization: Bearer <key>` (see src/lib/agent-auth.ts) — the
 * proxy lets /api/agent/* through without a session cookie, and this route
 * answers 401 without a valid key.
 *
 * Every entry point mirrors the validation of the matching user-facing POST
 * route, and agent-written rows carry source='Muse' so the UI can tell them
 * apart from things typed by hand. Writes are idempotent where it matters:
 * logging the same LeetCode problem twice on one day returns the existing
 * row instead of a duplicate.
 */

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .default(() => todayISO());

const entrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("leetcode"),
    date: dateField,
    problem_name: z.string().min(1).max(200),
    difficulty: z.enum(["Easy", "Medium", "Hard"]).default("Medium"),
    topic: z.string().max(200).optional().nullable(),
    url: z.string().url().max(500).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    type: z.literal("workout"),
    date: dateField,
    workout_type: z.string().min(1).max(100),
    duration_min: z.coerce.number().int().positive().max(1440).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    type: z.literal("checklist"),
    title: z.string().min(1).max(200),
    category: z.string().max(100).default("General"),
    recurring: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("transaction"),
    date: dateField,
    kind: z.enum(["income", "expense"]).default("expense"),
    category: z.string().max(100).default("Other"),
    amount: z.coerce.number().positive().max(1_000_000_000),
    note: z.string().max(500).optional().nullable(),
  }),
  z.object({
    type: z.literal("school_task"),
    course: z.string().min(1).max(200),
    title: z.string().min(1).max(200),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "due_date must be YYYY-MM-DD")
      .optional()
      .nullable(),
    status: z.string().max(50).default("Pending"),
    notes: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    type: z.literal("application"),
    company: z.string().min(1).max(200),
    role: z.string().max(200).optional().nullable(),
    status: z.string().max(50).default("Applied"),
    applied_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "applied_date must be YYYY-MM-DD")
      .optional()
      .nullable(),
    url: z.string().url().max(500).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  }),
]);

type Entry = z.infer<typeof entrySchema>;

async function insertLeetCode(e: Extract<Entry, { type: "leetcode" }>) {
  // Mentioned twice in one day (chat + a re-ask) → one row, not two.
  const existing = await db.execute({
    sql: "SELECT * FROM leetcode_logs WHERE date = ? AND lower(problem_name) = lower(?) LIMIT 1",
    args: [e.date, e.problem_name],
  });
  if (existing.rows.length > 0) return { row: existing.rows[0], deduped: true };
  const result = await db.execute({
    sql: `INSERT INTO leetcode_logs (date, problem_name, difficulty, topic, url, notes, source)
          VALUES (?, ?, ?, ?, ?, ?, 'Muse') RETURNING *`,
    args: [e.date, e.problem_name, e.difficulty, e.topic ?? null, e.url ?? null, e.notes ?? null],
  });
  return { row: result.rows[0], deduped: false };
}

async function insertWorkout(e: Extract<Entry, { type: "workout" }>) {
  const result = await db.execute({
    sql: `INSERT INTO gym_logs (date, workout_type, duration_min, notes, source)
          VALUES (?, ?, ?, ?, 'Muse') RETURNING *`,
    args: [e.date, e.workout_type, e.duration_min ?? null, e.notes ?? null],
  });
  return { row: result.rows[0], deduped: false };
}

async function insertChecklist(e: Extract<Entry, { type: "checklist" }>) {
  const result = await db.execute({
    sql: `INSERT INTO checklist_items (title, category, recurring, source)
          VALUES (?, ?, ?, 'Muse') RETURNING *`,
    args: [e.title, e.category, e.recurring ? 1 : 0],
  });
  return { row: result.rows[0], deduped: false };
}

async function insertTransaction(e: Extract<Entry, { type: "transaction" }>) {
  const result = await db.execute({
    sql: `INSERT INTO finance_transactions (date, type, category, amount, note, source)
          VALUES (?, ?, ?, ?, ?, 'Muse') RETURNING *`,
    args: [e.date, e.kind, e.category, e.amount, e.note ?? null],
  });
  return { row: result.rows[0], deduped: false };
}

async function insertSchoolTask(e: Extract<Entry, { type: "school_task" }>) {
  const result = await db.execute({
    sql: `INSERT INTO school_tasks (course, title, due_date, status, notes, source)
          VALUES (?, ?, ?, ?, ?, 'Muse') RETURNING *`,
    args: [e.course, e.title, e.due_date ?? null, e.status, e.notes ?? null],
  });
  return { row: result.rows[0], deduped: false };
}

async function insertApplication(e: Extract<Entry, { type: "application" }>) {
  const result = await db.execute({
    sql: `INSERT INTO applications (company, role, status, applied_date, url, notes, source, last_activity_date)
          VALUES (?, ?, ?, ?, ?, ?, 'Muse', date('now')) RETURNING *`,
    args: [e.company, e.role ?? null, e.status, e.applied_date ?? null, e.url ?? null, e.notes ?? null],
  });
  return { row: result.rows[0], deduped: false };
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const key = await requireAgentKey(req);
    if (isAgentKeyError(key)) return jsonError(key.error, 401);

    const entry = entrySchema.parse(await req.json());

    return withDb(async () => {
      let outcome: { row: unknown; deduped: boolean };
      switch (entry.type) {
        case "leetcode":
          outcome = await insertLeetCode(entry);
          break;
        case "workout":
          outcome = await insertWorkout(entry);
          break;
        case "checklist":
          outcome = await insertChecklist(entry);
          break;
        case "transaction":
          outcome = await insertTransaction(entry);
          break;
        case "school_task":
          outcome = await insertSchoolTask(entry);
          break;
        case "application":
          outcome = await insertApplication(entry);
          break;
      }
      return NextResponse.json(
        { item: outcome.row, deduped: outcome.deduped, logged_by: key.name },
        { status: outcome.deduped ? 200 : 201 }
      );
    });
  });
}
