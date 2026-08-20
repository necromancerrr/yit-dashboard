import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { handleRoute, withDb, jsonError } from "@/lib/api-helpers";
import { CHALLENGE_COOKIE, challengeCookieOptions, getRelyingParty } from "@/lib/webauthn";

// Step 1 of signing in. This route is public — you cannot have a session yet.
// It leaks only which credential IDs exist, which are opaque random handles.
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const { rpID } = getRelyingParty(req);

    return withDb(async () => {
      const passkeys = await db.execute("SELECT credential_id, transports FROM passkeys");
      if (passkeys.rows.length === 0) {
        return jsonError("No passkeys registered yet — sign in with your password first.", 404);
      }

      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: passkeys.rows.map((row) => ({
          id: row.credential_id as string,
          transports: row.transports ? JSON.parse(row.transports as string) : undefined,
        })),
        userVerification: "required",
      });

      const res = NextResponse.json(options);
      res.cookies.set(CHALLENGE_COOKIE, options.challenge, challengeCookieOptions);
      return res;
    });
  });
}
