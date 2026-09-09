"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { SetupStatus } from "@/lib/setup-status";

/**
 * One line on Today when the configuration is costing something.
 *
 * The Setup page can answer "is this configured?", but only if you think to
 * look — and the failures that matter (a database that will be wiped on the
 * next deploy, a day that rolls over at the wrong hour) are exactly the ones
 * you will not think to look for, because nothing appears broken.
 *
 * Deliberately narrow:
 * - only `warn` checks, never "an optional feature is off". A notice that
 *   nags about something you chose not to use gets dismissed forever, taking
 *   the real warnings with it.
 * - one line, not a panel. It points at Setup rather than explaining.
 * - dismissible, and the dismissal sticks per problem, not globally: it is
 *   keyed on which checks are failing, so a *new* problem speaks up again
 *   while the one you accepted stays quiet.
 */

const DISMISS_KEY = "dash_setup_notice_dismissed";

const listeners = new Set<() => void>();

function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISS_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeDismissed(value: string) {
  try {
    localStorage.setItem(DISMISS_KEY, value);
  } catch {
    /* private mode — the notice simply returns next load */
  }
  for (const notify of listeners) notify();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function SetupNotice() {
  const { data } = useSWR<SetupStatus>("/api/setup", fetcher, {
    // Configuration changes on deploy, not while you are reading. Polling it
    // would be noise.
    revalidateOnFocus: false,
  });
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => "");
  const [hidden, setHidden] = useState(false);

  const warnings = data?.checks.filter((c) => c.level === "warn") ?? [];
  if (warnings.length === 0 || hidden) return null;

  // The signature is the set of currently-failing checks. Fix one, or acquire
  // a new one, and the notice is no longer the thing you dismissed.
  const signature = warnings.map((w) => w.id).sort().join(",");
  if (dismissed === signature) return null;

  const first = warnings[0];

  return (
    <div
      className="card p-3 mb-4 flex items-start gap-2.5"
      style={{ borderColor: "color-mix(in srgb, var(--warning) 40%, var(--border))" }}
    >
      <AlertTriangle size={15} style={{ color: "var(--warning)" }} className="shrink-0 mt-0.5" />
      <p className="text-xs flex-1 leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
        {first.status}{" "}
        {warnings.length > 1 && (
          <span style={{ color: "var(--ink-muted)" }}>
            (+{warnings.length - 1} more){" "}
          </span>
        )}
        <Link href="/setup" className="underline" style={{ color: "var(--accent)" }}>
          Open Setup
        </Link>
      </p>
      <button
        onClick={() => {
          writeDismissed(signature);
          setHidden(true);
        }}
        className="icon-btn shrink-0"
        aria-label="Dismiss setup notice"
      >
        <X size={14} />
      </button>
    </div>
  );
}
