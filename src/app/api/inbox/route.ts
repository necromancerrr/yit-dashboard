import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { refreshDerivedInbox } from "@/lib/inbox";

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const state = req.nextUrl.searchParams.get("state") ?? "open";
    return withDb(async () => {
      // Derived items are recomputed on read rather than by a cron job: there
      // is exactly one user, and the only moment the inbox needs to be current
      // is the moment it is looked at.
      await refreshDerivedInbox();

      const result = await db.execute({
        sql: `SELECT i.*, a.company AS application_company, a.role AS application_role
              FROM inbox_items i
              LEFT JOIN applications a ON a.id = i.application_id
              WHERE i.state = ?
              ORDER BY
                CASE i.severity WHEN 'urgent' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END,
                i.created_at DESC
              LIMIT 100`,
        args: [state],
      });
      return NextResponse.json({ items: result.rows });
    });
  });
}
