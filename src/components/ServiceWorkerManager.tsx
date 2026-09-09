"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpCircle } from "lucide-react";

/**
 * Registers `public/sw.js` and owns the update handshake.
 *
 * Registration is a side effect on mount, which is what `useEffect` is for. The
 * one rule to respect is the React Compiler's: no `setState` in the effect
 * body. Every `setState` below happens later, inside an async continuation or
 * an event listener, so the effect itself is pure setup/teardown.
 *
 * Why a prompt instead of `skipWaiting()` on install: the cached HTML shell
 * points at content-hashed `/_next/static` chunks. A worker that activates
 * under a page that is already open swaps the caches beneath it, and the next
 * lazy chunk that page asks for is gone — a blank screen in the middle of
 * whatever you were doing. So the new worker waits, this component offers the
 * update, and the cut-over happens once, deliberately, with a reload. The
 * failure mode on the other side — a worker that waits forever because the PWA
 * is never fully closed — is covered by re-checking on every focus.
 */
export function ServiceWorkerManager() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    // Dev builds serve unhashed, constantly-changing assets through Turbopack;
    // caching those cache-first would hand you yesterday's chunks. Test the
    // worker with `npm run build && npm start`.
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | undefined;
    let cancelled = false;

    // `updateViaCache: "none"` keeps the browser's HTTP cache out of the
    // update check, so a new worker is never hidden behind a cached sw.js.
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (cancelled) return;
        registration = reg;

        const offer = () => {
          // `waiting` is only set once a *previous* worker is in control — a
          // first install activates straight away and needs no prompt.
          if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        };

        offer();
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed") offer();
          });
        });
      })
      .catch(() => {
        // A failed registration must never break the app: without a worker it
        // simply behaves the way it did before, online-only.
      });

    // A phone PWA can stay "open" for weeks, so the periodic update check the
    // browser does on navigation may never happen. Re-check whenever the app
    // comes back to the foreground.
    const recheck = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };
    document.addEventListener("visibilitychange", recheck);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    // Reload once the new worker takes control, so the page and the caches it
    // reads from change together rather than a moment apart.
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    waiting.postMessage({ type: "SKIP_WAITING" });
    setWaiting(null);
  }, [waiting]);

  if (!waiting) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 md:bottom-6 right-4 z-50 card-raised flex items-center gap-3 pl-4 pr-2 py-2 shadow-2xl"
    >
      <ArrowUpCircle size={14} color="var(--accent)" aria-hidden />
      <span className="text-sm">A new version is ready</span>
      <button onClick={applyUpdate} className="btn btn-ghost py-1 px-2 text-xs shrink-0">
        Reload
      </button>
    </div>
  );
}
