"use client";

import { useState } from "react";
import useSWR from "swr";
import { Code2, Plus, Trash2, ExternalLink } from "lucide-react";
import { fetcher, apiPost, apiDelete } from "@/lib/fetcher";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import type { LeetcodeLog } from "@/lib/types";

const DIFFICULTIES = ["Easy", "Medium", "Hard"] as const;

const DIFFICULTY_COLOR: Record<string, string> = {
  Easy: "var(--good)",
  Medium: "var(--warning)",
  Hard: "var(--critical)",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" });
}

export default function LeetcodePage() {
  const { data, isLoading, mutate } = useSWR<{ items: LeetcodeLog[] }>("/api/leetcode", fetcher);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    date: todayISO(),
    problem_name: "",
    difficulty: "Medium" as (typeof DIFFICULTIES)[number],
    topic: "",
    url: "",
    notes: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/leetcode", {
        date: form.date,
        problem_name: form.problem_name,
        difficulty: form.difficulty,
        topic: form.topic || null,
        url: form.url || null,
        notes: form.notes || null,
      });
      setOpen(false);
      setForm({ date: todayISO(), problem_name: "", difficulty: "Medium", topic: "", url: "", notes: "" });
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    await apiDelete(`/api/leetcode/${id}`);
    mutate();
  }

  const items = data?.items ?? [];
  const counts = { Easy: 0, Medium: 0, Hard: 0 } as Record<string, number>;
  for (const it of items) counts[it.difficulty] = (counts[it.difficulty] ?? 0) + 1;

  return (
    <div>
      <PageHeader
        title="LeetCode"
        subtitle={`${items.length} problems solved`}
        action={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus size={15} /> Log problem
          </button>
        }
      />

      <div className="grid grid-cols-3 gap-3 mb-4">
        {DIFFICULTIES.map((d) => (
          <div key={d} className="card p-3.5 flex items-center gap-2.5">
            <span className="dot" style={{ background: DIFFICULTY_COLOR[d] }} />
            <div>
              <p className="text-lg font-semibold leading-none" style={{ fontVariantNumeric: "tabular-nums" }}>
                {counts[d] ?? 0}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
                {d}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
            Loading…
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Code2} title="No problems logged yet" sub="Track what you solve to see your progress heat up." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {items.map((log) => (
              <li key={log.id} className="flex items-center justify-between gap-3 px-4 py-3 group">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="dot shrink-0" style={{ background: DIFFICULTY_COLOR[log.difficulty] }} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate flex items-center gap-1.5">
                      {log.problem_name}
                      {log.url && (
                        <a href={log.url} target="_blank" rel="noreferrer" className="icon-btn w-5 h-5">
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </p>
                    <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      {fmt(log.date)} {log.topic ? `· ${log.topic}` : ""}
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

      <Modal open={open} onClose={() => setOpen(false)} title="Log a problem">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="label">Problem name</label>
            <input
              className="input"
              placeholder="Two Sum"
              value={form.problem_name}
              onChange={(e) => setForm({ ...form, problem_name: e.target.value })}
              autoFocus
            />
          </div>
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
              <label className="label">Difficulty</label>
              <select
                className="input"
                value={form.difficulty}
                onChange={(e) => setForm({ ...form, difficulty: e.target.value as (typeof DIFFICULTIES)[number] })}
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Topic (optional)</label>
            <input
              className="input"
              placeholder="Arrays, DP, Graphs…"
              value={form.topic}
              onChange={(e) => setForm({ ...form, topic: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Link (optional)</label>
            <input
              className="input"
              placeholder="https://leetcode.com/problems/…"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </div>
          {error && (
            <p className="text-sm" style={{ color: "var(--critical)" }}>
              {error}
            </p>
          )}
          <button type="submit" disabled={saving || !form.problem_name} className="btn btn-primary mt-1 disabled:opacity-50">
            {saving ? "Saving…" : "Save problem"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
