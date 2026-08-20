"use client";

import useSWR from "swr";
import Link from "next/link";
import { Inbox as InboxIcon, Check, X } from "lucide-react";
import { fetcher, apiPatch } from "@/lib/fetcher";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import type { InboxItem } from "@/lib/types";

interface InboxRow extends InboxItem {
  application_company: string | null;
  application_role: string | null;
}

const SEVERITY_COLOR: Record<string, string> = {
  urgent: "var(--critical)",
  attention: "var(--warning)",
  info: "var(--ink-muted)",
};

export default function InboxPage() {
  const { data, isLoading, mutate } = useSWR<{ items: InboxRow[] }>("/api/inbox", fetcher);
  const items = data?.items ?? [];

  async function resolve(item: InboxRow, state: "confirmed" | "dismissed") {
    await apiPatch(`/api/inbox/${item.id}`, { state });
    mutate();
  }

  return (
    <div>
      <PageHeader title="Inbox" subtitle="Things the system noticed" />

      {isLoading ? (
        <div className="card p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={InboxIcon}
            title="Nothing needs your attention"
            sub="Deadlines and applications that stop moving show up here on their own."
          />
        </div>
      ) : (
        <div className="card">
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="flex gap-3 min-w-0">
                  <span
                    className="dot mt-1.5 shrink-0"
                    style={{ background: SEVERITY_COLOR[item.severity] }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.title}</p>
                    {item.detail && (
                      <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
                        {item.detail}
                      </p>
                    )}
                    {item.application_id && (
                      <Link
                        href={`/career/${item.application_id}`}
                        className="text-xs mt-1 inline-block"
                        style={{ color: "var(--accent)" }}
                      >
                        Open application
                      </Link>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Confirm only appears when there is something to accept —
                      a proposed status change. Derived nudges are dismissed. */}
                  {item.proposed_status && (
                    <button
                      onClick={() => resolve(item, "confirmed")}
                      className="icon-btn"
                      aria-label={`Confirm: ${item.title}`}
                      title={`Set status to ${item.proposed_status}`}
                    >
                      <Check size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => resolve(item, "dismissed")}
                    className="icon-btn"
                    aria-label={`Dismiss: ${item.title}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
