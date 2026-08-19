"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Dumbbell,
  Code2,
  Briefcase,
  GraduationCap,
  Wallet,
  CheckSquare,
  LogOut,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/gym", label: "Gym", icon: Dumbbell },
  { href: "/leetcode", label: "LeetCode", icon: Code2 },
  { href: "/interviews", label: "Interviews", icon: Briefcase },
  { href: "/school", label: "School", icon: GraduationCap },
  { href: "/finance", label: "Money", icon: Wallet },
  { href: "/checklist", label: "Checklist", icon: CheckSquare },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-56 shrink-0 flex-col border-r px-3 py-5" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2 px-2 mb-8">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "var(--accent-soft)" }}
          >
            <LayoutDashboard size={16} color="var(--accent)" />
          </div>
          <span className="font-semibold text-sm">Yit&apos;s Dashboard</span>
        </div>

        <nav className="flex flex-col gap-0.5 flex-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors"
                style={{
                  background: active ? "var(--surface-raised)" : "transparent",
                  color: active ? "var(--ink-primary)" : "var(--ink-secondary)",
                  fontWeight: active ? 600 : 500,
                }}
              >
                <Icon size={16} color={active ? "var(--accent)" : "var(--ink-muted)"} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors"
          style={{ color: "var(--ink-muted)" }}
        >
          <LogOut size={16} />
          Sign out
        </button>
      </aside>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-20 flex items-center justify-around border-t px-1 py-1.5 backdrop-blur"
        style={{ borderColor: "var(--border)", background: "rgba(13,13,13,0.85)" }}
      >
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg min-w-[52px]"
            >
              <Icon size={18} color={active ? "var(--accent)" : "var(--ink-muted)"} />
              <span
                className="text-[10px]"
                style={{ color: active ? "var(--ink-primary)" : "var(--ink-muted)" }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
