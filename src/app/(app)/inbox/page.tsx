"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  Briefcase,
  Check,
  ChevronDown,
  Inbox as InboxIcon,
  Pencil,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";
import { fetcher, apiPatch, apiPost } from "@/lib/fetcher";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ALL_STATUSES, STATUS_COLOR } from "@/lib/career-status";
import type { ApplicationStatus, InboxItem } from "@/lib/types";

interface InboxRow extends InboxItem {
  application_company: string | null;
  application_role: string | null;
}

interface IntegrationRow {
  provider: string;
  configured: boolean;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
}

type QueueFilter = "all" | "create" | "update" | "alert";

interface EditDraft {
  company: string;
  role: string;
  status: ApplicationStatus;
  nextActionDate: string;
}

function category(item: InboxRow): Exclude<QueueFilter, "all"> {
  if (!item.proposed_status) return "alert";
  return item.application_id ? "update" : "create";
}

function companyFor(item: InboxRow): string {
  return item.application_company ?? item.proposed_company ?? "Employer unknown";
}

function roleFor(item: InboxRow): string | null {
  return item.application_role ?? item.proposed_role ?? null;
}

function employerNeedsCorrection(item: InboxRow): boolean {
  if (item.application_id) return false;
  const company = item.proposed_company?.trim();
  return !company || /^an? employer$/i.test(company);
}

export default function InboxPage() {
  const { data, isLoading, mutate } = useSWR<{ items: InboxRow[] }>("/api/inbox", fetcher);
  const { data: integrations, mutate: mutateIntegrations } =
    useSWR<{ items: IntegrationRow[] }>("/api/integrations", fetcher);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const items = useMemo(() => data?.items ?? [], [data]);
  const gmail = integrations?.items.find((item) => item.provider === "gmail");

  const counts = useMemo(() => {
    const result = { all: items.length, create: 0, update: 0, alert: 0 };
    for (const item of items) result[category(item)] += 1;
    return result;
  }, [items]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== "all" && category(item) !== filter) return false;
      if (!needle) return true;
      return [
        companyFor(item),
        roleFor(item),
        item.proposed_status,
        item.title,
        item.detail,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [filter, items, query]);

  async function sync() {
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await apiPost<{
        ingested: number;
        applied: number;
        proposed: number;
        ignored: number;
      }>("/api/ingest/sync", {});
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
    setSavingId(item.id);
    setActionError(null);
    try {
      await apiPatch(`/api/inbox/${item.id}`, { state });
      if (expandedId === item.id) setExpandedId(null);
      mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update this item");
    } finally {
      setSavingId(null);
    }
  }

  function beginEdit(item: InboxRow) {
    setExpandedId(item.id);
    setEditingId(item.id);
    setActionError(null);
    setDraft({
      company: item.proposed_company ?? item.application_company ?? "",
      role: item.proposed_role ?? item.application_role ?? "",
      status: (item.proposed_status as ApplicationStatus | null) ?? "Applied",
      nextActionDate: item.proposed_next_action_date ?? "",
    });
  }

  async function saveEdit(item: InboxRow) {
    if (!draft) return;
    setSavingId(item.id);
    setActionError(null);
    try {
      await apiPatch(`/api/inbox/${item.id}`, {
        proposed_company: item.application_id ? undefined : draft.company.trim() || null,
        proposed_role: draft.role.trim() || null,
        proposed_status: draft.status,
        proposed_next_action_date: draft.nextActionDate || null,
      });
      setEditingId(null);
      setDraft(null);
      await mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not save corrections");
    } finally {
      setSavingId(null);
    }
  }

  const filters: { key: QueueFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "create", label: "New applications" },
    { key: "update", label: "Updates" },
    { key: "alert", label: "Alerts" },
  ];

  return (
    <div>
      <PageHeader
        title="Inbox"
        subtitle="Review what the system noticed"
        action={
          gmail?.configured ? (
            <button className="btn btn-ghost" onClick={sync} disabled={syncing}>
              <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing…" : "Sync mail"}
            </button>
          ) : undefined
        }
      />

      {(syncNote || gmail?.last_error || actionError) && (
        <div className="mb-3 flex flex-col gap-1 text-xs" style={{ color: "var(--ink-muted)" }}>
          {syncNote && <p>{syncNote}</p>}
          {gmail?.last_error && (
            <p style={{ color: "var(--critical)" }}>Last mail sync failed: {gmail.last_error}</p>
          )}
          {actionError && <p style={{ color: "var(--critical)" }}>{actionError}</p>}
        </div>
      )}

      {!isLoading && items.length > 0 && (
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div
            className="flex items-center gap-1 overflow-x-auto rounded-lg p-1"
            style={{ background: "var(--surface)" }}
            role="tablist"
            aria-label="Inbox filters"
          >
            {filters.map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={filter === option.key}
                onClick={() => setFilter(option.key)}
                className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs transition-colors"
                style={{
                  background: filter === option.key ? "var(--surface-raised)" : "transparent",
                  color: filter === option.key ? "var(--ink-primary)" : "var(--ink-muted)",
                }}
              >
                {option.label} <span className="tabular-nums">{counts[option.key]}</span>
              </button>
            ))}
          </div>
          <label className="relative block w-full sm:w-64">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2"
              color="var(--ink-muted)"
            />
            <input
              className="input pl-8"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search company or role"
              aria-label="Search inbox"
            />
          </label>
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
      ) : visibleItems.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm">No items match this view.</p>
          <button
            type="button"
            className="mt-2 text-xs"
            style={{ color: "var(--accent)" }}
            onClick={() => {
              setFilter("all");
              setQuery("");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {visibleItems.map((item) => {
              const itemCategory = category(item);
              const company = companyFor(item);
              const role = roleFor(item);
              const expanded = expandedId === item.id;
              const editing = editingId === item.id;
              const needsCorrection = employerNeedsCorrection(item);
              const canConfirm = Boolean(item.proposed_status) && !needsCorrection;
              const ItemIcon = itemCategory === "alert" ? Bell : Briefcase;

              return (
                <li key={item.id}>
                  <div className="flex flex-wrap items-start gap-3 px-4 py-3">
                    <span
                      className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background: "color-mix(in srgb, var(--cat-interviews) 13%, transparent)",
                      }}
                    >
                      <ItemIcon size={14} color="var(--cat-interviews)" />
                    </span>

                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                      aria-expanded={expanded}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{company}</span>
                        {role && (
                          <span className="text-sm" style={{ color: "var(--ink-muted)" }}>
                            · {role}
                          </span>
                        )}
                        {needsCorrection && (
                          <span className="badge" style={{ color: "var(--warning)" }}>
                            <AlertTriangle size={11} /> Check employer
                          </span>
                        )}
                      </span>
                      <span
                        className="mt-0.5 block truncate text-xs"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        {item.detail ?? item.title}
                      </span>
                    </button>

                    <div className="ml-11 flex w-full shrink-0 items-center justify-end gap-1 sm:ml-0 sm:w-auto sm:gap-2">
                      <span className="hidden text-xs sm:inline" style={{ color: "var(--ink-muted)" }}>
                        {itemCategory === "create"
                          ? "New"
                          : itemCategory === "update"
                            ? "Update"
                            : item.severity}
                      </span>
                      {item.proposed_status && (
                        <span
                          className="badge"
                          style={{ color: STATUS_COLOR[item.proposed_status] ?? "var(--ink-secondary)" }}
                        >
                          {item.proposed_status}
                        </span>
                      )}
                      {item.confidence !== null && (
                        <span className="hidden text-xs md:inline" style={{ color: "var(--ink-muted)" }}>
                          {Math.round(item.confidence * 100)}%
                        </span>
                      )}
                      {item.proposed_status && (
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => beginEdit(item)}
                          aria-label={`Edit ${company} proposal`}
                          title="Correct proposal"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {item.proposed_status && (
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => resolve(item, "confirmed")}
                          disabled={!canConfirm || savingId === item.id}
                          aria-label={`Confirm ${company} proposal`}
                          title={needsCorrection ? "Correct the employer first" : "Confirm proposal"}
                          style={{ opacity: canConfirm ? 1 : 0.35 }}
                        >
                          <Check size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => resolve(item, "dismissed")}
                        disabled={savingId === item.id}
                        aria-label={`Dismiss ${company} item`}
                        title="Dismiss"
                      >
                        <X size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setExpandedId(expanded ? null : item.id)}
                        aria-label={expanded ? "Collapse details" : "Expand details"}
                        title={expanded ? "Collapse" : "Show details"}
                      >
                        <ChevronDown
                          size={14}
                          className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                        />
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div
                      className="border-t px-4 py-3 sm:pl-[3.75rem]"
                      style={{ borderColor: "var(--border)", background: "var(--surface-raised)" }}
                    >
                      {editing && draft ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="flex flex-col gap-1.5">
                            <span className="label">Company</span>
                            <input
                              className="input"
                              value={draft.company}
                              disabled={Boolean(item.application_id)}
                              onChange={(event) => setDraft({ ...draft, company: event.target.value })}
                              autoFocus={!item.application_id}
                            />
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="label">Role</span>
                            <input
                              className="input"
                              value={draft.role}
                              placeholder="Optional"
                              onChange={(event) => setDraft({ ...draft, role: event.target.value })}
                            />
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="label">Status</span>
                            <select
                              className="input"
                              value={draft.status}
                              onChange={(event) =>
                                setDraft({ ...draft, status: event.target.value as ApplicationStatus })
                              }
                            >
                              {ALL_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="label">Next action date</span>
                            <input
                              type="date"
                              className="input"
                              value={draft.nextActionDate}
                              onChange={(event) =>
                                setDraft({ ...draft, nextActionDate: event.target.value })
                              }
                            />
                          </label>
                          <div className="flex items-center gap-2 md:col-span-2">
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => saveEdit(item)}
                              disabled={savingId === item.id}
                            >
                              <Save size={14} /> {savingId === item.id ? "Saving…" : "Save changes"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => {
                                setEditingId(null);
                                setDraft(null);
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>
                          <p>{item.detail ?? "No additional detail."}</p>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                            <span>Detected as {item.kind.replaceAll("_", " ")}</span>
                            {item.confidence !== null && (
                              <span>Confidence {Math.round(item.confidence * 100)}%</span>
                            )}
                            {item.proposed_next_action_date && (
                              <span>Next action {item.proposed_next_action_date}</span>
                            )}
                            {item.application_id && (
                              <Link href={`/career/${item.application_id}`} style={{ color: "var(--accent)" }}>
                                Open application
                              </Link>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
