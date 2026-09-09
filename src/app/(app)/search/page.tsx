"use client";

import { useState, useDeferredValue } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Search as SearchIcon } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { KIND_LABEL, type SearchHit } from "@/lib/search-types";
import { parseISODate } from "@/lib/date";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  // Keeps typing responsive while the previous result set is still on screen,
  // rather than blanking the list on every keystroke.
  const deferred = useDeferredValue(query);
  const ready = deferred.trim().length >= 2;

  const { data, isLoading } = useSWR<{ items: SearchHit[] }>(
    ready ? `/api/search?q=${encodeURIComponent(deferred.trim())}` : null,
    fetcher,
    { keepPreviousData: true }
  );

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader title="Search" subtitle="Everything you've written down, in one place" />

      <div className="card p-3 mb-4">
        <div className="relative">
          <SearchIcon
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--ink-muted)" }}
          />
          <input
            className="input pl-9"
            placeholder="Dentist, CSE 143, Ethereum…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            aria-label="Search everything"
          />
        </div>
      </div>

      {!ready ? (
        <div className="card p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
          Type at least two characters.
        </div>
      ) : isLoading && items.length === 0 ? (
        <div className="card p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
          Searching…
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={SearchIcon}
            title="Nothing matched"
            sub="This looks for the exact words you typed — it won't guess at something close."
          />
        </div>
      ) : (
        <div className="card">
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {items.map((hit) => (
              <li key={`${hit.kind}-${hit.id}`}>
                <Link
                  href={hit.href}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:opacity-80 transition-opacity"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{hit.title}</p>
                    {hit.detail && (
                      <p className="text-xs truncate" style={{ color: "var(--ink-muted)" }}>
                        {hit.detail}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="badge">{KIND_LABEL[hit.kind]}</span>
                    {hit.date && (
                      <p className="text-xs mt-1" style={{ color: "var(--ink-muted)" }}>
                        {parseISODate(hit.date).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
