"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { TransactionsPanel } from "./TransactionsPanel";
import { CryptoPanel } from "./CryptoPanel";

/**
 * Money is one area, not two products.
 *
 * Cash flow and crypto answer the same question — where you stand — so they
 * live under one heading. They stay separate *panels* because the day-to-day
 * work is different: transactions are something you log, holdings are
 * something you check. Tabs keep both a click away without stacking two
 * unrelated dashboards on one screen.
 */
const TABS = [
  { id: "cash", label: "Cash flow" },
  { id: "crypto", label: "Crypto" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function MoneyPage() {
  const [tab, setTab] = useState<TabId>("cash");

  return (
    <div>
      <PageHeader title="Money" subtitle="Income, spending, and holdings" />

      <div
        className="flex gap-1 mb-5 p-1 rounded-lg w-fit"
        role="tablist"
        aria-label="Money sections"
        style={{ background: "var(--surface)" }}
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className="px-3 py-1.5 rounded-md text-sm transition-colors"
              style={{
                background: active ? "var(--surface-raised)" : "transparent",
                color: active ? "var(--ink-primary)" : "var(--ink-secondary)",
                fontWeight: active ? 600 : 500,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Both panels own their data fetching, so switching tabs never
          refetches the one you were already looking at. */}
      {tab === "cash" ? <TransactionsPanel /> : <CryptoPanel />}
    </div>
  );
}
