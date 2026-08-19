import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getBrandName } from "@/lib/identity";

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
      <body>{children}</body>
    </html>
  );
}
