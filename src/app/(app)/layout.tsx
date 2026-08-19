import { Nav } from "@/components/Nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex" style={{ background: "var(--page)" }}>
      <Nav />
      <main className="flex-1 min-w-0 px-4 py-6 md:px-8 md:py-8 pb-24 md:pb-8">
        <div className="max-w-6xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
