"use client";

import Link from "next/link";
import useSWR from "swr";
import { Sparkles } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { Digest } from "@/lib/autonomy/digest-types";

/**
 * "Handled 12 things since Friday."
 *
 * One line on Today, pointing at the Inbox. Not a badge, not a modal, not a
 * dismissible banner: the entire point of autonomy is to stop demanding
 * attention, and a notification that has to be cleared is a queue wearing a
 * different hat.
 *
 * It stays until the run is acknowledged, which is one tap for the whole batch
 * and is never required. Trust only grows through that tap — an auto-applied
 * row nobody looked at is not evidence of anything, so a system being ignored
 * becomes *less* autonomous over time rather than more.
 */
export function DigestLine() {
  const { data } = useSWR<Digest>("/api/digest", fetcher, { revalidateOnFocus: false });
  const count = data?.unreviewed ?? 0;
  if (count === 0) return null;

  return (
    <Link
      href="/inbox"
      className="card p-3 mb-4 flex items-center gap-2.5 hover:opacity-90 transition-opacity"
    >
      <Sparkles size={14} style={{ color: "var(--accent)" }} className="shrink-0" />
      <p className="text-xs flex-1" style={{ color: "var(--ink-secondary)" }}>
        Handled {count} thing{count === 1 ? "" : "s"} for you.{" "}
        <span style={{ color: "var(--accent)" }}>See what</span>
      </p>
    </Link>
  );
}
