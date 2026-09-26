"use client";

import { useRef, useState } from "react";

export interface SwipeAction {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

const ACTION_WIDTH = 48;

/**
 * A list row whose actions reveal on a leftward swipe (touch) or on
 * hover / keyboard focus (desktop). The actions sit behind the content in
 * normal flow, so a row is fully usable with no JavaScript gesture at all —
 * swipe is an accelerator, not the only path.
 *
 * Vertical scrolling is never hijacked: a mostly-vertical drag cancels the
 * swipe and the page scrolls as usual.
 */
export function SwipeableRow({
  children,
  actions,
}: {
  children: React.ReactNode;
  actions: SwipeAction[];
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const maxDx = actions.length * ACTION_WIDTH;

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    setDragging(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!start.current) return;
    const t = e.touches[0];
    const ddx = t.clientX - start.current.x;
    const ddy = t.clientY - start.current.y;
    // Mostly vertical: this is a scroll, abandon the swipe.
    if (Math.abs(ddy) > 14 && Math.abs(ddy) > Math.abs(ddx)) {
      start.current = null;
      setDragging(false);
      setDx(0);
      return;
    }
    setDx(Math.max(-maxDx, Math.min(0, ddx)));
  }

  function onTouchEnd() {
    start.current = null;
    setDragging(false);
    // Snap open past halfway, otherwise spring shut.
    setDx((prev) => (prev < -maxDx / 2 ? -maxDx : 0));
  }

  const open = dx < -4;

  return (
    <div
      className="swipeable relative overflow-hidden"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="swipeable-actions absolute right-0 top-0 bottom-0 flex items-center"
        style={{ width: maxDx, opacity: open ? 1 : undefined }}
        aria-hidden={!open}
      >
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={() => {
              setDx(0);
              a.onClick();
            }}
            className="icon-btn"
            style={{ width: ACTION_WIDTH, height: "100%", borderRadius: 0, color: a.danger ? "var(--critical)" : undefined }}
            aria-label={a.label}
            tabIndex={open ? 0 : -1}
          >
            {a.icon}
          </button>
        ))}
      </div>
      <div
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 180ms ease",
        }}
      >
        {children}
      </div>
    </div>
  );
}
