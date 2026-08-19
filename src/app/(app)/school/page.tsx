"use client";

import { useState } from "react";
import useSWR from "swr";
import { GraduationCap, Plus, Trash2 } from "lucide-react";
import { fetcher, apiPost, apiPatch, apiDelete } from "@/lib/fetcher";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import type { SchoolTask } from "@/lib/types";

const STATUSES = ["Pending", "In Progress", "Done"] as const;

const STATUS_COLOR: Record<string, string> = {
  Pending: "var(--ink-muted)",
  "In Progress": "var(--warning)",
  Done: "var(--good)",
};

function fmt(iso: string | null) {
  if (!iso) return "No due date";
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isOverdue(iso: string | null, status: string) {
  if (!iso || status === "Done") return false;
  return iso < new Date().toISOString().slice(0, 10);
}

export default function SchoolPage() {
  const { data, isLoading, mutate } = useSWR<{ items: SchoolTask[] }>("/api/school", fetcher);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ course: "", title: "", due_date: "", notes: "" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/school", {
        course: form.course,
        title: form.title,
        due_date: form.due_date || null,
        notes: form.notes || null,
      });
      setOpen(false);
      setForm({ course: "", title: "", due_date: "", notes: "" });
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: number, status: string) {
    await apiPatch(`/api/school/${id}`, { status });
    mutate();
  }

  async function handleDelete(id: number) {
    await apiDelete(`/api/school/${id}`);
    mutate();
  }

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="School"
        subtitle="Assignments and deadlines across your courses"
        action={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={15} /> Add task
          </button>
        }
      />

      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
            Loading…
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={GraduationCap} title="Nothing on the docket" sub="Add an assignment or exam to track it here." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {items.map((task) => {
              const overdue = isOverdue(task.due_date, task.status);
              return (
                <li key={task.id} className="flex items-center justify-between gap-3 px-4 py-3 group">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: "color-mix(in srgb, var(--cat-school) 16%, transparent)" }}
                    >
                      <GraduationCap size={15} color="var(--cat-school)" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      <p className="text-xs flex items-center gap-1.5" style={{ color: overdue ? "var(--critical)" : "var(--ink-muted)" }}>
                        {task.course} · {fmt(task.due_date)} {overdue ? "· overdue" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={task.status}
                      onChange={(e) => updateStatus(task.id, e.target.value)}
                      className="badge cursor-pointer"
                      style={{ color: STATUS_COLOR[task.status] }}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s} style={{ color: "#000" }}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleDelete(task.id)}
                      className="icon-btn opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add a task">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="label">Course</label>
            <input
              className="input"
              placeholder="CSE 442"
              value={form.course}
              onChange={(e) => setForm({ ...form, course: e.target.value })}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Title</label>
            <input
              className="input"
              placeholder="Problem Set 4"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Due date (optional)</label>
            <input
              type="date"
              className="input"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
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
          <button type="submit" disabled={saving || !form.course || !form.title} className="btn btn-primary mt-1 disabled:opacity-50">
            {saving ? "Saving…" : "Save task"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
