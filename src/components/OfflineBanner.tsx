"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";
import {
  formatCachedAt,
  getOfflineServerSnapshot,
  getOfflineSnapshot,
  subscribeOffline,
} from "@/lib/offline";

/**
 * The label that makes cached data safe to show.
 *
 * The service worker will serve a saved copy of a read when the network is
 * gone, but only on the condition that the app says so — so this banner is not
 * decoration, it is the other half of that bargain. It names both facts that
 * matter: that you are offline, and when the numbers on screen were last true.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`, matching
 * `useWebAuthnSupport`: connectivity lives outside React and does not exist
 * during server rendering, and the store's separate server snapshot keeps
 * hydration quiet.
 */
export function OfflineBanner() {
  const { offline, cachedAt } = useSyncExternalStore(
    subscribeOffline,
    getOfflineSnapshot,
    getOfflineServerSnapshot
  );

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 -mx-4 md:-mx-8 -mt-6 md:-mt-8 mb-5 px-4 md:px-8 py-2 flex items-center gap-2 text-xs border-b"
      style={{
        background: "var(--surface-raised)",
        borderColor: "var(--border-strong)",
        color: "var(--ink-secondary)",
      }}
    >
      <WifiOff size={13} color="var(--warning)" aria-hidden />
      <span>
        Offline — showing data saved{" "}
        <span style={{ color: "var(--ink-primary)" }}>{formatCachedAt(cachedAt)}</span>. Live prices are
        hidden, and changes won&apos;t save until you reconnect.
      </span>
    </div>
  );
}
