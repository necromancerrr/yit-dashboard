"use client";

import { usePathname } from "next/navigation";

/**
 * Wraps page content so it rises-and-fades on every navigation. Keying by
 * pathname remounts the wrapper per route — without the key, the App Router
 * keeps the layout mounted and the entrance would only ever play once.
 */
export function PageEnter({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-page-enter">
      {children}
    </div>
  );
}
