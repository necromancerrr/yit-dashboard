import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleRoute, jsonError, withDb } from "@/lib/api-helpers";
import { getMailProvider } from "@/lib/ingest/gmail";
import { ingestMessages, SYNC_BATCH_LIMIT } from "@/lib/ingest/pipeline";

/**
 * Pull new messages and run them through the pipeline.
 *
 * Only messages newer than the stored cursor are fetched, so a sync costs the
 * same whether the mailbox has a hundred messages or a hundred thousand. The
 * cursor advances only after a successful run: a failed sync re-reads the same
 * window next time rather than skipping it, and re-reading is safe because
 * external_events deduplicates.
 *
 * POST rather than GET because this writes.
 */
export async function POST() {
  return handleRoute(async () => {
    const provider = getMailProvider();
    if (!provider) {
      return jsonError(
        "No mailbox is connected. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and " +
          "GMAIL_REFRESH_TOKEN to enable email sync.",
        503
      );
    }

    return withDb(async () => {
      const existing = await db.execute({
        sql: "SELECT id, cursor FROM integrations WHERE provider = ?",
        args: [provider.name],
      });

      let integrationId: number;
      let cursor: string | null;
      if (existing.rows.length > 0) {
        integrationId = Number(existing.rows[0].id);
        cursor = (existing.rows[0].cursor as string | null) ?? null;
      } else {
        const created = await db.execute({
          sql: `INSERT INTO integrations (provider, status) VALUES (?, 'connected') RETURNING id`,
          args: [provider.name],
        });
        integrationId = Number(created.rows[0].id);
        cursor = null;
      }

      try {
        const { messages, nextCursor } = await provider.fetchSince(cursor, SYNC_BATCH_LIMIT);
        const outcome = await ingestMessages(provider.name, messages, integrationId);

        await db.execute({
          sql: `UPDATE integrations
                SET cursor = ?, status = 'connected', last_synced_at = datetime('now'),
                    last_error = NULL, updated_at = datetime('now')
                WHERE id = ?`,
          args: [nextCursor, integrationId],
        });

        return NextResponse.json({ ok: true, ...outcome });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Sync failed";
        // Record the failure and leave the cursor alone, so the next run
        // retries the same window instead of stepping over it.
        await db.execute({
          sql: `UPDATE integrations
                SET status = 'error', last_error = ?, updated_at = datetime('now')
                WHERE id = ?`,
          args: [message, integrationId],
        });
        return jsonError(message, 502);
      }
    });
  });
}
