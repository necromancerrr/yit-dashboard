"use client";

import { useMemo, useState } from "react";
import { parseISODate, toISODate } from "@/lib/date";
import type { HeatmapDay } from "@/lib/types";

const HEAT_STEPS = ["var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)", "var(--heat-5)"];

function levelFor(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 1) return count > 0 ? 3 : 0;
  const ratio = count / max;
  if (ratio > 0.8) return 5;
  if (ratio > 0.6) return 4;
  if (ratio > 0.35) return 3;
  if (ratio > 0.1) return 2;
  return 1;
}

function fmtDate(iso: string): string {
  const d = parseISODate(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function Heatmap({ data, weeks = 53 }: { data: HeatmapDay[]; weeks?: number }) {
  const [hover, setHover] = useState<{ date: string; count: number; x: number; y: number } | null>(null);

  const { columns, monthMarkers, max, total } = useMemo(() => {
    const countByDate = new Map(data.map((d) => [d.date, d.count]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Align the final column to the current week (start on Sunday).
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay()));
    const totalDays = weeks * 7;
    const start = new Date(end);
    start.setDate(start.getDate() - totalDays + 1);

    const cols: { date: string; count: number; inRange: boolean }[][] = [];
    const markers: { index: number; label: string }[] = [];
    let lastMonth = -1;
    let max = 0;
    let total = 0;

    for (let w = 0; w < weeks; w++) {
      const col: { date: string; count: number; inRange: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(start);
        day.setDate(day.getDate() + w * 7 + d);
        const iso = toISODate(day);
        const count = countByDate.get(iso) ?? 0;
        const inRange = day <= today;
        if (inRange) {
          max = Math.max(max, count);
          total += count;
        }
        col.push({ date: iso, count, inRange });
        if (d === 0 && day.getMonth() !== lastMonth) {
          lastMonth = day.getMonth();
          markers.push({ index: w, label: MONTH_LABELS[lastMonth] });
        }
      }
      cols.push(col);
    }
    return { columns: cols, monthMarkers: markers, max, total };
  }, [data, weeks]);

  return (
    <div className="relative">
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex flex-col gap-1 min-w-max">
          <div className="flex gap-[3px] pl-0 text-[10px]" style={{ color: "var(--ink-muted)" }}>
            {columns.map((_, i) => {
              const marker = monthMarkers.find((m) => m.index === i);
              return (
                <div key={i} className="w-[11px]">
                  {marker ? marker.label : ""}
                </div>
              );
            })}
          </div>
          <div className="flex gap-[3px]">
            {columns.map((col, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {col.map((day, di) => (
                  <div
                    key={di}
                    className="w-[11px] h-[11px] rounded-[3px] cursor-default transition-transform hover:scale-110"
                    style={{
                      background: day.inRange ? HEAT_STEPS[levelFor(day.count, max)] : "transparent",
                      opacity: day.inRange ? 1 : 0,
                    }}
                    onMouseEnter={(e) => {
                      if (!day.inRange) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHover({ date: day.date, count: day.count, x: rect.left, y: rect.top });
                    }}
                    onMouseLeave={() => setHover(null)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 text-xs" style={{ color: "var(--ink-muted)" }}>
        <span>{total} active days in the last year</span>
        <div className="flex items-center gap-1">
          <span>Less</span>
          {HEAT_STEPS.map((c, i) => (
            <div key={i} className="w-[10px] h-[10px] rounded-[2px]" style={{ background: c }} />
          ))}
          <span>More</span>
        </div>
      </div>

      {hover && (
        <div
          className="fixed z-50 px-2.5 py-1.5 rounded-lg text-xs pointer-events-none card-raised animate-fade-in"
          style={{ left: hover.x, top: hover.y - 46 }}
        >
          <span style={{ color: "var(--ink-primary)" }} className="font-medium">
            {hover.count} {hover.count === 1 ? "activity" : "activities"}
          </span>
          <span style={{ color: "var(--ink-muted)" }}> · {fmtDate(hover.date)}</span>
        </div>
      )}
    </div>
  );
}
