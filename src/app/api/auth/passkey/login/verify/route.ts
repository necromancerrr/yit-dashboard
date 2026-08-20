import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { handleRoute, withDb, jsonError } from "@/lib/api-helpers";
import { createSessionToken, getSessionCookieOptions } from "@/lib/auth";
import { CHALLENGE_COOKIE, base64urlToBytes, getRelyingParty } from "@/lib/webauthn";
import { todayISO } from "@/lib/date";

const schema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal("public-key"),
  response: z.object({}).loose(),
  clientExtensionResults: z.object({}).loose().optional(),
});

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const body = schema.parse(await req.json());
    const expectedChallenge = req.cookies.get(CHALLENGE_COOKIE)?.value;
    if (!expectedChallenge) {
      return jsonError("That sign-in attempt expired — please try again.", 400);
    }

    const { rpID, origin } = getRelyingParty(req);

    return withDb(async () => {
      const found = await db.execute({
        sql: "SELECT * FROM passkeys WHERE credential_id = ?",
        args: [body.id],
      });
      const passkey = found.rows[0];
      if (!passkey) return jsonError("Unrecognized device", 401);

      const verification = await verifyAuthenticationResponse({
        response: body as unknown as AuthenticationResponseJSON,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: passkey.credential_id as string,
          publicKey: base64urlToBytes(passkey.public_key as string),
          counter: Number(passkey.counter),
          transports: passkey.transports ? JSON.parse(passkey.transports as string) : undefined,
        },
      });

      if (!verification.verified) return jsonError("Could not verify that device", 401);

      // The signature counter only ever moves forward. If a device replays an
      // old value, that is the signal a credential has been cloned — the
      // library enforces it, we just have to persist the new number.
      await db.execute({
        sql: "UPDATE passkeys SET counter = ?, last_used_at = ? WHERE credential_id = ?",
        args: [verification.authenticationInfo.newCounter, todayISO(), body.id],
      });

      // From here on it is an ordinary session: the same cookie the password
      // flow issues, so every other route stays unaware passkeys exist.
      const token = await createSessionToken();
      const options = await getSessionCookieOptions();
      const res = NextResponse.json({ ok: true });
      res.cookies.set(options.name, token, options);
      res.cookies.delete(CHALLENGE_COOKIE);
      return res;
    });
  });
}
