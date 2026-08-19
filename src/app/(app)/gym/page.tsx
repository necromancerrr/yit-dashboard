"use client";

import { useState } from "react";
import useSWR from "swr";
import { Dumbbell, Plus, Trash2, Clock } from "lucide-react";
import { fetcher, apiPost, apiDelete } from "@/lib/fetcher";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import type { GymLog } from "@/lib/types";

const WORKOUT_TYPES = ["Push", "Pull", "Legs", "Upper", "Lower", "Full Body", "Cardio", "Mobility", "Other"];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" });
}

export default function GymPage() {
  const { data, isLoading, mutate } = useSWR<{ items: GymLog[] }>("/api/gym", fetcher);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ date: todayISO(), workout_type: "Push", duration_min: "", notes: "" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/gym", {
        date: form.date,
        workout_type: form.workout_type,
        duration_min: form.duration_min ? Number(form.duration_min) : null,
        notes: form.notes || null,
      });
      setOpen(false);
      setForm({ date: todayISO(), workout_type: "Push", duration_min: "", notes: "" });
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    await apiDelete(`/api/gym/${id}`);
    mutate();
  }

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Gym"
        subtitle="Log workouts and keep your streak alive"
        action={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={15} /> Log workout
          </button>
        }
      />

      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
            Loading…
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Dumbbell} title="No workouts logged yet" sub="Log your first session to start your streak." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {items.map((log) => (
              <li key={log.id} className="flex items-center justify-between gap-3 px-4 py-3 group">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "color-mix(in srgb, var(--cat-gym) 16%, transparent)" }}
                  >
                    <Dumbbell size={15} color="var(--cat-gym)" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{log.workout_type}</p>
                    <p className="text-xs flex items-center gap-1.5" style={{ color: "var(--ink-muted)" }}>
                      {fmt(log.date)}
                      {log.duration_min ? (
                        <>
                          <span>·</span>
                          <Clock size={11} /> {log.duration_min}min
                        </>
                      ) : null}
                      {log.notes ? <span className="truncate">· {log.notes}</span> : null}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(log.id)}
                  className="icon-btn opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Log a workout">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="label">Date</label>
              <input
                type="date"
                className="input"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="label">Duration (min)</label>
              <input
                type="number"
                min={0}
                className="input"
                placeholder="60"
                value={form.duration_min}
                onChange={(e) => setForm({ ...form, duration_min: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Workout type</label>
            <select
              className="input"
              value={form.workout_type}
              onChange={(e) => setForm({ ...form, workout_type: e.target.value })}
            >
              {WORKOUT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Notes (optional)</label>
            <textarea
              className="input"
              rows={2}
              placeholder="PRs, how it felt, etc."
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          {error && (
            <p className="text-sm" style={{ color: "var(--critical)" }}>
              {error}
            </p>
          )}
          <button type="submit" disabled={saving} className="btn btn-primary mt-1 disabled:opacity-50">
            {saving ? "Saving…" : "Save workout"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
