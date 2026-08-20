"use client";

import { use, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowLeft, Plus } from "lucide-react";
import { fetcher, apiPost, apiPatch } from "@/lib/fetcher";
import { PageHeader } from "@/components/PageHeader";
import { Modal } from "@/components/Modal";
import { parseISODate, todayISO } from "@/lib/date";
import { ALL_STATUSES, STATUS_COLOR } from "@/lib/career-status";
import type { Application, ApplicationEvent, ApplicationStatus } from "@/lib/types";

function fmt(iso: string | null) {
  if (!iso) return "—";
  return parseISODate(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Where a timeline entry came from, when it wasn't you. */
function sourceLabel(source: string): string | null {
  if (source === "manual") return null;
  if (source === "gmail") return "from email";
  if (source === "ai") return "inferred";
  return source;
}

export default function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, mutate } = useSWR<{
    item: Application;
    events: ApplicationEvent[];
  }>(`/api/applications/${id}`, fetcher);

  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [noteDate, setNoteDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const app = data?.item;
  const events = data?.events ?? [];

  async function changeStatus(status: string) {
    setError(null);
    try {
      await apiPatch(`/api/applications/${id}`, { status });
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change the status");
    }
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/applications/${id}/events`, {
        kind: "note",
        detail: note,
        occurred_on: noteDate,
      });
      setNote("");
      setNoteOpen(false);
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that note");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="card p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
        Loading…
      </div>
    );
  }

  if (!app) {
    return (
      <div className="card p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
        That application no longer exists.{" "}
        <Link href="/career" style={{ color: "var(--accent)" }}>
          Back to Career
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/career"
        className="inline-flex items-center gap-1.5 text-sm mb-4"
        style={{ color: "var(--ink-muted)" }}
      >
        <ArrowLeft size={14} /> Career
      </Link>

      <PageHeader
        title={app.company}
        subtitle={app.role ?? "No role recorded"}
        action={
          <button className="btn btn-ghost" onClick={() => setNoteOpen(true)}>
            <Plus size={15} /> Add note
          </button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 mb-5">
        <div className="card p-4">
          <p className="label mb-1.5">Status</p>
          <select
            value={app.status}
            onChange={(e) => changeStatus(e.target.value)}
            className="input"
            aria-label="Application status"
            style={{ color: STATUS_COLOR[app.status] }}
          >
            {ALL_STATUSES.map((s: ApplicationStatus) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="card p-4">
          <p className="label mb-1.5">Applied</p>
          <p className="text-sm">{fmt(app.applied_date)}</p>
        </div>
        <div className="card p-4">
          <p className="label mb-1.5">{app.next_action_label || "Next up"}</p>
          <p className="text-sm">{fmt(app.next_action_date)}</p>
        </div>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "var(--critical)" }}>
          {error}
        </div>
      )}

      {app.notes && (
        <div className="card p-4 mb-5">
          <p className="label mb-1.5">Notes</p>
          <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--ink-secondary)" }}>
            {app.notes}
          </p>
        </div>
      )}

      <div className="card p-4 sm:p-5">
        <h2 className="text-sm font-semibold mb-4">History</h2>
        {events.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            Nothing recorded yet.
          </p>
        ) : (
          <ol className="flex flex-col gap-0">
            {events.map((ev, i) => {
              const src = sourceLabel(ev.source);
              return (
                <li key={ev.id} className="flex gap-3">
                  {/* Rail: a dot per event, joined by a line except at the end. */}
                  <div className="flex flex-col items-center">
                    <span
                      className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                      style={{
                        background: ev.to_status
                          ? STATUS_COLOR[ev.to_status] ?? "var(--ink-muted)"
                          : "var(--ink-muted)",
                      }}
                    />
                    {i < events.length - 1 && (
                      <span className="w-px flex-1 my-1" style={{ background: "var(--border)" }} />
                    )}
                  </div>
                  <div className="pb-4 min-w-0">
                    <p className="text-sm">
                      {ev.kind === "status_change" && ev.to_status ? (
                        <>
                          {ev.from_status ? `${ev.from_status} → ` : ""}
                          <span style={{ color: STATUS_COLOR[ev.to_status] }}>{ev.to_status}</span>
                        </>
                      ) : (
                        ev.detail || ev.kind
                      )}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
                      {fmt(ev.occurred_on)}
                      {ev.kind === "status_change" && ev.detail ? ` · ${ev.detail}` : ""}
                      {src ? ` · ${src}` : ""}
                      {ev.confidence != null ? ` · ${Math.round(ev.confidence * 100)}% confident` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <Modal open={noteOpen} onClose={() => setNoteOpen(false)} title="Add a note">
        <form onSubmit={addNote} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="label">Date</label>
            <input
              type="date"
              className="input"
              value={noteDate}
              onChange={(e) => setNoteDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Note</label>
            <textarea
              className="input"
              rows={3}
              placeholder="Recruiter said they'd follow up next week…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={saving || !note.trim()}
            className="btn btn-primary mt-1 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add to history"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
