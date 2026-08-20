import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { getMailProvider } from "@/lib/ingest/gmail";

/**
 * Connection state for external accounts.
 *
 * `configured` reflects the environment, `status` reflects the last sync. They
 * differ in the case worth reporting clearly: credentials present but the last
 * refresh rejected them, which reads as "connected but broken" rather than
 * "not set up".
 *
 * Columns are listed explicitly rather than SELECT *, so a credential column
 * added later cannot leak through this route by default.
 */
export async function GET() {
  return handleRoute(async () => {
    return withDb(async () => {
      const rows = await db.execute(
        `SELECT id, provider, status, account_label, last_synced_at, last_error
           FROM integrations ORDER BY provider`
      );

      const stored = new Map(rows.rows.map((r) => [r.provider as string, r]));
      const gmail = stored.get("gmail");

      return NextResponse.json({
        items: [
          {
            provider: "gmail",
            configured: getMailProvider() !== null,
            status: (gmail?.status as string | undefined) ?? "disconnected",
            last_synced_at: (gmail?.last_synced_at as string | null) ?? null,
            last_error: (gmail?.last_error as string | null) ?? null,
          },
        ],
      });
    });
  });
}
