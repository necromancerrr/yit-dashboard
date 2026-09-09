"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { TransactionsPanel } from "./TransactionsPanel";
import { CryptoPanel } from "./CryptoPanel";
import { RecurringPanel } from "./RecurringPanel";

/**
 * Money is one area, not three products.
 *
 * Cash flow, repeating charges and crypto all answer the same question — where
 * you stand — so they live under one heading. They stay separate *panels*
 * because the work is different: transactions are something you log, recurring
 * charges are something you are shown, holdings are something you check. Tabs
 * keep each a click away without stacking three dashboards on one screen.
 */
const TABS = [
  { id: "cash", label: "Cash flow" },
  { id: "recurring", label: "Recurring" },
  { id: "crypto", label: "Crypto" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * `useSearchParams` opts a route out of static prerendering unless it sits
 * under a Suspense boundary — the build fails outright otherwise. The header
 * renders immediately and only the tabs wait, so there is nothing to see.
 */
export default function MoneyPage() {
  return (
    <div>
      <PageHeader title="Money" subtitle="Income, spending, and holdings" />
      <Suspense
        fallback={
          <div className="card p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
            Loading…
          </div>
        }
      >
        <MoneyTabs />
      </Suspense>
    </div>
  );
}

function MoneyTabs() {
  // A screenshot shared from another app lands here as `?shared=<id>`, and only
  // the crypto panel knows how to collect it — landing on Cash flow would drop
  // the share silently. Read once, as the initial value, so switching tabs
  // afterwards still works.
  const shared = useSearchParams().get("shared");
  const [tab, setTab] = useState<TabId>(shared ? "crypto" : "cash");

  return (
    <div>
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
      {tab === "cash" ? (
        <TransactionsPanel />
      ) : tab === "recurring" ? (
        <RecurringPanel />
      ) : (
        <CryptoPanel />
      )}
    </div>
  );
}
