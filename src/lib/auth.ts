import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";

export const SESSION_COOKIE = "dash_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET env var must be set to a random string of at least 16 characters."
    );
  }
  return new TextEncoder().encode(secret);
}

export async function verifyPassword(candidate: string): Promise<boolean> {
  const hash = process.env.APP_PASSWORD_HASH;
  const plain = process.env.APP_PASSWORD;
  if (hash) {
    return bcrypt.compare(candidate, hash);
  }
  if (plain) {
    // Fallback for quick local setup; APP_PASSWORD_HASH is recommended for production.
    return candidate === plain;
  }
  throw new Error(
    "Set APP_PASSWORD_HASH (recommended, see scripts/hash-password.mjs) or APP_PASSWORD in your environment."
  );
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecret());
    return true;
  } catch {
    return false;
  }
}

export async function getSessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  };
}

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return verifySessionToken(token);
}
