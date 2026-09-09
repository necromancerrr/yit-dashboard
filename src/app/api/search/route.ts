import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { search } from "@/lib/search";

const querySchema = z.object({ q: z.string().max(100) });

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const { q } = querySchema.parse({ q: req.nextUrl.searchParams.get("q") ?? "" });
    return withDb(async () => NextResponse.json({ items: await search(q) }));
  });
}
