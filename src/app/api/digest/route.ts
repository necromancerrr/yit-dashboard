import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { getDigest, markReviewed } from "@/lib/autonomy/journal";

/**
 * What the sync did while you were away.
 *
 * The queue is the thing being complained about, so this replaces the
 * *interaction*, not just a threshold: a list of what already happened, each
 * line saying why it was allowed and offering an undo — rather than a stack of
 * questions blocking on your attention.
 *
 * Deterministic, straight from SQL. A model may later phrase the summary, but
 * the list underneath is facts this route computed, exactly as `/api/today`
 * ranks by real dates and lets the model only phrase the result.
 */
export async function GET() {
  return handleRoute(async () =>
    withDb(async () => NextResponse.json(await getDigest()))
  );
}

const reviewSchema = z.object({
  /** Acknowledge one sync, or everything when omitted. */
  runId: z.string().optional(),
});

/**
 * "Looks right" — one tap for a whole run, and only when you feel like it.
 *
 * Nothing is blocked on this. Not reviewing costs nothing except that trust
 * stops growing, which is the correct direction: a system being ignored should
 * become less autonomous, not more.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const body = reviewSchema.parse(await req.json().catch(() => ({})));
    return withDb(async () => {
      const reviewed = await markReviewed(body.runId);
      return NextResponse.json({ ok: true, reviewed });
    });
  });
}
