/**
 * The app's half of the offline contract with `public/sw.js`.
 *
 * Two things live here:
 *
 * 1. The **offline envelope** — the `offline` key the service worker adds to
 *    any cached API body it hands back. Reading it is how a component knows the
 *    numbers on screen are a saved copy rather than live, and when they were
 *    saved. `public/sw.js` cannot import this file (it is not bundled), so the
 *    shape is duplicated there and pinned by `tests/offline.test.ts`.
 *
 * 2. A tiny **connectivity store**. Next 16 ships `useOffline` from
 *    `next/offline`, but it returns `false` unless `experimental.useOffline` is
 *    set, and that flag does more than expose a hook: it makes failed
 *    navigations *hang pending a retry* instead of failing. With a service
 *    worker installed that is the wrong trade — a failed router fetch is what
 *    triggers the full navigation the worker can actually answer from its shell
 *    cache, so a hanging navigation would replace a working offline page with a
 *    spinner. Hence a local store, using the repo's `useSyncExternalStore`
 *    pattern (see `useWebAuthnSupport.ts`) for a browser-only value.
 *
 * The store is fed from both directions the Next docs call out: the browser's
 * online/offline events, and an actual failed fetch — `navigator.onLine` stays
 * `true` on a wifi network with no upstream, so the request that just failed is
 * the more truthful signal.
 */

/** Key the service worker writes its marker under, inside the JSON body. */
export const OFFLINE_ENVELOPE_KEY = "offline";

/** Path of the precached fallback document. Mirrors OFFLINE_URL in sw.js. */
export const OFFLINE_URL = "/offline";

export interface OfflineEnvelope {
  /** True when this body came out of the service worker's cache. */
  stale: boolean;
  /** ISO timestamp of when the copy was saved, or null if unknown. */
  cachedAt: string | null;
  /** Fields blanked out because they are only meaningful at a live price. */
  redacted?: string[];
}

/** Reads the envelope off an API response body, or null if it is a live one. */
export function readOfflineEnvelope(data: unknown): OfflineEnvelope | null {
  if (typeof data !== "object" || data === null) return null;
  const raw = (data as Record<string, unknown>)[OFFLINE_ENVELOPE_KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const env = raw as Record<string, unknown>;
  if (env.stale !== true) return null;
  return {
    stale: true,
    cachedAt: typeof env.cachedAt === "string" ? env.cachedAt : null,
    redacted: Array.isArray(env.redacted) ? env.redacted.filter((f): f is string => typeof f === "string") : [],
  };
}

/** Whether a given field was blanked out by the worker for being price-derived. */
export function wasRedacted(data: unknown, field: string): boolean {
  return readOfflineEnvelope(data)?.redacted?.includes(field) ?? false;
}

/**
 * "when the data is from", in the fewest words that are still unambiguous.
 * Deliberately not "2 hours ago": for a portfolio or a deadline, a clock time
 * is easier to reason about than an elapsed duration.
 */
export function formatCachedAt(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "an earlier session";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "an earlier session";

  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) return time;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) return `yesterday ${time}`;

  return `${at.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

// --- connectivity store ------------------------------------------------------

export interface OfflineState {
  /** The browser says we're offline, or a request just failed at the network. */
  offline: boolean;
  /** When the most recently rendered cached response was saved. */
  cachedAt: string | null;
}

const ONLINE: OfflineState = { offline: false, cachedAt: null };

// Snapshots must be referentially stable between changes, or useSyncExternalStore
// re-renders forever. Every mutation replaces this object exactly once.
let state: OfflineState = ONLINE;
const listeners = new Set<() => void>();

function set(next: OfflineState) {
  if (next.offline === state.offline && next.cachedAt === state.cachedAt) return;
  state = next;
  for (const l of listeners) l();
}

export function subscribeOffline(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    }
  };
}

function handleOnline() {
  set(ONLINE);
}

function handleOffline() {
  set({ offline: true, cachedAt: state.cachedAt });
}

export function getOfflineSnapshot(): OfflineState {
  return state;
}

/** The server has no connectivity to report, and rendering "offline" there
 *  would flash a banner at every visitor on a perfectly good connection. */
export function getOfflineServerSnapshot(): OfflineState {
  return ONLINE;
}

/** Called by the fetcher for every API body it sees. */
export function noteResponse(data: unknown): void {
  const env = readOfflineEnvelope(data);
  if (env) set({ offline: true, cachedAt: env.cachedAt });
  else set(ONLINE); // a live response is proof we're connected
}

/** Called by the fetcher when a request rejects at the network layer. */
export function noteNetworkFailure(): void {
  set({ offline: true, cachedAt: state.cachedAt });
}

/** Test seam: reset module state between cases. */
export function __resetOfflineState(): void {
  state = ONLINE;
}
