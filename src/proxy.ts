import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Exact paths only, never a prefix. A prefix like "/api/auth/passkey" would
// also expose the *registration* routes, letting anyone who can reach the login
// page enrol their own fingerprint and walk in. Only the two steps of the
// sign-in ceremony belong here — enrolling a device still requires a session.
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/passkey/login/options",
  "/api/auth/passkey/login/verify",
  "/manifest.webmanifest",
  // The service worker script itself. It is fetched by the browser's worker
  // machinery, not by the page, and a redirect to /login there is served as
  // HTML — which fails registration outright with a MIME type error. It ships
  // no data of its own; everything it caches still goes through this proxy.
  "/sw.js",
  // The offline fallback document, so the worker can precache it during
  // install and so opening the app with no signal while signed out lands on a
  // page that explains itself rather than a login form that cannot load. It is
  // static, client-only, and reads nothing.
  "/offline",
];
// Next.js's generated icon/manifest routes — browsers and "add to home
// screen" fetch these before (and regardless of) auth, so they can't be
// gated behind the login redirect the way the rest of the app is.
const PUBLIC_PREFIXES = ["/icon", "/apple-icon"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const valid = token ? await verifySessionToken(token) : false;

  if (!valid) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
