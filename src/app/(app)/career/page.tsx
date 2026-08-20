"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Briefcase, Plus, Trash2 } from "lucide-react";
import { fetcher, apiPost } from "@/lib/fetcher";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import { parseISODate, todayISO } from "@/lib/date";
import { ALL_STATUSES, STATUS_COLOR, isTerminal } from "@/lib/career-status";
import type { Application, ApplicationStatus } from "@/lib/types";


function fmt(iso: string | null) {
  if (!iso) return null;
  return parseISODate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const emptyForm = {
  company: "",
  role: "",
  status: "Applied" as ApplicationStatus,
  applied_date: todayISO(),
  next_action_date: "",
  next_action_label: "",
  notes: "",
};

export default function CareerPage() {
  const { data, isLoading, mutate } = useSWR<{ items: Application[] }>("/api/applications", fetcher);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const allItems = useMemo(() => data?.items ?? [], [data]);
  const { visibleItems: items, requestDelete } = useUndoableDelete(allItems, {
    deleteUrl: (item) => `/api/applications/${item.id}`,
    label: (item) => item.company,
    onCommitted: () => mutate(),
  });

  const { active, closed } = useMemo(() => {
    return {
      active: items.filter((a) => !isTerminal(a.status)),
      closed: items.filter((a) => isTerminal(a.status)),
    };
  }, [items]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/applications", {
        company: form.company,
        role: form.role || null,
        status: form.status,
        applied_date: form.applied_date || null,
        next_action_date: form.next_action_date || null,
        next_action_label: form.next_action_label || null,
        notes: form.notes || null,
      });
      setOpen(false);
      setForm(emptyForm);
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function renderRow(app: Application) {
    const next = fmt(app.next_action_date);
    return (
      <li key={app.id} className="flex items-center justify-between gap-3 px-4 py-3 group">
        <Link href={`/career/${app.id}`} className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--cat-interviews) 16%, transparent)" }}
          >
            <Briefcase size={15} color="var(--cat-interviews)" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {app.company}
              {app.role ? <span style={{ color: "var(--ink-muted)" }}> · {app.role}</span> : null}
            </p>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              {next
                ? `${app.next_action_label || "Next"} · ${next}`
                : app.applied_date
                  ? `Applied ${fmt(app.applied_date)}`
                  : "No dates yet"}
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <span className="badge" style={{ color: STATUS_COLOR[app.status] }}>
            {app.status}
          </span>
          <button
            onClick={() => requestDelete(app)}
            className="icon-btn opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
            aria-label={`Delete ${app.company}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </li>
    );
  }

  return (
    <div>
      <PageHeader
        title="Career"
        subtitle="Every application, from applied through offer"
        action={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={15} /> Add application
          </button>
        }
      />

      {isLoading ? (
        <div className="card p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Briefcase}
            title="No applications yet"
            sub="Add a company you've applied to and track it through each stage."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="card">
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {active.map(renderRow)}
            </ul>
          </div>

          {closed.length > 0 && (
            <div>
              <h2 className="label mb-2">Closed</h2>
              <div className="card" style={{ opacity: 0.7 }}>
                <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {closed.map(renderRow)}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add an application">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="label">Company</label>
            <input
              className="input"
              placeholder="e.g. Goldman Sachs"
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Role (optional)</label>
            <input
              className="input"
              placeholder="Software Engineering Intern"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="label">Status</label>
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as ApplicationStatus })}
              >
                {ALL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="label">Applied on</label>
              <input
                type="date"
                className="input"
                value={form.applied_date}
                onChange={(e) => setForm({ ...form, applied_date: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="label">Next date (optional)</label>
              <input
                type="date"
                className="input"
                value={form.next_action_date}
                onChange={(e) => setForm({ ...form, next_action_date: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="label">What is it?</label>
              <input
                className="input"
                placeholder="OA due"
                value={form.next_action_label}
                onChange={(e) => setForm({ ...form, next_action_label: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Notes (optional)</label>
            <textarea
              className="input"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          {error && (
            <p className="text-sm" style={{ color: "var(--critical)" }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={saving || !form.company}
            className="btn btn-primary mt-1 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save application"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
