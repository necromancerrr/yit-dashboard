"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Search as SearchIcon, CornerDownLeft, type LucideIcon } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { KIND_LABEL, type SearchHit } from "@/lib/search-types";
import { useIsLocked } from "@/components/LockGuard";
import { matchDestinations } from "@/lib/palette";

/**
 * ⌘K from anywhere: go to a section, or find a row.
 *
 * The sidebar already lists every section, and `/search` already finds every
 * row — but both cost a trip to the mouse, and the moment you want either is
 * always mid-thought on some other page. The palette is not new capability, it
 * is the same capability without the detour.
 *
 * **Read-only on purpose.** It navigates and it finds; it never writes. Quick
 * add lives on Today, where the proposal is previewed before anything is
 * saved, and a palette that also created rows would be a second write path
 * with none of that — Enter on a half-typed line is far too cheap for
 * something that lands in your ledger.
 *
 * Destinations are listed before results because they are certain: "money" is
 * a place you know exists, and it should never be pushed below a transaction
 * that happens to contain the word.
 */

interface Row {
  key: string;
  href: string;
  title: string;
  detail: string | null;
  badge: string;
  icon: LucideIcon | null;
}

export function CommandPalette() {
  const router = useRouter();
  // The lock screen puts the app in an `inert` subtree, which stops clicks and
  // focus but not a listener bound to the document. Without this check ⌘K
  // would open a searchable window onto the database *over* the lock.
  const locked = useIsLocked();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  }, []);

  // ⌘K / Ctrl-K, globally. Bound on the document rather than a container so it
  // works no matter what has focus, including another input.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (locked) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((wasOpen) => !wasOpen);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [locked]);

  // Keeps the previous result set on screen while the next request is in
  // flight, so the list does not blank on every keystroke.
  const deferred = useDeferredValue(query);
  const searchable = deferred.trim().length >= 2;
  const { data } = useSWR<{ items: SearchHit[] }>(
    open && searchable ? `/api/search?q=${encodeURIComponent(deferred.trim())}` : null,
    fetcher,
    { keepPreviousData: true }
  );

  const rows: Row[] = useMemo(() => {
    const destinations = matchDestinations(deferred).map<Row>((d) => ({
      key: `go:${d.href}`,
      href: d.href,
      title: d.label,
      detail: null,
      badge: "Go to",
      icon: d.icon,
    }));
    const hits = (data?.items ?? []).map<Row>((hit) => ({
      key: `${hit.kind}:${hit.id}`,
      href: hit.href,
      title: hit.title,
      detail: hit.detail,
      badge: KIND_LABEL[hit.kind],
      icon: null,
    }));
    // Cap destinations once you are clearly searching for a row, so ten section
    // links do not bury the thing you actually typed.
    return [...(searchable ? destinations.slice(0, 3) : destinations), ...hits];
  }, [deferred, data, searchable]);

  // The cursor is clamped during render rather than corrected in an effect:
  // the list can shrink between keystrokes, and a one-frame highlight on a row
  // that no longer exists is exactly the kind of flicker an effect introduces.
  const active = rows.length === 0 ? 0 : Math.min(cursor, rows.length - 1);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active, rows.length]);

  // Locking while the palette is open closes it, rather than leaving results
  // painted over the lock screen.
  if (!open || locked) return null;

  function go(href: string) {
    close();
    router.push(href);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (rows.length === 0 ? 0 : (Math.min(c, rows.length - 1) + 1) % rows.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) =>
        rows.length === 0 ? 0 : (Math.min(c, rows.length - 1) + rows.length - 1) % rows.length
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row) go(row.href);
    } else {
      // Any other key changes the query, and the old highlight means nothing
      // against a new list.
      setCursor(0);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div
        className="absolute inset-0 animate-fade-in"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }}
        onClick={close}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-lg card-raised p-0 overflow-hidden animate-fade-in"
      >
        <div
          className="flex items-center gap-2.5 px-4 py-3 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <SearchIcon size={15} style={{ color: "var(--ink-muted)" }} className="shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Go to a section, or search everything…"
            aria-label="Go to a section, or search everything"
            aria-controls="command-palette-results"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: "var(--ink-primary)" }}
          />
          <kbd
            className="text-[10px] px-1.5 py-0.5 rounded border shrink-0"
            style={{ borderColor: "var(--border)", color: "var(--ink-muted)" }}
          >
            esc
          </kbd>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
            {searchable
              ? "Nothing matched. This looks for the exact words you typed."
              : "Type at least two characters to search your rows."}
          </p>
        ) : (
          <ul
            ref={listRef}
            id="command-palette-results"
            role="listbox"
            className="max-h-[50vh] overflow-y-auto py-1"
          >
            {rows.map((row, i) => {
              const isActive = i === active;
              const Icon = row.icon;
              return (
                <li key={row.key} role="option" aria-selected={isActive} data-active={isActive}>
                  <button
                    onClick={() => go(row.href)}
                    onMouseEnter={() => setCursor(i)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
                    style={{ background: isActive ? "var(--surface-raised)" : "transparent" }}
                  >
                    {Icon && (
                      <Icon size={15} style={{ color: "var(--ink-muted)" }} className="shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm truncate">{row.title}</span>
                      {row.detail && (
                        <span
                          className="block text-xs truncate"
                          style={{ color: "var(--ink-muted)" }}
                        >
                          {row.detail}
                        </span>
                      )}
                    </span>
                    <span className="badge shrink-0">{row.badge}</span>
                    {isActive && (
                      <CornerDownLeft
                        size={13}
                        style={{ color: "var(--ink-muted)" }}
                        className="shrink-0"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
