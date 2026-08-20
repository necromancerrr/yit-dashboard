"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { Bitcoin, Plus, Trash2, Pencil, ScanLine, AlertTriangle, Lock } from "lucide-react";
import { fetcher, apiPost, apiPatch } from "@/lib/fetcher";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import type { CryptoHoldingWithPrice } from "@/lib/types";

interface Proposal {
  symbol: string;
  name: string;
  coin_id: string | null;
  quantity: number | null;
  staked_pct: number | null;
  price_usd: number | null;
  value_usd: number | null;
  needs_attention: boolean;
}

const usd = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** Crypto quantities span 8 decimals to millions, so a fixed precision looks wrong at one end. */
const qty = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : n < 1000 ? 4 : 2 });

const emptyForm = { symbol: "", name: "", quantity: "", staked_pct: "", notes: "" };

export function CryptoPanel() {
  const { data, isLoading, mutate } = useSWR<{
    items: CryptoHoldingWithPrice[];
    totalValue: number;
    unpricedCount: number;
  }>("/api/crypto", fetcher, { refreshInterval: 60_000 });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CryptoHoldingWithPrice | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [scanNotes, setScanNotes] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const allItems = data?.items ?? [];
  const { visibleItems: items, requestDelete } = useUndoableDelete(allItems, {
    deleteUrl: (item) => `/api/crypto/${item.id}`,
    label: (item) => item.symbol,
    onCommitted: () => mutate(),
  });

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked twice
    if (!file) return;

    setScanning(true);
    setError(null);
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Could not read that file"));
        reader.readAsDataURL(file);
      });

      const res = await apiPost<{ proposals: Proposal[]; notes: string | null }>(
        "/api/import/screenshot",
        { image, kind: "crypto" }
      );
      setProposals(res.proposals);
      setScanNotes(res.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setScanning(false);
    }
  }

  async function confirmImport() {
    if (!proposals) return;
    setImporting(true);
    setError(null);
    try {
      // Only rows with a quantity are saved — a holding without one has nothing
      // to track, and guessing would defeat the point of the review step.
      for (const p of proposals.filter((p) => p.quantity !== null)) {
        await apiPost("/api/crypto", {
          symbol: p.symbol,
          name: p.name,
          coin_id: p.coin_id,
          quantity: p.quantity,
          staked_pct: p.staked_pct,
        });
      }
      setProposals(null);
      setScanNotes(null);
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save those holdings");
    } finally {
      setImporting(false);
    }
  }

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  }

  function openEdit(h: CryptoHoldingWithPrice) {
    setEditing(h);
    setForm({
      symbol: h.symbol,
      name: h.name,
      quantity: String(h.quantity),
      staked_pct: h.staked_pct?.toString() ?? "",
      notes: h.notes ?? "",
    });
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      symbol: form.symbol,
      name: form.name || form.symbol,
      quantity: Number(form.quantity),
      staked_pct: form.staked_pct ? Number(form.staked_pct) : null,
      notes: form.notes || null,
    };
    try {
      if (editing) await apiPatch(`/api/crypto/${editing.id}`, payload);
      else await apiPost("/api/crypto", payload);
      setOpen(false);
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const total = data?.totalValue ?? 0;
  const importable = proposals?.filter((p) => p.quantity !== null).length ?? 0;

  return (
    <div>
      <div className="flex justify-end gap-2 mb-4">
        <button
          className="btn btn-ghost"
          onClick={() => fileInput.current?.click()}
          disabled={scanning}
        >
          <ScanLine size={15} /> {scanning ? "Reading…" : "Scan"}
        </button>
        <button className="btn btn-primary" onClick={openAdd}>
          <Plus size={15} /> Add holding
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFile}
        aria-label="Choose a screenshot to import"
      />

      {error && (
        <div className="card p-4 mb-4 text-sm" style={{ color: "var(--critical)" }}>
          {error}
        </div>
      )}

      {/* Total */}
      <div className="card p-4 mb-4">
        <span className="label">Portfolio value</span>
        <div className="text-3xl font-semibold tracking-tight mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>
          {isLoading ? "–" : usd(total)}
        </div>
        {(data?.unpricedCount ?? 0) > 0 && (
          <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{ color: "var(--warning)" }}>
            <AlertTriangle size={12} />
            Excludes {data?.unpricedCount} holding{data?.unpricedCount === 1 ? "" : "s"} with no price available
          </p>
        )}
      </div>

      {/* Holdings */}
      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
            Loading…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bitcoin}
            title="No holdings yet"
            sub="Add one manually, or tap Scan and hand it a screenshot of your exchange app."
          />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {items.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-3 group">
                <button onClick={() => openEdit(h)} className="flex items-center gap-3 min-w-0 text-left flex-1" aria-label={`Edit ${h.symbol}`}>
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold"
                    style={{ background: "color-mix(in srgb, var(--cat-crypto) 16%, transparent)", color: "var(--cat-crypto)" }}
                  >
                    {h.symbol.slice(0, 4)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{h.name}</p>
                    <p className="text-xs flex items-center gap-1.5" style={{ color: "var(--ink-muted)" }}>
                      {qty(h.quantity)} {h.symbol}
                      {h.staked_pct ? (
                        <>
                          <span>·</span>
                          <Lock size={10} /> {h.staked_pct}% staked
                        </>
                      ) : null}
                    </p>
                  </div>
                </button>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    {h.value_usd === null ? (
                      <p className="text-xs" style={{ color: "var(--warning)" }}>No price</p>
                    ) : (
                      <>
                        <p className="text-sm font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {usd(h.value_usd)}
                        </p>
                        {h.change_24h_pct !== null && (
                          <p
                            className="text-xs"
                            style={{ color: h.change_24h_pct >= 0 ? "var(--good)" : "var(--critical)" }}
                          >
                            {h.change_24h_pct >= 0 ? "↗" : "↘"} {Math.abs(h.change_24h_pct).toFixed(2)}%
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(h)} className="icon-btn" aria-label={`Edit ${h.symbol}`}>
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => requestDelete(h)} className="icon-btn" aria-label={`Delete ${h.symbol}`}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Review step — nothing is saved until this is confirmed. */}
      <Modal open={proposals !== null} onClose={() => setProposals(null)} title="Review what was read">
        <div className="flex flex-col gap-3">
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            Read from your screenshot. Check the numbers before saving — nothing has been added yet.
          </p>

          {scanNotes && (
            <p className="text-xs p-2.5 rounded-lg" style={{ background: "var(--surface-raised)", color: "var(--warning)" }}>
              {scanNotes}
            </p>
          )}

          <ul className="divide-y rounded-lg overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface-raised)" }}>
            {proposals?.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {p.name} <span style={{ color: "var(--ink-muted)" }}>{p.symbol}</span>
                  </p>
                  <p className="text-xs" style={{ color: p.needs_attention ? "var(--warning)" : "var(--ink-muted)" }}>
                    {p.quantity !== null
                      ? `${qty(p.quantity)} ${p.symbol}`
                      : "Couldn't determine a quantity — will be skipped"}
                  </p>
                </div>
                {p.value_usd !== null && (
                  <span className="text-sm shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {usd(p.value_usd)}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {proposals?.length === 0 && (
            <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
              Nothing recognisable found in that image.
            </p>
          )}

          <div className="flex gap-2 mt-1">
            <button className="btn btn-ghost flex-1" onClick={() => setProposals(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary flex-1 disabled:opacity-50"
              onClick={confirmImport}
              disabled={importing || importable === 0}
            >
              {importing ? "Saving…" : `Add ${importable}`}
            </button>
          </div>
        </div>
      </Modal>

      {/* Manual add / edit */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit holding" : "Add a holding"}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="label">Symbol</label>
              <input className="input" placeholder="ETH" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="label">Name</label>
              <input className="input" placeholder="Ethereum" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="label">Quantity</label>
              <input className="input" type="number" step="any" min={0} placeholder="1.25" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="label">Staked %</label>
              <input className="input" type="number" min={0} max={100} placeholder="0" value={form.staked_pct} onChange={(e) => setForm({ ...form, staked_pct: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Notes (optional)</label>
            <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {error && <p className="text-sm" style={{ color: "var(--critical)" }}>{error}</p>}
          <button type="submit" disabled={saving || !form.symbol || !form.quantity} className="btn btn-primary mt-1 disabled:opacity-50">
            {saving ? "Saving…" : editing ? "Save changes" : "Add holding"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
