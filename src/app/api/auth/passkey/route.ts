import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";

// Managing your own devices. Behind the proxy, so it needs a session.
// Deliberately does not return public_key or credential_id — the UI has no use
// for them, and the less key material moves around, the better.
export async function GET() {
  return handleRoute(async () => {
    return withDb(async () => {
      const result = await db.execute(
        "SELECT id, label, created_at, last_used_at FROM passkeys ORDER BY id DESC"
      );
      return NextResponse.json({ items: result.rows });
    });
  });
}
