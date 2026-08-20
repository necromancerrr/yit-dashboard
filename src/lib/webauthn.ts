import type { NextRequest } from "next/server";

// WebAuthn ties every credential to a "relying party" — in practice, your
// domain. A signature made for one domain is worthless on another, which is
// what makes passkeys phishing-proof. We derive it from the incoming request
// so the same code works on localhost, a preview URL, and production without
// any configuration to keep in sync.
export interface RelyingParty {
  rpID: string;
  origin: string;
}

export function getRelyingParty(req: NextRequest): RelyingParty {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto =
    req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return {
    // rpID is the bare domain — no protocol, no port.
    rpID: host.split(":")[0],
    origin: `${proto}://${host}`,
  };
}

// The challenge is a random value the authenticator has to sign, and it exists
// purely to stop replay attacks: a signature over yesterday's challenge is not
// accepted today. It isn't secret, but it must survive exactly one round trip
// and must not be attacker-controlled — so it rides in a short-lived httpOnly
// cookie rather than in the page, where script could tamper with it.
export const CHALLENGE_COOKIE = "dash_webauthn_challenge";

export const challengeCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 300, // 5 minutes — long enough to look at your phone, short enough to matter.
};

/** Base64URL is the encoding WebAuthn uses everywhere; SQLite stores it as TEXT. */
export function bytesToBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

// The return type is deliberately `Uint8Array<ArrayBuffer>`, not a bare
// `Uint8Array`. Since TypeScript 5.7 the array is generic over its backing
// buffer, and a bare annotation widens to `ArrayBufferLike` (which allows a
// SharedArrayBuffer) — which the WebAuthn types then reject.
export function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const buffer = Buffer.from(value, "base64url");
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}

/**
 * A best-effort friendly name for the device being registered, so the list of
 * passkeys reads like "iPhone" rather than a base64 blob.
 */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent)) return "Android device";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "Mac";
  if (/Windows/i.test(userAgent)) return "Windows PC";
  if (/Linux/i.test(userAgent)) return "Linux device";
  return "Unknown device";
}
