import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { handleRoute, withDb, jsonError } from "@/lib/api-helpers";
import {
  CHALLENGE_COOKIE,
  bytesToBase64url,
  describeDevice,
  getRelyingParty,
} from "@/lib/webauthn";

// The browser hands back a deeply nested structure that the library validates
// in full. Re-declaring all of it in Zod would just be a second schema to keep
// in sync, so we check the envelope and let verifyRegistrationResponse() do the
// real cryptographic validation.
const schema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal("public-key"),
  response: z.object({}).loose(),
  clientExtensionResults: z.object({}).loose().optional(),
  authenticatorAttachment: z.string().optional(),
  label: z.string().max(60).optional(),
});

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const body = schema.parse(await req.json());
    const expectedChallenge = req.cookies.get(CHALLENGE_COOKIE)?.value;
    if (!expectedChallenge) {
      return jsonError("That registration attempt expired — please try again.", 400);
    }

    const { rpID, origin } = getRelyingParty(req);

    const verification = await verifyRegistrationResponse({
      response: body as unknown as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    if (!verification.verified) {
      return jsonError("Could not verify that device", 400);
    }

    const { credential } = verification.registrationInfo;
    const label = body.label?.trim() || describeDevice(req.headers.get("user-agent"));

    return withDb(async () => {
      await db.execute({
        sql: `INSERT INTO passkeys (credential_id, public_key, counter, transports, label)
              VALUES (?, ?, ?, ?, ?)`,
        args: [
          credential.id,
          // Only the public key is persisted — the private key stayed in the
          // device's secure hardware and is not obtainable, even by its owner.
          bytesToBase64url(credential.publicKey),
          credential.counter,
          credential.transports ? JSON.stringify(credential.transports) : null,
          label,
        ],
      });

      const res = NextResponse.json({ ok: true, label }, { status: 201 });
      // A challenge is single-use by definition; burn it.
      res.cookies.delete(CHALLENGE_COOKIE);
      return res;
    });
  });
}
