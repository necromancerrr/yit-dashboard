/**
 * Theme + text size preferences. A tiny external store (localStorage backed)
 * so components read it with useSyncExternalStore, and a pre-paint inline
 * script in the root layout applies it before first paint — no flash.
 *
 * Choice "system" follows the OS; the resolved value written to
 * <html data-theme> is always "dark" | "light".
 */

export type ThemeChoice = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";
export type TextSize = "normal" | "large";

const THEME_KEY = "yit-theme";
const TEXT_SIZE_KEY = "yit-text-size";

type Listener = () => void;
const listeners = new Set<Listener>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode etc. — the choice just won't persist.
  }
  listeners.forEach((l) => l());
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getThemeChoice(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  const v = read(THEME_KEY);
  return v === "dark" || v === "light" ? v : "system";
}

export function getResolvedTheme(): ResolvedTheme {
  const choice = getThemeChoice();
  if (choice !== "system") return choice;
  if (typeof window === "undefined") return "dark";
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function setThemeChoice(choice: ThemeChoice): void {
  write(THEME_KEY, choice);
  applyTheme();
}

export function getTextSize(): TextSize {
  if (typeof window === "undefined") return "normal";
  return read(TEXT_SIZE_KEY) === "large" ? "large" : "normal";
}

export function setTextSize(size: TextSize): void {
  write(TEXT_SIZE_KEY, size);
  applyTheme();
}

/** Writes the current choice onto <html>. Idempotent — safe to call often. */
export function applyTheme(): void {
  if (typeof document === "undefined") return;
  const resolved = getResolvedTheme();
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  // The CSS base is 112.5% (18px); "large" steps up to 125% (20px).
  // Clearing the inline style falls back to the stylesheet default.
  document.documentElement.style.fontSize = getTextSize() === "large" ? "125%" : "";
}
