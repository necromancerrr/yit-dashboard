"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  Plus,
  ChefHat,
  Clock,
  Flame,
  Users,
  Link2,
  Pencil,
  Trash2,
  X,
  Loader2,
  Sparkles,
  ImagePlus,
  ExternalLink,
  Check,
} from "lucide-react";
import { fetcher, apiPost, apiPatch } from "@/lib/fetcher";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import { useToast } from "@/components/ToastProvider";
import { Modal } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import type { MealPrep } from "@/lib/types";

interface ImportSource {
  platform: "instagram" | "tiktok" | "youtube";
  url: string;
  nativeId: string;
  title: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  embedUrl: string;
}

interface Proposal {
  name: string;
  ingredients: string[];
  steps: string[];
  prep_min: number | null;
  cook_min: number | null;
  servings: number | null;
  calories: number | null;
  protein_g: number | null;
  notes: string | null;
}

const PLATFORM_LABEL: Record<ImportSource["platform"], string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};

function parseLines(json: string | null): string[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function totalMin(meal: MealPrep): number | null {
  const p = meal.prep_min ?? 0;
  const c = meal.cook_min ?? 0;
  const total = p + c;
  return total > 0 ? total : null;
}

const emptyForm = {
  name: "",
  ingredientsText: "",
  stepsText: "",
  prep_min: "",
  cook_min: "",
  servings: "",
  calories: "",
  protein_g: "",
  tags: "",
  notes: "",
};

/**
 * Reads ?meal_url=… from the OS share target. useSearchParams() must sit
 * below a Suspense boundary or the build fails — same shape as the money
 * page's share handoff. The param is consumed once (ref guard) and cleaned
 * from the URL so a reload doesn't reopen the sheet.
 */
function MealShareCatcher({ onShare }: { onShare: (url: string) => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const mealUrl = params.get("meal_url");
  const seen = useRef<string | null>(null);
  const cb = useRef(onShare);
  useEffect(() => {
    cb.current = onShare;
  });

  useEffect(() => {
    if (!mealUrl || seen.current === mealUrl) return;
    seen.current = mealUrl;
    queueMicrotask(() => {
      cb.current(mealUrl);
      router.replace("/health");
    });
  }, [mealUrl, router]);

  return null;
}

export function MealPrepPanel() {
  const { data, isLoading, mutate } = useSWR<{ items: MealPrep[] }>("/api/meals", fetcher);
  const { notify } = useToast();
  const [detail, setDetail] = useState<MealPrep | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<MealPrep | null>(null);
  const importPreset = useRef<string | null>(null);
  const [importKey, setImportKey] = useState(0);
  const consumedShare = useRef<string | null>(null);

  const meals = useMemo(() => data?.items ?? [], [data]);
  const { visibleItems: items, requestDelete } = useUndoableDelete(meals, {
    deleteUrl: (item) => `/api/meals/${item.id}`,
    label: (item) => item.name,
    onCommitted: () => {
      setDetail(null);
      mutate();
    },
  });

  // A link shared from the OS share sheet arrives as ?meal_url=…. The handoff
  // runs off the commit path (queueMicrotask): this repo forbids synchronous
  // setState inside effects, and the money share flow works the same way.
  function handleSharedUrl(url: string) {
    if (consumedShare.current === url) return;
    consumedShare.current = url;
    queueMicrotask(() => openImport(url));
  }

  function openImport(presetUrl?: string) {
    setEditing(null);
    // The modal reads its initial URL from this ref via key remount below.
    importPreset.current = presetUrl ?? null;
    setImportKey((k) => k + 1);
    setImportOpen(true);
  }

  function openEdit(meal: MealPrep) {
    setEditing(meal);
    setDetail(null);
    importPreset.current = null;
    setImportKey((k) => k + 1);
    setImportOpen(true);
  }

  return (
    <section className="mt-8" aria-label="Meal prep">
      <Suspense fallback={null}>
        <MealShareCatcher onShare={handleSharedUrl} />
      </Suspense>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ChefHat size={16} color="var(--cat-gym)" /> Meal prep
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
            Recipes worth cooking, saved from the videos you actually watch
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => openImport()}>
          <Plus size={15} /> Add meal
        </button>
      </div>

      {isLoading ? (
        <div className="card p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={ChefHat}
            title="No recipes saved yet"
            sub="Paste an Instagram or TikTok link and get a recipe draft back."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((meal) => (
            <MealCard key={meal.id} meal={meal} onOpen={() => setDetail(meal)} />
          ))}
        </div>
      )}

      {detail && (
        <MealDetailModal
          meal={detail}
          onClose={() => setDetail(null)}
          onEdit={() => openEdit(detail)}
          onDelete={() => requestDelete(detail)}
          onCooked={async () => {
            const next = detail.times_cooked + 1;
            await apiPatch(`/api/meals/${detail.id}`, { times_cooked: next });
            setDetail({ ...detail, times_cooked: next });
            mutate();
            notify({ message: `Nice — "${detail.name}" cooked ${next}×.`, actionLabel: "OK", duration: 3000 });
          }}
        />
      )}

      {importOpen && (
        <MealImportModal
          key={importKey}
          presetUrl={importPreset.current}
          editing={editing}
          onClose={() => {
            setImportOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setImportOpen(false);
            setEditing(null);
            mutate();
          }}
        />
      )}
    </section>
  );
}

function MealCard({ meal, onOpen }: { meal: MealPrep; onOpen: () => void }) {
  const total = totalMin(meal);
  const tags = (meal.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 3);
  return (
    <button onClick={onOpen} className="card overflow-hidden text-left group" aria-label={`Open ${meal.name}`}>
      <div className="relative aspect-[16/10] overflow-hidden" style={{ background: "var(--surface-raised)" }}>
        {meal.cover_image_url ? (
          // The platform's own CDN image for the post — no scraping, and it
          // falls back to the icon treatment when the CDN refuses a hotlink.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meal.cover_image_url}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ChefHat size={32} color="var(--ink-muted)" />
          </div>
        )}
        {meal.platform && (
          <span className="absolute top-2 left-2 badge" style={{ background: "rgba(0,0,0,0.65)", color: "#fff" }}>
            {PLATFORM_LABEL[meal.platform as ImportSource["platform"]] ?? meal.platform}
          </span>
        )}
        {meal.times_cooked > 0 && (
          <span className="absolute top-2 right-2 badge" style={{ background: "rgba(0,0,0,0.65)", color: "#fff" }}>
            <Flame size={11} /> {meal.times_cooked}×
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-medium truncate">{meal.name}</p>
        <p className="text-xs mt-1 flex items-center gap-2.5" style={{ color: "var(--ink-muted)" }}>
          {total !== null && (
            <span className="flex items-center gap-1">
              <Clock size={11} /> {total} min
            </span>
          )}
          {meal.protein_g !== null && <span>{meal.protein_g}g protein</span>}
          {meal.source_author && <span className="truncate">@{meal.source_author}</span>}
        </p>
        {tags.length > 0 && (
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {tags.map((t) => (
              <span key={t} className="badge">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

function MealDetailModal({
  meal,
  onClose,
  onEdit,
  onDelete,
  onCooked,
}: {
  meal: MealPrep;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCooked: () => Promise<void>;
}) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [cooking, setCooking] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const ingredients = parseLines(meal.ingredients);
  const steps = parseLines(meal.steps);
  const total = totalMin(meal);

  function toggleIngredient(i: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleCooked() {
    setCooking(true);
    try {
      await onCooked();
    } finally {
      setCooking(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={meal.name}>
      <div className="flex flex-col gap-4">
        {meal.cover_image_url && (
          <div className="rounded-xl overflow-hidden -mx-1" style={{ background: "var(--surface-raised)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={meal.cover_image_url}
              alt={meal.name}
              referrerPolicy="no-referrer"
              className="w-full aspect-[16/10] object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).closest("div")!.style.display = "none";
              }}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2 text-xs" style={{ color: "var(--ink-secondary)" }}>
          {total !== null && (
            <span className="badge flex items-center gap-1">
              <Clock size={11} /> {total} min total
            </span>
          )}
          {meal.servings !== null && (
            <span className="badge flex items-center gap-1">
              <Users size={11} /> {meal.servings} servings
            </span>
          )}
          {meal.calories !== null && <span className="badge">{meal.calories} kcal</span>}
          {meal.protein_g !== null && <span className="badge">{meal.protein_g}g protein</span>}
          {meal.times_cooked > 0 && (
            <span className="badge flex items-center gap-1">
              <Flame size={11} /> cooked {meal.times_cooked}×
            </span>
          )}
        </div>

        <button
          onClick={handleCooked}
          disabled={cooking}
          className="btn btn-primary w-full disabled:opacity-50"
        >
          {cooking ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          {cooking ? "Logging…" : "I cooked this"}
        </button>

        {ingredients.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2">
              Ingredients{" "}
              <span className="font-normal text-xs" style={{ color: "var(--ink-muted)" }}>
                — tap to check off while you cook
              </span>
            </h3>
            <ul className="flex flex-col gap-1">
              {ingredients.map((line, i) => (
                <li key={i}>
                  <button
                    onClick={() => toggleIngredient(i)}
                    className="flex items-start gap-2.5 w-full text-left px-2 py-2 rounded-lg min-h-[44px]"
                    style={{
                      background: checked.has(i) ? "color-mix(in srgb, var(--good) 10%, transparent)" : "transparent",
                    }}
                    aria-pressed={checked.has(i)}
                  >
                    <span
                      className="w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5"
                      style={{
                        borderColor: checked.has(i) ? "var(--good)" : "var(--border-strong)",
                        background: checked.has(i) ? "var(--good)" : "transparent",
                      }}
                    >
                      {checked.has(i) && <Check size={12} color="#fff" />}
                    </span>
                    <span
                      className="text-sm"
                      style={{
                        color: checked.has(i) ? "var(--ink-muted)" : "var(--ink-primary)",
                        textDecoration: checked.has(i) ? "line-through" : "none",
                      }}
                    >
                      {line}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {steps.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2">Steps</h3>
            <ol className="flex flex-col gap-2.5">
              {steps.map((line, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                    style={{ background: "var(--surface-raised)", color: "var(--ink-secondary)" }}
                  >
                    {i + 1}
                  </span>
                  <span className="pt-0.5" style={{ color: "var(--ink-secondary)" }}>
                    {line}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {meal.notes && (
          <p className="text-xs p-3 rounded-lg" style={{ background: "var(--surface-raised)", color: "var(--ink-secondary)" }}>
            {meal.notes}
          </p>
        )}

        {meal.source_url && (
          <div>
            <button
              onClick={() => setShowVideo((v) => !v)}
              className="btn btn-ghost w-full text-xs"
              aria-expanded={showVideo}
            >
              <Link2 size={13} /> {showVideo ? "Hide" : "Watch"} the original video
            </button>
            {showVideo && (
              <div className="mt-2 rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                <iframe
                  src={embedUrl(meal)}
                  title={`Original video for ${meal.name}`}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full"
                  style={{ height: 480, border: 0 }}
                />
              </div>
            )}
            <a
              href={meal.source_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs mt-2"
              style={{ color: "var(--accent)" }}
            >
              <ExternalLink size={12} /> Open on {PLATFORM_LABEL[meal.platform as ImportSource["platform"]] ?? "the web"}
            </a>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onEdit} className="btn btn-ghost flex-1">
            <Pencil size={14} /> Edit
          </button>
          <button onClick={onDelete} className="btn btn-danger flex-1" aria-label={`Delete ${meal.name}`}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>
    </Modal>
  );
}

function embedUrl(meal: MealPrep): string {
  if (!meal.source_url || !meal.platform) return "";
  // Rebuilt from the stored URL rather than stored separately — one notion
  // of the embed address, and old rows never carry a stale one.
  const id = meal.platform === "youtube" ? new URL(meal.source_url).searchParams.get("v") : null;
  if (meal.platform === "instagram") {
    const m = /\/(p|reel|reels)\/([A-Za-z0-9_-]+)/.exec(meal.source_url);
    return m ? `https://www.instagram.com/p/${m[2]}/embed` : "";
  }
  if (meal.platform === "tiktok") {
    const m = /\/video\/(\d+)/.exec(meal.source_url);
    return m ? `https://www.tiktok.com/embed/v2/${m[1]}` : "";
  }
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : "";
}

/** The add / edit sheet: link lookup, optional AI draft, then a full form. */
function MealImportModal({
  presetUrl,
  editing,
  onClose,
  onSaved,
}: {
  presetUrl: string | null;
  editing: MealPrep | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [link, setLink] = useState(presetUrl ?? "");
  const [source, setSource] = useState<ImportSource | null>(null);
  // A shared link opens mid-lookup — one less tap between the share sheet
  // and the draft.
  const [looking, setLooking] = useState(!!presetUrl);
  const [drafting, setDrafting] = useState(false);
  const [aiDraft, setAiDraft] = useState(false);
  const [shots, setShots] = useState<string[]>([]);
  const [form, setForm] = useState(() =>
    editing
      ? {
          ...emptyForm,
          name: editing.name,
          ingredientsText: parseLines(editing.ingredients).join("\n"),
          stepsText: parseLines(editing.steps).join("\n"),
          prep_min: editing.prep_min?.toString() ?? "",
          cook_min: editing.cook_min?.toString() ?? "",
          servings: editing.servings?.toString() ?? "",
          calories: editing.calories?.toString() ?? "",
          protein_g: editing.protein_g?.toString() ?? "",
          tags: editing.tags ?? "",
          notes: editing.notes ?? "",
        }
      : emptyForm
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The shared-URL lookup starts here rather than in the event handler, so
  // the effect's synchronous path touches no state — the repo forbids
  // synchronous setState in effects, and every setState below runs after an
  // await boundary.
  const startedLookup = useRef(false);
  useEffect(() => {
    if (!presetUrl || startedLookup.current) return;
    startedLookup.current = true;
    (async () => {
      try {
        applySource(await fetchSource(presetUrl));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't read that link.");
      } finally {
        setLooking(false);
      }
    })();
    // Runs once, on mount, for the shared URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchSource(url: string): Promise<ImportSource> {
    return apiPost<ImportSource>("/api/meals/import", { url });
  }

  function applySource(s: ImportSource) {
    setSource(s);
    setForm((f) => ({ ...f, name: f.name || s.title || "" }));
    importMeta.current = { url: s.url, author: s.author, thumbnailUrl: s.thumbnailUrl };
  }

  async function lookup(raw?: string) {
    const url = (raw ?? link).trim();
    if (!url) return;
    setLooking(true);
    setError(null);
    try {
      applySource(await fetchSource(url));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that link.");
    } finally {
      setLooking(false);
    }
  }

  const importMeta = useRef<{ url: string; author: string | null; thumbnailUrl: string | null } | null>(null);

  async function draftRecipe() {
    if (!source) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await apiPost<{ proposal: Proposal }>("/api/meals/extract", {
        url: source.url,
        title: source.title,
        author: source.author,
        thumbnailUrl: source.thumbnailUrl,
        screenshots: shots,
      });
      const { proposal } = res;
      setForm((f) => ({
        ...f,
        name: proposal.name || f.name,
        ingredientsText: proposal.ingredients.join("\n"),
        stepsText: proposal.steps.join("\n"),
        prep_min: proposal.prep_min?.toString() ?? f.prep_min,
        cook_min: proposal.cook_min?.toString() ?? f.cook_min,
        servings: proposal.servings?.toString() ?? f.servings,
        calories: proposal.calories?.toString() ?? f.calories,
        protein_g: proposal.protein_g?.toString() ?? f.protein_g,
        notes: [f.notes, proposal.notes ? `AI draft notes: ${proposal.notes}` : ""].filter(Boolean).join("\n"),
      }));
      setAiDraft(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't draft a recipe.");
    } finally {
      setDrafting(false);
    }
  }

  function onFiles(files: FileList | null) {
    if (!files) return;
    const picks = [...files].slice(0, 3 - shots.length);
    for (const file of picks) {
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        setShots((prev) => (prev.length < 3 ? [...prev, url] : prev));
      };
      reader.readAsDataURL(file);
    }
  }

  const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);
  const num = (t: string) => (t.trim() === "" ? null : Number(t));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Give the meal a name.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      source_url: importMeta.current?.url ?? editing?.source_url ?? null,
      source_author: importMeta.current?.author ?? editing?.source_author ?? null,
      cover_image_url: importMeta.current?.thumbnailUrl ?? editing?.cover_image_url ?? null,
      ingredients: lines(form.ingredientsText),
      steps: lines(form.stepsText),
      prep_min: num(form.prep_min),
      cook_min: num(form.cook_min),
      servings: num(form.servings),
      calories: num(form.calories),
      protein_g: num(form.protein_g),
      tags: form.tags.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (editing) await apiPatch(`/api/meals/${editing.id}`, payload);
      else await apiPost("/api/meals", payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal open onClose={onClose} title={editing ? "Edit meal" : "Add a meal"}>
      <div className="flex flex-col gap-4">
        {!editing && (
          <div className="flex flex-col gap-2">
            <label className="label">Video link</label>
            <div className="flex gap-2">
              <input
                className="input"
                inputMode="url"
                placeholder="Paste an Instagram, TikTok, or YouTube link…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    lookup();
                  }
                }}
              />
              <button onClick={() => lookup()} disabled={looking || !link.trim()} className="btn btn-ghost shrink-0 disabled:opacity-50">
                {looking ? <Loader2 size={15} className="animate-spin" /> : "Look up"}
              </button>
            </div>

            {source && (
              <div className="card-raised p-3 flex gap-3 items-center">
                {source.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={source.thumbnailUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="w-16 h-16 rounded-lg object-cover shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--surface)" }}>
                    <ChefHat size={20} color="var(--ink-muted)" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{source.title || "Video link"}</p>
                  <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                    {PLATFORM_LABEL[source.platform]}
                    {source.author ? ` · @${source.author}` : ""}
                  </p>
                  {!source.thumbnailUrl && source.platform === "instagram" && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
                      Instagram hides previews — the video still embeds in the recipe.
                    </p>
                  )}
                </div>
              </div>
            )}

            {source && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={draftRecipe}
                  disabled={drafting}
                  className="btn btn-ghost w-full disabled:opacity-50"
                >
                  {drafting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {drafting ? "Drafting recipe…" : "Draft the recipe with AI"}
                </button>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => onFiles(e.target.files)}
                    aria-label="Attach screenshots of the recipe"
                  />
                  <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-ghost flex-1 text-xs">
                    <ImagePlus size={14} /> Screenshots ({shots.length}/3)
                  </button>
                </div>
                {shots.length > 0 && (
                  <div className="flex gap-2">
                    {shots.map((s, i) => (
                      <div key={i} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s} alt={`Screenshot ${i + 1}`} className="w-16 h-16 rounded-lg object-cover" />
                        <button
                          type="button"
                          onClick={() => setShots((prev) => prev.filter((_, j) => j !== i))}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: "var(--critical)", color: "#fff" }}
                          aria-label={`Remove screenshot ${i + 1}`}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                  The AI sees the thumbnail and title — screenshots of the recipe in the video make the draft far more accurate.
                </p>
              </div>
            )}
          </div>
        )}

        {aiDraft && (
          <p className="text-xs p-2.5 rounded-lg flex items-start gap-2" style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--ink-secondary)" }}>
            <Sparkles size={13} className="shrink-0 mt-0.5" />
            AI draft — review every line before saving. Anything it guessed is flagged in the notes.
          </p>
        )}

        <form onSubmit={save} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={set("name")} placeholder="e.g. Creamy garlic chicken pasta" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Ingredients — one per line</label>
            <textarea className="input" rows={4} value={form.ingredientsText} onChange={set("ingredientsText")} placeholder={"500g chicken breast\n4 cloves garlic\n200ml cream"} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Steps — one per line</label>
            <textarea className="input" rows={4} value={form.stepsText} onChange={set("stepsText")} placeholder={"Season and sear the chicken…\nAdd garlic, cook 1 min…"} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1.5">
              <label className="label">Prep min</label>
              <input type="number" min={0} inputMode="numeric" className="input" value={form.prep_min} onChange={set("prep_min")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="label">Cook min</label>
              <input type="number" min={0} inputMode="numeric" className="input" value={form.cook_min} onChange={set("cook_min")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="label">Servings</label>
              <input type="number" min={1} inputMode="numeric" className="input" value={form.servings} onChange={set("servings")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <label className="label">Calories / serving</label>
              <input type="number" min={0} inputMode="numeric" className="input" value={form.calories} onChange={set("calories")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="label">Protein g / serving</label>
              <input type="number" min={0} inputMode="decimal" className="input" value={form.protein_g} onChange={set("protein_g")} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Tags — comma separated</label>
            <input className="input" value={form.tags} onChange={set("tags")} placeholder="high-protein, quick, bulking" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={set("notes")} placeholder="Swaps, what to watch for…" />
          </div>
          {error && (
            <p className="text-sm" style={{ color: "var(--critical)" }}>
              {error}
            </p>
          )}
          <button type="submit" disabled={saving} className="btn btn-primary mt-1 disabled:opacity-50">
            {saving ? "Saving…" : editing ? "Save changes" : "Save meal"}
          </button>
        </form>
      </div>
    </Modal>
  );
}
