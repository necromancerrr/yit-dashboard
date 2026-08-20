import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { CHALLENGE_COOKIE, challengeCookieOptions, getRelyingParty } from "@/lib/webauthn";
import { getBrandName, getDisplayName } from "@/lib/identity";

// Step 1 of registering a device. The proxy already required a valid session to
// reach this route, which is the whole security model here: you must prove you
// are the owner *with the password* before you can enrol a new passkey.
// Otherwise anyone who found the login page could add their own fingerprint.
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const { rpID } = getRelyingParty(req);

    return withDb(async () => {
      const existing = await db.execute("SELECT credential_id, transports FROM passkeys");

      const options = await generateRegistrationOptions({
        rpName: getBrandName(),
        rpID,
        userName: getDisplayName(),
        userDisplayName: getDisplayName(),
        // Single-user app: there is exactly one account, so the user handle is
        // a constant rather than a row in a users table.
        userID: new TextEncoder().encode("owner"),
        attestationType: "none",
        // Stops you from registering the same device twice.
        excludeCredentials: existing.rows.map((row) => ({
          id: row.credential_id as string,
          transports: row.transports ? JSON.parse(row.transports as string) : undefined,
        })),
        authenticatorSelection: {
          residentKey: "preferred",
          // "required" is what actually forces Face ID / Touch ID / a PIN,
          // rather than merely proving the device is present.
          userVerification: "required",
        },
      });

      const res = NextResponse.json(options);
      res.cookies.set(CHALLENGE_COOKIE, options.challenge, challengeCookieOptions);
      return res;
    });
  });
}
