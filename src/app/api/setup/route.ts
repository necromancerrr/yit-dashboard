import { NextResponse } from "next/server";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { getSetupStatus } from "@/lib/setup-status";

/**
 * What is configured, and what it costs when something is not.
 *
 * Behind the proxy like every other route. It reports on secrets without ever
 * returning one — see the rule at the top of `src/lib/setup-status.ts`.
 */
export async function GET() {
  return handleRoute(async () => {
    return withDb(async () => NextResponse.json(await getSetupStatus()));
  });
}
