"use client";

import useSWR from "swr";
import { Flame, Code2, Briefcase, GraduationCap, Wallet, CheckSquare, Bitcoin } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/PageHeader";
import { Heatmap } from "@/components/Heatmap";
import type { SummaryData } from "@/lib/types";
import { getDisplayName } from "@/lib/identity";

function currency(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function OverviewPage() {
  const { data, isLoading } = useSWR<SummaryData>("/api/summary", fetcher, {
    refreshInterval: 60_000,
  });

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${getDisplayName()}`}
        subtitle={new Date().toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <StatCard
          label="Gym streak"
          value={isLoading ? "–" : `${data?.gymStreak ?? 0}d`}
          sub="consecutive days"
          icon={Flame}
          accent="var(--cat-gym)"
        />
        <StatCard
          label="LeetCode"
          value={isLoading ? "–" : `${data?.leetcodeThisWeek ?? 0}`}
          sub={`this week · ${data?.leetcodeTotal ?? 0} total`}
          icon={Code2}
          accent="var(--cat-leetcode)"
        />
        <StatCard
          label="Interviews"
          value={isLoading ? "–" : `${data?.upcomingInterviews ?? 0}`}
          sub="upcoming"
          icon={Briefcase}
          accent="var(--cat-interviews)"
        />
        <StatCard
          label="Next deadline"
          value={data?.nextSchoolDeadline ? data.nextSchoolDeadline.title : "None"}
          sub={data?.nextSchoolDeadline ? data.nextSchoolDeadline.course : "you're all caught up"}
          icon={GraduationCap}
          accent="var(--cat-school)"
        />
        <StatCard
          label="This month"
          value={isLoading ? "–" : currency(data?.monthNet ?? 0)}
          sub={`${currency(data?.monthIncome ?? 0)} in · ${currency(data?.monthExpense ?? 0)} out`}
          icon={Wallet}
          accent="var(--cat-finance)"
        />
        <StatCard
          label="Crypto"
          value={isLoading ? "–" : currency(data?.cryptoValue ?? 0)}
          sub={`${data?.cryptoCount ?? 0} holding${data?.cryptoCount === 1 ? "" : "s"} · live`}
          icon={Bitcoin}
          accent="var(--cat-crypto)"
        />
        <StatCard
          label="Today's checklist"
          value={isLoading ? "–" : `${data?.checklistDoneToday ?? 0}/${data?.checklistTotalToday ?? 0}`}
          sub="recurring items done"
          icon={CheckSquare}
          accent="var(--cat-checklist)"
        />
      </div>

      <div className="card p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Activity</h2>
          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
            Gym · LeetCode · Checklist
          </span>
        </div>
        {isLoading ? (
          <div className="h-32 flex items-center justify-center text-sm" style={{ color: "var(--ink-muted)" }}>
            Loading…
          </div>
        ) : (
          <Heatmap data={data?.heatmap ?? []} />
        )}
      </div>
    </div>
  );
}
