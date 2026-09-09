import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, jsonError, withDb } from "@/lib/api-helpers";
import { setRuleMode } from "@/lib/autonomy/trust";

/**
 * Take autonomy back — or grant it — one sender at a time.
 *
 * `never` is absolute: no accumulated confidence overrules it, mirroring how
 * `AI_PROVIDER=none` is honoured absolutely. `auto` is its mirror image, a
 * deliberate grant for a sender you already know you trust, which does not wait
 * for the counter.
 *
 * Per-source rather than global, because "stop doing this with Amazon" and
 * "stop doing this at all" are different decisions and collapsing them into one
 * switch is what makes people turn the whole feature off.
 */
const updateSchema = z.object({
  mode: z.enum(["ask", "auto", "never"]),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const { id } = await params;
    const body = updateSchema.parse(await req.json());

    return withDb(async () => {
      const rule = await setRuleMode(Number(id), body.mode);
      if (!rule) return jsonError("Not found", 404);
      return NextResponse.json({ item: rule });
    });
  });
}
