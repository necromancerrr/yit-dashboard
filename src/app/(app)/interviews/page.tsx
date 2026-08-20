"use client";

import { useState } from "react";
import useSWR from "swr";
import { Briefcase, Plus, Trash2, Pencil } from "lucide-react";
import { fetcher, apiPost, apiPatch } from "@/lib/fetcher";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import { parseISODate } from "@/lib/date";
import type { Interview, InterviewStage } from "@/lib/types";

const STAGES: InterviewStage[] = ["Applied", "OA", "Phone Screen", "Technical", "Onsite", "Offer", "Rejected"];

const STAGE_COLOR: Record<string, string> = {
  Applied: "var(--ink-muted)",
  OA: "var(--cat-school)",
  "Phone Screen": "var(--cat-leetcode)",
  Technical: "var(--cat-leetcode)",
  Onsite: "var(--warning)",
  Offer: "var(--good)",
  Rejected: "var(--critical)",
};

function fmt(iso: string | null) {
  if (!iso) return "No date set";
  return parseISODate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const emptyForm = { company: "", role: "", stage: "Applied" as InterviewStage, date: "", notes: "" };

export default function InterviewsPage() {
  const { data, isLoading, mutate } = useSWR<{ items: Interview[] }>("/api/interviews", fetcher);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Interview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const allItems = data?.items ?? [];
  const { visibleItems: items, requestDelete } = useUndoableDelete(allItems, {
    deleteUrl: (item) => `/api/interviews/${item.id}`,
    label: (item) => item.company,
    onCommitted: () => mutate(),
  });

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  }

  function openEdit(iv: Interview) {
    setEditing(iv);
    setForm({ company: iv.company, role: iv.role ?? "", stage: iv.stage, date: iv.date ?? "", notes: iv.notes ?? "" });
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      company: form.company,
      role: form.role || null,
      stage: form.stage,
      date: form.date || null,
      notes: form.notes || null,
    };
    try {
      if (editing) {
        await apiPatch(`/api/interviews/${editing.id}`, payload);
      } else {
        await apiPost("/api/interviews", payload);
      }
      setOpen(false);
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function updateStage(id: number, stage: string) {
    await apiPatch(`/api/interviews/${id}`, { stage });
    mutate();
  }

  return (
    <div>
      <PageHeader
        title="Interviews"
        subtitle="Track every application through to offer"
        action={
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={15} /> Add interview
          </button>
        }
      />

      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
            Loading…
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Briefcase} title="No interviews yet" sub="Add a company you've applied to and track it through each stage." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {items.map((iv) => (
              <li key={iv.id} className="flex items-center justify-between gap-3 px-4 py-3 group">
                <button
                  onClick={() => openEdit(iv)}
                  className="flex items-center gap-3 min-w-0 text-left flex-1"
                  aria-label={`Edit ${iv.company}`}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "color-mix(in srgb, var(--cat-interviews) 16%, transparent)" }}
                  >
                    <Briefcase size={15} color="var(--cat-interviews)" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {iv.company} {iv.role ? <span style={{ color: "var(--ink-muted)" }}>· {iv.role}</span> : null}
                    </p>
                    <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      {fmt(iv.date)}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={iv.stage}
                    onChange={(e) => updateStage(iv.id, e.target.value)}
                    className="badge cursor-pointer"
                    aria-label={`${iv.company} stage`}
                    style={{ color: STAGE_COLOR[iv.stage], borderColor: "var(--border-strong)" }}
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s} style={{ color: "#000" }}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(iv)} className="icon-btn" aria-label={`Edit ${iv.company}`}>
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => requestDelete(iv)} className="icon-btn" aria-label={`Delete ${iv.company}`}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit interview" : "Add an interview"}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="label">Company</label>
            <input
              className="input"
              placeholder="e.g. Amazon"
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Role (optional)</label>
            <input
              className="input"
              placeholder="Software Engineer Intern"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="label">Stage</label>
              <select
                className="input"
                value={form.stage}
                onChange={(e) => setForm({ ...form, stage: e.target.value as InterviewStage })}
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="label">Next date (optional)</label>
              <input
                type="date"
                className="input"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Notes (optional)</label>
            <textarea
              className="input"
              rows={2}
              placeholder="Recruiter contact, prep notes…"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          {error && (
            <p className="text-sm" style={{ color: "var(--critical)" }}>
              {error}
            </p>
          )}
          <button type="submit" disabled={saving || !form.company} className="btn btn-primary mt-1 disabled:opacity-50">
            {saving ? "Saving…" : editing ? "Save changes" : "Save interview"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
