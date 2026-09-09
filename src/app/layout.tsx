import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getBrandName } from "@/lib/identity";
import { ServiceWorkerManager } from "@/components/ServiceWorkerManager";

const brandName = getBrandName();

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
  themeColor: "#0a0a0c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Root layout, not the authenticated one: the worker has to be
            registered on /login too, or a first-ever visit that stops at the
            sign-in screen installs nothing and stays online-only. */}
        <ServiceWorkerManager />
      </body>
    </html>
  );
}
