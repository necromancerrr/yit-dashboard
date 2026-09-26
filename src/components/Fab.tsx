"use client";

import { Plus } from "lucide-react";

/**
 * The phone's primary "add" affordance. Rendered only below the md
 * breakpoint — desktop keeps the header buttons, so this never duplicates
 * an action, it relocates it to where a thumb can reach it.
 */
export function Fab({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="fab md:hidden" aria-label={label}>
      <Plus size={24} />
    </button>
  );
}
