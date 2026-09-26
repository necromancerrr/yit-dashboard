import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { getBrandName } from "@/lib/identity";
import { ServiceWorkerManager } from "@/components/ServiceWorkerManager";
import { ThemeManager } from "@/components/ThemeManager";

const brandName = getBrandName();

// Self-hosted via next/font: no CDN dependency, works offline once cached,
// and no layout shift from a late webfont. Inter carries the UI; Space
// Grotesk carries display type (page titles, hero numbers).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});

/**
 * Runs before first paint: reads the saved theme (or the OS preference) and
 * stamps <html data-theme> so the correct palette is there from the very
 * first frame — no dark flash on a light choice. Mirrors src/lib/theme.ts;
 * keep the two in sync.
 */
const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('yit-theme')||'system';var r=t==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):t;document.documentElement.dataset.theme=r;document.documentElement.style.colorScheme=r;if(localStorage.getItem('yit-text-size')==='large'){document.documentElement.style.fontSize='125%';}}catch(e){}})();`;

export const metadata: Metadata = {
  title: brandName,
  description: "Personal progress dashboard — gym, LeetCode, interviews, school, and money.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: brandName,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f3f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <ThemeManager />
        {children}
        {/* Root layout, not the authenticated one: the worker has to be
            registered on /login too, or a first-ever visit that stops at the
            sign-in screen installs nothing and stays online-only. */}
        <ServiceWorkerManager />
      </body>
    </html>
  );
}
