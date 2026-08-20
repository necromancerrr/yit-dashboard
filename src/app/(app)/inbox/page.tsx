"use client";

import useSWR from "swr";
import Link from "next/link";
import { Inbox as InboxIcon, Check, X, RefreshCw } from "lucide-react";
import { useState } from "react";
import { fetcher, apiPatch, apiPost } from "@/lib/fetcher";
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

interface IntegrationRow {
  provider: string;
  configured: boolean;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
}

export default function InboxPage() {
  const { data, isLoading, mutate } = useSWR<{ items: InboxRow[] }>("/api/inbox", fetcher);
  const { data: integrations, mutate: mutateIntegrations } =
    useSWR<{ items: IntegrationRow[] }>("/api/integrations", fetcher);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const items = data?.items ?? [];
  const gmail = integrations?.items.find((i) => i.provider === "gmail");

  async function sync() {
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await apiPost<{ ingested: number; applied: number; proposed: number; ignored: number }>(
        "/api/ingest/sync",
        {}
      );
      setSyncNote(
        res.ingested === 0
          ? "No new mail."
          : `${res.ingested} new · ${res.applied} applied · ${res.proposed} to review · ${res.ignored} ignored`
      );
      mutate();
      mutateIntegrations();
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function resolve(item: InboxRow, state: "confirmed" | "dismissed") {
    await apiPatch(`/api/inbox/${item.id}`, { state });
    mutate();
  }

  return (
    <div>
      <PageHeader
        title="Inbox"
        subtitle="Things the system noticed"
        action={
          gmail?.configured ? (
            <button className="btn btn-ghost" onClick={sync} disabled={syncing}>
              <RefreshCw size={15} /> {syncing ? "Syncing…" : "Sync mail"}
            </button>
          ) : undefined
        }
      />

      {/* Only shown once a mailbox is actually connected. An unconfigured
          integration is a normal state, not a warning to nag about. */}
      {syncNote && (
        <p className="text-xs mb-3" style={{ color: "var(--ink-muted)" }}>
          {syncNote}
        </p>
      )}
      {gmail?.last_error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "var(--critical)" }}>
          Last mail sync failed: {gmail.last_error}
        </div>
      )}

      {isLoading ? (
        <div className="card p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={InboxIcon}
            title="Nothing needs your attention"
            sub="Mail, deadlines, and applications that stop moving show up here on their own."
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
                  {/* Confirm only appears when there is something to accept:
                      a status change, or an email-backed application to create. */}
                  {item.proposed_status && (
                    <button
                      onClick={() => resolve(item, "confirmed")}
                      className="icon-btn"
                      aria-label={`Confirm: ${item.title}`}
                      title={
                        item.application_id
                          ? `Set status to ${item.proposed_status}`
                          : "Create application"
                      }
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
