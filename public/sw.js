/*
 * Yit OS service worker — hand written, no framework.
 *
 * Why it lives in public/ rather than being bundled: a service worker only
 * controls pages *below its own URL*. Served from public/ it sits at the origin
 * root, so its scope is "/" with no Service-Worker-Allowed header and no
 * bundler asset-emission to reason about. The Next.js PWA guide's
 * `new URL(..., import.meta.url)` form emits the worker under /_next/static,
 * which cannot claim the whole app without extra header plumbing.
 *
 * Nothing in src/ can be imported here (this file is not bundled), so the two
 * strings shared with the app — the offline envelope key and the offline page
 * URL — are duplicated in src/lib/offline.ts and asserted equal by
 * tests/offline.test.ts.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a cached response is never handed back
 * as though it were live. Either it is labelled stale in its own body, or it is
 * not served at all.
 */

// Bump VERSION to retire every cache this worker owns. It is the only knob:
// caches are namespaced by it, and activate deletes anything that doesn't match.
const VERSION = "1";
const SHELL_CACHE = `yit-shell-v${VERSION}`;
const ASSET_CACHE = `yit-assets-v${VERSION}`;
const API_CACHE = `yit-api-v${VERSION}`;
const OWNED_CACHES = [SHELL_CACHE, ASSET_CACHE, API_CACHE];

const OFFLINE_URL = "/offline";

// Kept deliberately tiny. Hashed build assets are cached on first use instead
// of listed here — there is no build-time manifest, and guessing chunk names
// would go stale on every deploy.
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icon-192", "/icon-512"];

/**
 * Requests the worker must not touch at all.
 *
 * - /share is the OS share target: an inbound POST from another app. Non-GET
 *   is already ignored below, but the path is listed too so a future GET
 *   variant can never be answered from a cache.
 * - /api/auth/* mints and destroys the session cookie. A cached login or
 *   passkey response is a security bug, not a convenience.
 * - export / ingest / import are one-shot side-effecting operations; a cached
 *   answer would be meaningless.
 */
const BYPASS_PREFIXES = ["/share", "/api/auth/", "/api/export", "/api/ingest/", "/api/import/"];

/**
 * Endpoints whose body only means anything at a live market price.
 *
 * These are never written to a cache and never answered from one. A portfolio
 * value from yesterday shown as today's is worse than showing nothing: you
 * would act on it without questioning it. Offline, these fail loudly instead.
 */
const LIVE_PRICE_ROUTES = ["/api/crypto"];

/**
 * Live-priced fields hiding inside responses that are otherwise fine to serve
 * stale. /api/today is mostly deadlines and counts — all still true tomorrow —
 * but it also carries a crypto valuation. Rather than lose the whole screen
 * offline, the worker nulls the price-derived fields and names them in the
 * offline envelope, so the UI renders a dash instead of a stale number.
 */
const LIVE_PRICE_FIELDS = {
  "/api/today": ["netWorthSnapshot"],
};

/** Immutable-by-URL assets. Everything here is content-hashed or an icon. */
const ASSET_PREFIXES = ["/_next/static/", "/icon", "/apple-icon", "/favicon", "/manifest.webmanifest"];

// --- policy helpers (pure; exercised directly by tests/offline.test.ts) ------

function isBypassed(pathname) {
  return BYPASS_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function isLivePriceRoute(pathname) {
  return LIVE_PRICE_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isApi(pathname) {
  return pathname.startsWith("/api/");
}

function isAsset(pathname) {
  return ASSET_PREFIXES.some((p) => pathname.startsWith(p)) || pathname.endsWith(".svg");
}

/** Cacheable = an API GET that is neither bypassed nor live-priced. */
function isCacheableApi(pathname) {
  return isApi(pathname) && !isBypassed(pathname) && !isLivePriceRoute(pathname);
}

self.__swPolicy = { isBypassed, isLivePriceRoute, isApi, isAsset, isCacheableApi, OFFLINE_URL, OWNED_CACHES };

// --- lifecycle ---------------------------------------------------------------

self.addEventListener("install", (event) => {
  // No skipWaiting() here. See the "message" handler below for why the update
  // is put to the user instead of taken automatically.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, not addAll: one 404 must not abandon the whole install.
      await Promise.allSettled(
        PRECACHE.map(async (url) => {
          const res = await fetch(url, { cache: "reload", credentials: "same-origin" });
          if (res.ok && !res.redirected) await cache.put(url, res);
        })
      );
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("yit-") && !OWNED_CACHES.includes(n)).map((n) => caches.delete(n))
      );
      // Claim on activate so the *first* install controls the already-open page
      // and starts caching immediately. This is safe precisely because it only
      // happens when there was no previous worker to disagree with; a
      // replacement worker reaches activate only after the user accepted it.
      await self.clients.claim();
    })()
  );
});

/*
 * Update strategy: prompt, don't self-upgrade.
 *
 * skipWaiting() on install is the tempting one-liner, and it is wrong here. The
 * cached HTML shell references content-hashed /_next/static chunks; a worker
 * that swaps caches under a page that is already open leaves that page asking
 * for chunks the new caches no longer hold, which surfaces as a blank screen
 * mid-task. So a new worker waits, ServiceWorkerManager notices it and offers
 * "Update", and only then do we skipWaiting() and reload — a single, visible,
 * user-chosen cut-over. clients.claim() in activate covers the first install,
 * where there is no old page to break.
 *
 * A stale worker that never upgrades is the bug on the other side, so the
 * client also calls registration.update() whenever the app regains focus.
 */
self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (type === "CLEAR_CACHES") {
    // Sent on sign-out. Cache Storage holds real financial and school data;
    // logging out has to take it with it.
    event.waitUntil(Promise.all(OWNED_CACHES.map((n) => caches.delete(n))));
  }
});

// --- fetch -------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Writes are never intercepted, queued, or replayed. An offline POST/PATCH/
  // DELETE fails at the network layer and the app says so — a queue that
  // reported "saved" for something the server has not seen would be a lie, and
  // this app's writes (career events, checklist completions) are ordered
  // against server state that cannot be reconstructed on the device. This also
  // covers the /share POST from the OS share sheet, which passes straight
  // through.
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isBypassed(url.pathname)) return;

  if (req.mode === "navigate") {
    event.respondWith(handleNavigate(req));
  } else if (isApi(url.pathname)) {
    event.respondWith(handleApi(req, url));
  } else if (isAsset(url.pathname)) {
    event.respondWith(handleAsset(req));
  }
  // Anything else — notably the router's RSC payload fetches — is left alone.
  // Letting those fail offline is deliberate: the client router then falls back
  // to a full navigation, which this worker *can* answer from the shell cache.
});

/**
 * Navigations: network first, cached shell second, /offline last.
 *
 * Never cache-first. The proxy redirects an unauthenticated page request to
 * /login, and serving a cached app shell over that would show a signed-out user
 * a page they can no longer load data for. Navigation requests carry redirect
 * mode "manual", so that redirect arrives as an opaqueredirect (status 0) which
 * is passed straight back for the browser to follow, and is not cacheable.
 *
 * The cached document is only the app shell: every page in this app is a client
 * component that reads its data from /api via SWR, so the HTML holds no user
 * data and cannot itself be stale in a way that misleads.
 */
async function handleNavigate(req) {
  const key = new URL(req.url).pathname;
  try {
    const res = await fetch(req);
    if (res.type === "basic" && res.status === 200) {
      const copy = res.clone();
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(key, copy);
    }
    return res;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (
      (await cache.match(key)) ||
      (await cache.match(OFFLINE_URL)) ||
      new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
    );
  }
}

/**
 * Static assets: cache first.
 *
 * Safe because every URL here is content-hashed or an icon route — the URL
 * changes when the bytes do, so a hit can never be the wrong version.
 */
async function handleAsset(req) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") await cache.put(req, res.clone());
  return res;
}

/**
 * API GETs: network first, and a cache hit is only ever returned *labelled*.
 */
async function handleApi(req, url) {
  const key = url.pathname + url.search;
  const cache = await caches.open(API_CACHE);

  try {
    const res = await fetch(req);

    // Signed out: the cached copy belongs to a session that no longer exists.
    if (res.status === 401) {
      await cache.delete(key);
      return res;
    }

    if (res.ok && isCacheableApi(url.pathname)) {
      const body = await res.clone().text();
      await cache.put(
        key,
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json", "x-sw-cached-at": new Date().toISOString() },
        })
      );
    }
    return res;
  } catch {
    if (isLivePriceRoute(url.pathname)) {
      return offlineError("Offline — live prices are unavailable, so holdings can't be valued.");
    }
    const hit = await cache.match(key);
    if (!hit) return offlineError("Offline — no saved copy of this data.");
    return staleResponse(hit, url.pathname);
  }
}

/** A visible failure, never an empty success. 503 makes the app's fetch throw. */
function offlineError(message) {
  return new Response(JSON.stringify({ error: message, offline: { stale: false, cachedAt: null } }), {
    status: 503,
    headers: { "Content-Type": "application/json", "x-sw-offline": "1" },
  });
}

/**
 * Re-serve a cached API body with the offline envelope attached, and with any
 * live-priced field blanked out. The envelope is part of the JSON body rather
 * than a header on purpose: a header is easy for a caller to forget, whereas
 * `data.offline` travels through SWR into the component that renders the
 * numbers.
 */
async function staleResponse(hit, pathname) {
  const cachedAt = hit.headers.get("x-sw-cached-at");
  let parsed;
  try {
    parsed = JSON.parse(await hit.text());
  } catch {
    return offlineError("Offline — the saved copy of this data is unreadable.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return offlineError("Offline — the saved copy of this data is unreadable.");
  }

  const redacted = [];
  for (const field of LIVE_PRICE_FIELDS[pathname] || []) {
    if (field in parsed) {
      parsed[field] = null;
      redacted.push(field);
    }
  }

  parsed.offline = { stale: true, cachedAt, redacted };
  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { "Content-Type": "application/json", "x-sw-offline": "1" },
  });
}
