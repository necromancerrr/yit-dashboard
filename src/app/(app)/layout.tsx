import { Nav } from "@/components/Nav";
import { ToastProvider } from "@/components/ToastProvider";
import { LockGuard } from "@/components/LockGuard";
import { OfflineBanner } from "@/components/OfflineBanner";
import { CommandPalette } from "@/components/CommandPalette";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      {/* Wraps the whole authenticated shell, including the nav — a lock that
          left the sidebar readable would not be much of a lock. */}
      <LockGuard>
        <div className="min-h-screen flex" style={{ background: "var(--page)" }}>
          <Nav />
          <main className="flex-1 min-w-0 px-4 py-6 md:px-8 md:py-8 pb-24 md:pb-8">
            <div className="max-w-6xl mx-auto">
              {/* Above every section, so no page can render a cached number
                  without the "this is a saved copy, from ..." label next to it. */}
              <OfflineBanner />
              {children}
            </div>
          </main>
          {/* Outside <main> because it is not page content, and inside
              LockGuard because it reads the lock before it opens. */}
          <CommandPalette />
        </div>
      </LockGuard>
    </ToastProvider>
  );
}
