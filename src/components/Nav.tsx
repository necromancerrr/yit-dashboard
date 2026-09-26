"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Search,
  Sun,
  Inbox,
  Briefcase,
  GraduationCap,
  HeartPulse,
  Wallet,
  Sprout,
  CheckSquare,
  Fingerprint,
  SlidersHorizontal,
  LogOut,
  Download,
  MoreHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { getBrandName } from "@/lib/identity";

/**
 * Everything must be reachable from a phone.
 *
 * The bottom bar used to show five of eleven destinations, and the other six
 * — Health, Growth, Checklist, Search, Security, Setup — plus Export and Sign
 * out had no route on a small screen at all. You could only get to them by
 * typing a URL, which is not a navigation design, it is an omission.
 *
 * So: four tabs for the places you open daily, and one "More" that opens a
 * sheet containing *everything else, without exception*. The rule is that
 * every destination appears in exactly one of the two, and the test in
 * `tests/palette.test.ts` plus `tests/nav.test.ts` keep it that way.
 *
 * On desktop the sidebar is grouped rather than an eleven-item list — three
 * short lists are read at a glance where one long one is scanned — and it
 * scrolls, so a short window clips nothing.
 */

type NavGroup = "day" | "life" | "system";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Today", icon: Sun, group: "day" },
  { href: "/inbox", label: "Inbox", icon: Inbox, group: "day" },
  { href: "/career", label: "Career", icon: Briefcase, group: "life" },
  { href: "/school", label: "School", icon: GraduationCap, group: "life" },
  { href: "/health", label: "Health", icon: HeartPulse, group: "life" },
  { href: "/money", label: "Money", icon: Wallet, group: "life" },
  { href: "/growth", label: "Growth", icon: Sprout, group: "life" },
  { href: "/checklist", label: "Checklist", icon: CheckSquare, group: "life" },
  { href: "/search", label: "Search", icon: Search, group: "system" },
  { href: "/security", label: "Security", icon: Fingerprint, group: "system" },
  { href: "/setup", label: "Setup", icon: SlidersHorizontal, group: "system" },
];

const GROUPS: { id: NavGroup; label: string }[] = [
  { id: "day", label: "Each day" },
  { id: "life", label: "Your life" },
  { id: "system", label: "System" },
];

// The four the day actually starts at. Everything else lives behind More —
// which is a real destination list, not an overflow bin.
const MOBILE_NAV_HREFS = new Set(["/", "/inbox", "/career", "/money"]);

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  /**
   * The sheet stores *which page* it was opened on, not a boolean.
   *
   * Navigating has to close it — left open, it sits over the page you just
   * asked for and reads as a tap that did nothing — and deriving that from the
   * pathname during render is the repo's rule: closing it from an effect is a
   * `setState` in an effect body, which the React Compiler lint rejects
   * outright.
   */
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const moreOpen = openedOn === pathname;
  const setMoreOpen = (open: boolean) => setOpenedOn(open ? pathname : null);

  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenedOn(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    // Signing out has to take the offline copies with it. The service worker's
    // caches hold real transactions, deadlines and applications; dropping the
    // session cookie while leaving those on disk would leave your data readable
    // to the next person with the phone.
    if ("caches" in window) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        /* a browser that refuses cache access has none to clear */
      }
    }
    router.push("/login");
  }

  const overflowItems = NAV_ITEMS.filter((item) => !MOBILE_NAV_HREFS.has(item.href));

  return (
    <>
      <aside
        className="hidden md:flex md:w-60 shrink-0 flex-col px-3 py-6"
        style={{
          borderRight: "1px solid var(--border)",
          background: "color-mix(in srgb, var(--surface) 60%, transparent)",
        }}
      >
        <div className="flex items-center gap-3 px-2 mb-8">
          <Logo size="md" />
          <div className="min-w-0">
            <p className="font-display font-semibold text-[15px] leading-tight tracking-tight">
              {getBrandName()}
            </p>
            <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
              Personal OS
            </p>
          </div>
        </div>

        {/* Scrolls rather than clips: the list grows every time a section is
            added, and a laptop in a short window would silently lose the end. */}
        <nav className="flex flex-col gap-5 flex-1 overflow-y-auto" aria-label="Primary">
          {GROUPS.map((group) => (
            <div key={group.id}>
              <p className="label px-3 mb-1.5">{group.label}</p>
              <div className="flex flex-col gap-0.5">
                {NAV_ITEMS.filter((item) => item.group === group.id).map((item) => {
                  const active = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all"
                      style={{
                        background: active
                          ? "color-mix(in srgb, var(--accent) 13%, transparent)"
                          : "transparent",
                        color: active ? "var(--ink-primary)" : "var(--ink-secondary)",
                        fontWeight: active ? 600 : 500,
                      }}
                    >
                      <Icon
                        size={17}
                        color={active ? "var(--accent)" : "var(--ink-muted)"}
                        strokeWidth={active ? 2.25 : 2}
                      />
                      <span className="flex-1">{item.label}</span>
                      {/* A shortcut nobody knows about is a shortcut nobody
                          uses, and the palette's whole point is reaching it
                          without coming here first. */}
                      {item.href === "/search" && (
                        <kbd
                          className="text-[10px] px-1.5 py-0.5 rounded-md border"
                          style={{ borderColor: "var(--border)", color: "var(--ink-muted)" }}
                        >
                          ⌘K
                        </kbd>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="pt-3 mt-3 border-t flex flex-col gap-0.5" style={{ borderColor: "var(--border)" }}>
          <a
            href="/api/export"
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors"
            style={{ color: "var(--ink-muted)" }}
            title="Download all your data as JSON"
          >
            <Download size={16} />
            Export data
          </a>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors text-left"
            style={{ color: "var(--ink-muted)" }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile: a floating tab bar, detached from the screen edge. A
          full-bleed bar reads as browser chrome; a floating pill reads as
          product. */}
      <nav
        aria-label="Primary (mobile)"
        className="md:hidden fixed bottom-0 left-0 right-0 z-20 flex justify-center px-4 pointer-events-none"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div
          className="pointer-events-auto flex items-center justify-around gap-1 rounded-2xl border px-2 py-1.5 backdrop-blur-xl"
          style={{
            borderColor: "var(--border-strong)",
            background: "color-mix(in srgb, var(--surface) 82%, transparent)",
            boxShadow: "var(--shadow-pop)",
            width: "100%",
            maxWidth: "26rem",
          }}
        >
          {NAV_ITEMS.filter((item) => MOBILE_NAV_HREFS.has(item.href)).map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl min-w-[52px] transition-colors"
                style={{
                  background: active
                    ? "color-mix(in srgb, var(--accent) 13%, transparent)"
                    : "transparent",
                }}
              >
                <Icon
                  size={19}
                  color={active ? "var(--accent)" : "var(--ink-muted)"}
                  strokeWidth={active ? 2.25 : 2}
                />
                <span
                  className="text-[10px]"
                  style={{
                    color: active ? "var(--ink-primary)" : "var(--ink-muted)",
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}

          <button
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl min-w-[52px] transition-colors"
            style={{
              background: overflowItems.some((i) => i.href === pathname)
                ? "color-mix(in srgb, var(--accent) 13%, transparent)"
                : "transparent",
            }}
          >
            <MoreHorizontal
              size={19}
              color={
                overflowItems.some((i) => i.href === pathname)
                  ? "var(--accent)"
                  : "var(--ink-muted)"
              }
            />
            <span
              className="text-[10px]"
              style={{
                color: overflowItems.some((i) => i.href === pathname)
                  ? "var(--ink-primary)"
                  : "var(--ink-muted)",
              }}
            >
              More
            </span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-30 flex items-end">
          <div
            className="absolute inset-0 animate-fade-in"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }}
            onClick={() => setMoreOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="More destinations"
            className="relative w-full card-raised rounded-b-none max-h-[80vh] overflow-y-auto animate-fade-in"
          >
            <div
              className="sticky top-0 flex items-center justify-between px-4 py-3 border-b"
              style={{ borderColor: "var(--border)", background: "var(--surface-raised)" }}
            >
              <h2 className="text-sm font-semibold">Everything else</h2>
              <button
                onClick={() => setMoreOpen(false)}
                className="icon-btn"
                aria-label="Close menu"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-2 pb-6">
              {GROUPS.map((group) => {
                const items = overflowItems.filter((item) => item.group === group.id);
                if (items.length === 0) return null;
                return (
                  <div key={group.id} className="mb-2">
                    <p className="label px-3 py-1.5">{group.label}</p>
                    {items.map((item) => {
                      const active = pathname === item.href;
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                          style={{
                            background: active ? "var(--surface)" : "transparent",
                            color: active ? "var(--ink-primary)" : "var(--ink-secondary)",
                            fontWeight: active ? 600 : 500,
                          }}
                        >
                          <Icon size={17} color={active ? "var(--accent)" : "var(--ink-muted)"} />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}

              {/* Export and Sign out were desktop-only, which meant a phone
                  could neither back up its data nor sign out. */}
              <div className="mt-1 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                <a
                  href="/api/export"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                  style={{ color: "var(--ink-muted)" }}
                >
                  <Download size={17} />
                  Export data
                </a>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left"
                  style={{ color: "var(--ink-muted)" }}
                >
                  <LogOut size={17} />
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
