import { NextResponse } from "next/server";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { listRules } from "@/lib/autonomy/trust";

/**
 * Who may act without asking, and what each one has earned.
 *
 * The verdict is computed here rather than in the client so the panel shows the
 * exact sentence the pipeline enforced — a rule that reads "2 of 3
 * confirmations" on screen and behaves differently in the sync would make the
 * whole feature unfalsifiable.
 */
export async function GET() {
  return handleRoute(async () =>
    withDb(async () => NextResponse.json({ items: await listRules() }))
  );
}
