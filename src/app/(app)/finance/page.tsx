"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Wallet, Plus, Trash2, ArrowDownRight, ArrowUpRight, Pencil } from "lucide-react";
import { fetcher, apiPost, apiPatch } from "@/lib/fetcher";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import { parseISODate, todayISO } from "@/lib/date";
import type { FinanceTransaction } from "@/lib/types";

const EXPENSE_CATEGORIES = ["Rent", "Groceries", "Dining", "Transport", "Subscriptions", "Fun", "School", "Other"];
const INCOME_CATEGORIES = ["Paycheck", "Internship", "Financial Aid", "Gift", "Other"];

function fmt(iso: string) {
  return parseISODate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

const emptyForm = { date: todayISO(), type: "expense" as "income" | "expense", category: "Groceries", amount: "", note: "" };

export default function FinancePage() {
  const { data, isLoading, mutate } = useSWR<{ items: FinanceTransaction[] }>("/api/finance", fetcher);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceTransaction | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const allItems = data?.items ?? [];
  const { visibleItems: items, requestDelete } = useUndoableDelete(allItems, {
    deleteUrl: (item) => `/api/finance/${item.id}`,
    label: (item) => `${item.category} · ${currency(item.amount)}`,
    onCommitted: () => mutate(),
  });

  const { income, expense, byCategory } = useMemo(() => {
    let income = 0;
    let expense = 0;
    const byCategory = new Map<string, number>();
    for (const t of items) {
      if (t.type === "income") income += t.amount;
      else {
        expense += t.amount;
        byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
      }
    }
    const sorted = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { income, expense, byCategory: sorted };
  }, [items]);

  const maxCategory = byCategory.length ? byCategory[0][1] : 0;

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  }

  function openEdit(t: FinanceTransaction) {
    setEditing(t);
    setForm({ date: t.date, type: t.type, category: t.category, amount: t.amount.toString(), note: t.note ?? "" });
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      date: form.date,
      type: form.type,
      category: form.category,
      amount: Number(form.amount),
      note: form.note || null,
    };
    try {
      if (editing) {
        await apiPatch(`/api/finance/${editing.id}`, payload);
      } else {
        await apiPost("/api/finance", payload);
      }
      setOpen(false);
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const categories = form.type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <div>
      <PageHeader
        title="Money"
        subtitle="Income, spending, and where it's going"
        action={
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={15} /> Add transaction
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1">
            <ArrowUpRight size={14} color="var(--good)" />
            <span className="label">Income</span>
          </div>
          <p className="text-xl font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
            {currency(income)}
          </p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1">
            <ArrowDownRight size={14} color="var(--critical)" />
            <span className="label">Expenses</span>
          </div>
          <p className="text-xl font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
            {currency(expense)}
          </p>
        </div>
        <div className="card p-4 col-span-2 lg:col-span-1">
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={14} color="var(--accent)" />
            <span className="label">Net</span>
          </div>
          <p
            className="text-xl font-semibold"
            style={{ fontVariantNumeric: "tabular-nums", color: income - expense >= 0 ? "var(--good)" : "var(--critical)" }}
          >
            {currency(income - expense)}
          </p>
        </div>
      </div>

      {byCategory.length > 0 && (
        <div className="card p-4 mb-4">
          <h2 className="text-sm font-semibold mb-3">Top spending categories</h2>
          <div className="flex flex-col gap-2.5">
            {byCategory.map(([cat, amt]) => (
              <div key={cat} className="flex items-center gap-3">
                <span className="text-xs w-24 shrink-0 truncate" style={{ color: "var(--ink-secondary)" }}>
                  {cat}
                </span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--surface-raised)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${maxCategory ? (amt / maxCategory) * 100 : 0}%`, background: "var(--cat-finance)" }}
                  />
                </div>
                <span className="text-xs w-16 text-right shrink-0" style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink-muted)" }}>
                  {currency(amt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
            Loading…
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Wallet} title="No transactions yet" sub="Add your first income or expense to see your monthly picture." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {items.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 group">
                <button
                  onClick={() => openEdit(t)}
                  className="flex items-center gap-3 min-w-0 text-left flex-1"
                  aria-label={`Edit ${t.category} transaction`}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background:
                        t.type === "income"
                          ? "color-mix(in srgb, var(--good) 16%, transparent)"
                          : "color-mix(in srgb, var(--cat-finance) 16%, transparent)",
                    }}
                  >
                    {t.type === "income" ? (
                      <ArrowUpRight size={15} color="var(--good)" />
                    ) : (
                      <ArrowDownRight size={15} color="var(--cat-finance)" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {t.category} {t.note ? <span style={{ color: "var(--ink-muted)" }}>· {t.note}</span> : null}
                    </p>
                    <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      {fmt(t.date)}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className="text-sm font-medium"
                    style={{ fontVariantNumeric: "tabular-nums", color: t.type === "income" ? "var(--good)" : "var(--ink-primary)" }}
                  >
                    {t.type === "income" ? "+" : "-"}
                    {currency(t.amount)}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(t)} className="icon-btn" aria-label={`Edit ${t.category} transaction`}>
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => requestDelete(t)} className="icon-btn" aria-label={`Delete ${t.category} transaction`}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit transaction" : "Add a transaction"}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            {(["expense", "income"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm({ ...form, type: t, category: t === "income" ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0] })}
                className="btn"
                style={{
                  background: form.type === t ? "var(--accent)" : "var(--surface-raised)",
                  color: form.type === t ? "#fff" : "var(--ink-secondary)",
                  border: "1px solid var(--border-strong)",
                }}
              >
                {t === "income" ? "Income" : "Expense"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="label">Amount</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className="input"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="label">Date</label>
              <input
                type="date"
                className="input"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Category</label>
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Note (optional)</label>
            <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          {error && (
            <p className="text-sm" style={{ color: "var(--critical)" }}>
              {error}
            </p>
          )}
          <button type="submit" disabled={saving || !form.amount} className="btn btn-primary mt-1 disabled:opacity-50">
            {saving ? "Saving…" : editing ? "Save changes" : "Save transaction"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
