"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { CheckSquare, Plus, Trash2, Check, Repeat, Pencil } from "lucide-react";
import { fetcher, apiPost, apiPatch } from "@/lib/fetcher";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import type { ChecklistItem } from "@/lib/types";

function groupByCategory(items: ChecklistItem[]) {
  const map = new Map<string, ChecklistItem[]>();
  for (const item of items) {
    const list = map.get(item.category) ?? [];
    list.push(item);
    map.set(item.category, list);
  }
  return Array.from(map.entries());
}

const emptyForm = { title: "", category: "General", recurring: true };

export default function ChecklistPage() {
  const { data, isLoading, mutate } = useSWR<{ items: ChecklistItem[] }>("/api/checklist", fetcher);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const allItems = useMemo(() => data?.items ?? [], [data]);
  const { visibleItems: items, requestDelete } = useUndoableDelete(allItems, {
    deleteUrl: (item) => `/api/checklist/${item.id}`,
    label: (item) => item.title,
    onCommitted: () => mutate(),
  });
  const grouped = useMemo(() => groupByCategory(items), [items]);

  async function toggle(item: ChecklistItem) {
    await apiPatch(`/api/checklist/${item.id}`, { done: !item.done });
    mutate();
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  }

  function openEdit(item: ChecklistItem) {
    setEditing(item);
    setForm({ title: item.title, category: item.category, recurring: !!item.recurring });
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await apiPatch(`/api/checklist/${editing.id}`, { title: form.title, category: form.category });
      } else {
        await apiPost("/api/checklist", form);
      }
      setOpen(false);
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Checklist"
        subtitle="Daily habits and other necessities"
        action={
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={15} /> Add item
          </button>
        }
      />

      {isLoading ? (
        <div className="card p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState icon={CheckSquare} title="Your checklist is empty" sub="Add recurring habits or one-off to-dos to check off." />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map(([category, list]) => (
            <div key={category} className="card">
              <div className="px-4 pt-3.5 pb-2">
                <span className="label">{category}</span>
              </div>
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {list.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5 group">
                    <button
                      className="flex items-center gap-3 min-w-0 text-left flex-1"
                      onClick={() => toggle(item)}
                      aria-pressed={!!item.done}
                      aria-label={`${item.done ? "Mark not done" : "Mark done"}: ${item.title}`}
                    >
                      <span
                        className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors"
                        style={{
                          background: item.done ? "var(--cat-checklist)" : "transparent",
                          border: `1.5px solid ${item.done ? "var(--cat-checklist)" : "var(--border-strong)"}`,
                        }}
                      >
                        {item.done ? <Check size={13} color="#fff" /> : null}
                      </span>
                      <span
                        className="text-sm truncate flex items-center gap-1.5"
                        style={{
                          color: item.done ? "var(--ink-muted)" : "var(--ink-primary)",
                          textDecoration: item.done ? "line-through" : "none",
                        }}
                      >
                        {item.title}
                        {item.recurring ? <Repeat size={11} style={{ color: "var(--ink-muted)" }} /> : null}
                      </span>
                    </button>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                      <button onClick={() => openEdit(item)} className="icon-btn" aria-label={`Edit ${item.title}`}>
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => requestDelete(item)} className="icon-btn" aria-label={`Delete ${item.title}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit item" : "Add a checklist item"}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="label">Title</label>
            <input
              className="input"
              placeholder="Drink water, meal prep, read 20 min…"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Category</label>
            <input
              className="input"
              placeholder="General"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </div>
          {!editing && (
            <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink-secondary)" }}>
              <input
                type="checkbox"
                checked={form.recurring}
                onChange={(e) => setForm({ ...form, recurring: e.target.checked })}
              />
              Recurring daily habit (counts toward &quot;today&quot; on Overview)
            </label>
          )}
          {error && (
            <p className="text-sm" style={{ color: "var(--critical)" }}>
              {error}
            </p>
          )}
          <button type="submit" disabled={saving || !form.title} className="btn btn-primary mt-1 disabled:opacity-50">
            {saving ? "Saving…" : editing ? "Save changes" : "Add item"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
