import type { MetadataRoute } from "next";
import { getBrandName, getDisplayName } from "@/lib/identity";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: getBrandName(),
    short_name: getDisplayName(),
    description: "Personal progress dashboard — gym, LeetCode, interviews, school, and money.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0c",
    theme_color: "#0a0a0c",
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
