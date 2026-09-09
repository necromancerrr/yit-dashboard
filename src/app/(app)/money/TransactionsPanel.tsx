"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Wallet, Plus, Trash2, ArrowDownRight, ArrowUpRight, Pencil } from "lucide-react";
import { fetcher, apiPost, apiPatch } from "@/lib/fetcher";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import { parseISODate, todayISO } from "@/lib/date";
import {
  PERIODS,
  summarizePeriod,
  percentChange,
  type PeriodId,
} from "@/lib/money-period";
import type { FinanceTransaction } from "@/lib/types";

const EXPENSE_CATEGORIES = ["Rent", "Groceries", "Dining", "Transport", "Subscriptions", "Fun", "School", "Other"];
const INCOME_CATEGORIES = ["Paycheck", "Internship", "Financial Aid", "Gift", "Other"];

function fmt(iso: string) {
  return parseISODate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/**
 * "You spent $890" is trivia. "$890, up 31% on last month" is the thing that
 * changes what you do next — so every card carries its own comparison, or
 * says nothing at all.
 *
 * `direction` exists because up is not universally good: more income is
 * progress and more spending is not, and colouring both green would make the
 * whole row meaningless.
 */
function Comparison({
  current,
  previous,
  label,
  moreIsBetter,
}: {
  current: number;
  previous: number | null;
  label: string | null;
  moreIsBetter: boolean;
}) {
  if (previous === null || label === null) return null;
  const change = percentChange(current, previous);
  // Null means the previous period was zero, where a percentage would be a
  // made-up number wearing the clothes of a measurement.
  if (change === null) {
    return (
      <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
        nothing in {label}
      </p>
    );
  }
  if (change === 0) {
    return (
      <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
        level with {label}
      </p>
    );
  }
  const better = change > 0 === moreIsBetter;
  return (
    <p
      className="text-xs mt-0.5"
      style={{ color: better ? "var(--good)" : "var(--warning)" }}
    >
      {change > 0 ? "↑" : "↓"} {Math.abs(change)}% vs {label}
    </p>
  );
}

const emptyForm = { date: todayISO(), type: "expense" as "income" | "expense", category: "Groceries", amount: "", note: "" };

export function TransactionsPanel() {
  const { data, isLoading, mutate } = useSWR<{ items: FinanceTransaction[] }>(
    // The default limit is 300. Totals computed over a truncated ledger are
    // silently wrong — "All time" would quietly mean "the most recent 300" —
    // and this is one person's transactions, not a feed.
    "/api/finance?limit=5000",
    fetcher
  );
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

  // These cards used to total every row the list had loaded — up to three
  // hundred, reaching back however far that went — while the empty state
  // promised a "monthly picture". A figure with no period attached is not a
  // wrong figure, it is one you cannot act on.
  const [period, setPeriod] = useState<PeriodId>("month");
  const today = todayISO();
  const summary = useMemo(
    () => summarizePeriod(items, period, today),
    [items, period, today]
  );
  const { income, expense, byCategory } = summary;
  const periodOption = PERIODS.find((p) => p.id === period)!;

  const maxCategory = byCategory.length ? byCategory[0][1] : 0;

  // The list follows the period too, so the control means one thing rather
  // than two: cards for this month above a ledger going back years reads as a
  // bug even when both halves are correct.
  const visible = useMemo(
    () =>
      summary.range
        ? items.filter((t) => t.date >= summary.range!.from && t.date <= summary.range!.to)
        : items,
    [items, summary.range]
  );

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
      <div className="flex items-center justify-between gap-3 mb-4">
        <div
          className="flex gap-1 p-1 rounded-lg"
          role="group"
          aria-label="Summary period"
        >
          {PERIODS.map((p) => {
            const active = p.id === period;
            return (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                aria-pressed={active}
                className="px-2.5 py-1 rounded-md text-xs transition-colors"
                style={{
                  background: active ? "var(--surface-raised)" : "transparent",
                  color: active ? "var(--ink-primary)" : "var(--ink-muted)",
                  fontWeight: active ? 600 : 500,
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <button className="btn btn-primary" onClick={openAdd}>
          <Plus size={15} /> Add transaction
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1">
            <ArrowUpRight size={14} color="var(--good)" />
            <span className="label">Income</span>
          </div>
          <p className="text-xl font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
            {currency(income)}
          </p>
          <Comparison
            current={income}
            previous={summary.previous?.income ?? null}
            label={periodOption.previousLabel}
            moreIsBetter
          />
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1">
            <ArrowDownRight size={14} color="var(--critical)" />
            <span className="label">Expenses</span>
          </div>
          <p className="text-xl font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
            {currency(expense)}
          </p>
          <Comparison
            current={expense}
            previous={summary.previous?.expense ?? null}
            label={periodOption.previousLabel}
            moreIsBetter={false}
          />
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
          <Comparison
            current={summary.net}
            previous={summary.previous?.net ?? null}
            label={periodOption.previousLabel}
            moreIsBetter
          />
        </div>
      </div>

      {byCategory.length > 0 && (
        <div className="card p-4 mb-4">
          <h2 className="text-sm font-semibold mb-3">
            Top spending &middot;{" "}
            <span style={{ color: "var(--ink-muted)", fontWeight: 500 }}>
              {periodOption.label.toLowerCase()}
            </span>
          </h2>
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
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={items.length === 0 ? "No transactions yet" : `Nothing in ${periodOption.label.toLowerCase()}`}
            sub={
              items.length === 0
                ? "Add your first income or expense to see where your money goes."
                : "You have transactions in other periods — switch the range above."
            }
          />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {visible.map((t) => (
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
