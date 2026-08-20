"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { apiDelete } from "@/lib/fetcher";

interface Options<T extends { id: number }> {
  deleteUrl: (item: T) => string;
  label: (item: T) => string;
  onCommitted?: () => void | Promise<unknown>;
  itemNoun?: string;
}

interface Pending {
  timeoutId: number;
  url: string;
}

/**
 * Turns delete into "hide immediately, actually delete a few seconds later
 * unless undone" — the item disappears from the list right away (no jarring
 * confirm dialog) but nothing is unrecoverable until the toast times out.
 */
export function useUndoableDelete<T extends { id: number }>(items: T[], { deleteUrl, label, onCommitted }: Options<T>) {
  const { notify } = useToast();
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const pending = useRef<Map<number, Pending>>(new Map());

  // Navigating away shouldn't resurrect something the user already deleted:
  // cancel the countdown, but still send the delete that was waiting on it.
  useEffect(() => {
    const inFlight = pending.current;
    return () => {
      for (const { timeoutId, url } of inFlight.values()) {
        window.clearTimeout(timeoutId);
        void apiDelete(url).catch(() => {});
      }
      inFlight.clear();
    };
  }, []);

  const visibleItems = items.filter((item) => !pendingIds.has(item.id));

  const unhide = useCallback((id: number) => {
    setPendingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const requestDelete = useCallback(
    (item: T) => {
      const url = deleteUrl(item);
      setPendingIds((prev) => new Set(prev).add(item.id));

      const commit = async () => {
        pending.current.delete(item.id);
        try {
          await apiDelete(url);
          // Revalidate *before* dropping the id from the hidden set, so the
          // row doesn't flash back in from the stale cache on its way out.
          await onCommitted?.();
        } catch (err) {
          // The delete failed, so the row is still on the server — put it back
          // rather than leaving it invisible until a reload.
          notify({
            message: err instanceof Error ? err.message : `Couldn't delete "${label(item)}"`,
            actionLabel: "Dismiss",
          });
        } finally {
          unhide(item.id);
        }
      };

      const timeoutId = window.setTimeout(commit, 5000);
      pending.current.set(item.id, { timeoutId, url });

      notify({
        message: `Deleted "${label(item)}"`,
        actionLabel: "Undo",
        onAction: () => {
          const entry = pending.current.get(item.id);
          if (entry) window.clearTimeout(entry.timeoutId);
          pending.current.delete(item.id);
          unhide(item.id);
        },
      });
    },
    [deleteUrl, label, notify, onCommitted, unhide]
  );

  return { visibleItems, requestDelete };
}
