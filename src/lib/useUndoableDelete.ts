"use client";

import { useCallback, useRef, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { apiDelete } from "@/lib/fetcher";

interface Options<T extends { id: number }> {
  deleteUrl: (item: T) => string;
  label: (item: T) => string;
  onCommitted?: () => void;
  itemNoun?: string;
}

/**
 * Turns delete into "hide immediately, actually delete a few seconds later
 * unless undone" — the item disappears from the list right away (no jarring
 * confirm dialog) but nothing is unrecoverable until the toast times out.
 */
export function useUndoableDelete<T extends { id: number }>(items: T[], { deleteUrl, label, onCommitted }: Options<T>) {
  const { notify } = useToast();
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const timers = useRef<Map<number, number>>(new Map());

  const visibleItems = items.filter((item) => !pendingIds.has(item.id));

  const requestDelete = useCallback(
    (item: T) => {
      setPendingIds((prev) => new Set(prev).add(item.id));

      const commit = async () => {
        timers.current.delete(item.id);
        try {
          await apiDelete(deleteUrl(item));
        } finally {
          onCommitted?.();
        }
      };

      const timeoutId = window.setTimeout(commit, 5000);
      timers.current.set(item.id, timeoutId);

      notify({
        message: `Deleted "${label(item)}"`,
        actionLabel: "Undo",
        onAction: () => {
          const t = timers.current.get(item.id);
          if (t) window.clearTimeout(t);
          timers.current.delete(item.id);
          setPendingIds((prev) => {
            const next = new Set(prev);
            next.delete(item.id);
            return next;
          });
        },
      });
    },
    [deleteUrl, label, notify, onCommitted]
  );

  return { visibleItems, requestDelete };
}
