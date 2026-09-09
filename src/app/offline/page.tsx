"use client";

import { WifiOff, RotateCw } from "lucide-react";
import { Logo } from "@/components/Logo";
import { getBrandName } from "@/lib/identity";

/**
 * The last resort: shown when the app is opened with no connection and the
 * service worker has no cached shell for the page that was asked for.
 *
 * It sits outside the `(app)` route group on purpose — no nav, no SWR, no data.
 * Rendering it must never depend on anything the network could withhold, since
 * the whole reason it is on screen is that the network withheld everything.
 *
 * `/offline` is also a public path in `src/proxy.ts`, so the worker can
 * precache it during install and so opening the app offline while signed out
 * lands here rather than on a login page that cannot load.
 */
export default function OfflinePage() {
  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ background: "var(--page)" }}
    >
      <div className="flex items-center gap-2.5 mb-8">
        <Logo size="sm" />
        <span className="font-semibold text-sm">{getBrandName()}</span>
      </div>

      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
        style={{ background: "var(--surface-raised)" }}
      >
        <WifiOff size={20} color="var(--warning)" />
      </div>

      <h1 className="text-lg font-semibold tracking-tight">You&apos;re offline</h1>
      <p className="text-sm mt-2 max-w-xs" style={{ color: "var(--ink-muted)" }}>
        This screen hasn&apos;t been opened on this device yet, so there&apos;s nothing saved to show. Pages
        you&apos;ve already visited still open — and anything you change while offline won&apos;t be saved
        until you reconnect.
      </p>

      <button onClick={() => window.location.reload()} className="btn btn-primary mt-6 flex items-center gap-2">
        <RotateCw size={14} />
        Try again
      </button>
    </main>
  );
}
