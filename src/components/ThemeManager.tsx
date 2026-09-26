"use client";

import { useEffect } from "react";
import { applyTheme, getThemeChoice } from "@/lib/theme";

/**
 * Mounted once in the root layout. Applies the saved theme on the client and
 * re-applies when the OS color scheme changes while the choice is "system".
 * (The pre-paint inline script in the layout handles the very first paint.)
 */
export function ThemeManager() {
  useEffect(() => {
    applyTheme();
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (getThemeChoice() === "system") applyTheme();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return null;
}
