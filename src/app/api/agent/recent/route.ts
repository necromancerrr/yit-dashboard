import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, jsonError, withDb } from "@/lib/api-helpers";
import { requireAgentKey, isAgentKeyError } from "@/lib/agent-auth";

/**
 * Read-only recent entries for the agent: "did I already log LC 206 today?"
 * and "what's on the dashboard this week?" The agent checks here before
 * writing, so a repeated mention doesn't become a duplicate row.
 */

const RECENT_SOURCES: Record<string, { table: string; orderBy: string }> = {
  leetcode: { table: "leetcode_logs", orderBy: "date DESC, id DESC" },
  workout: { table: "gym_logs", orderBy: "date DESC, id DESC" },
  checklist: { table: "checklist_items", orderBy: "id DESC" },
  transaction: { table: "finance_transactions", orderBy: "date DESC, id DESC" },
  school_task: { table: "school_tasks", orderBy: "id DESC" },
  application: { table: "applications", orderBy: "id DESC" },
};

const querySchema = z.object({
  type: z.enum(["leetcode", "workout", "checklist", "transaction", "school_task", "application"]),
  limit: z.coerce.number().int().positive().max(50).default(5),
});

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const key = await requireAgentKey(req);
    if (isAgentKeyError(key)) return jsonError(key.error, 401);

    const params = querySchema.parse({
      type: req.nextUrl.searchParams.get("type"),
      limit: req.nextUrl.searchParams.get("limit") ?? undefined,
    });
    const source = RECENT_SOURCES[params.type];

    return withDb(async () => {
      const result = await db.execute({
        sql: `SELECT * FROM ${source.table} ORDER BY ${source.orderBy} LIMIT ?`,
        args: [params.limit],
      });
      return NextResponse.json({ items: result.rows });
    });
  });
}
