"use client";

import { useEffect, useRef, useState } from "react";

const THRESHOLD = 64;
const MAX_PULL = 96;

/**
 * Pull-to-refresh on the window scroll — the gesture every phone user tries
 * on a stale list. Only arms when the page is already at the very top, and
 * only on devices without hover; a desktop drag-select must never trigger a
 * refresh. A mostly-upward move disarms it, so scrolling never fires one by
 * accident.
 *
 * Returns `pull` (px, 0 when idle) to drive an indicator, and `refreshing`
 * while `onRefresh` is in flight.
 */
export function usePullToRefresh(onRefresh: () => void | Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const cb = useRef(onRefresh);
  // Kept fresh in an effect: writing a ref during render is forbidden, and
  // the touch listeners below are registered once and read through the ref.
  useEffect(() => {
    cb.current = onRefresh;
  });

  useEffect(() => {
    if (!window.matchMedia("(hover: none)").matches) return;

    function arm(e: TouchEvent) {
      if (window.scrollY <= 0 && !refreshingRef.current) {
        startY.current = e.touches[0].clientY;
      }
    }
    function drag(e: TouchEvent) {
      if (startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        startY.current = null;
        pullRef.current = 0;
        setPull(0);
        return;
      }
      pullRef.current = Math.min(dy * 0.5, MAX_PULL);
      setPull(pullRef.current);
    }
    async function release() {
      if (startY.current === null) return;
      startY.current = null;
      if (pullRef.current >= THRESHOLD && !refreshingRef.current) {
        refreshingRef.current = true;
        setRefreshing(true);
        setPull(40);
        try {
          await cb.current();
        } finally {
          refreshingRef.current = false;
          setRefreshing(false);
        }
      }
      pullRef.current = 0;
      setPull(0);
    }

    document.addEventListener("touchstart", arm, { passive: true });
    document.addEventListener("touchmove", drag, { passive: true });
    document.addEventListener("touchend", release, { passive: true });
    return () => {
      document.removeEventListener("touchstart", arm);
      document.removeEventListener("touchmove", drag);
      document.removeEventListener("touchend", release);
    };
  }, []);

  return { pull, refreshing };
}
