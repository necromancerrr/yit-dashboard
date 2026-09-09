"use client";

import useSWR from "swr";
import { Repeat, TrendingDown } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { EmptyState } from "@/components/EmptyState";
import { isDueSoon, type RecurringCharge } from "@/lib/recurring";
import { parseISODate } from "@/lib/date";

/**
 * Read-only on purpose.
 *
 * Nothing here is a row you own — every line is *derived* from transactions
 * you already logged, so there is nothing to add, edit or delete. Giving it a
 * "+" button would imply the list is a place you maintain, and then the day you
 * forget to maintain it the number silently stops being true.
 *
 * The headline is the yearly total, because that is the figure that changes
 * behaviour. "$11.99" is nothing; "$141 a year for a thing you last opened in
 * March" is a decision.
 */

const usd = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function cadenceText(charge: RecurringCharge): string {
  if (charge.cadence === "weekly") return "Weekly";
  if (charge.cadence === "monthly") return "Monthly";
  if (charge.cadence === "yearly") return "Yearly";
  return `Every ${charge.cadenceDays} days`;
}

const shortDate = (iso: string) =>
  parseISODate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function RecurringPanel() {
  const { data, isLoading } = useSWR<{
    items: RecurringCharge[];
    totalAnnualCost: number;
    today: string;
  }>("/api/finance/recurring", fetcher);

  if (isLoading) {
    return (
      <div className="card p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
        Looking for repeats…
      </div>
    );
  }

  const items = data?.items ?? [];
  const today = data?.today ?? "";

  if (items.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={Repeat}
          title="Nothing repeating yet"
          sub="A charge shows up here once the same category has been logged three times at a steady interval for a steady amount."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center gap-3">
        <TrendingDown size={18} style={{ color: "var(--cat-finance)" }} className="shrink-0" />
        <div>
          <p className="text-xl font-semibold">{usd(data?.totalAnnualCost ?? 0)}</p>
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            committed per year across {items.length} repeating charge
            {items.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="card">
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {items.map((charge) => {
            const soon = today ? isDueSoon(charge, today) : false;
            return (
              <li
                key={charge.category}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{charge.category}</p>
                  <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                    {cadenceText(charge)} · {usd(charge.typicalAmount)} · seen{" "}
                    {charge.occurrences} times
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium">{usd(charge.annualCost)}/yr</p>
                  <p
                    className="text-xs"
                    style={{ color: soon ? "var(--warning)" : "var(--ink-muted)" }}
                  >
                    {soon ? "due " : "next "}
                    {shortDate(charge.nextExpected)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: "var(--ink-muted)" }}>
        Worked out from your own transactions — nothing is read from a bank. A charge
        you log under a different category each time will not appear here.
      </p>
    </div>
  );
}
