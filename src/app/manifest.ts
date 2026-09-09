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
    // Puts the dashboard in the OS share sheet: screenshot -> Share -> here,
    // instead of open app -> Money -> Crypto -> Scan -> pick file.
    share_target: {
      action: "/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "image", accept: ["image/png", "image/jpeg", "image/webp"] }],
      },
    },
    // Long-press the home-screen icon. Three destinations, because the OS
    // shows only a handful and a list nobody can scan is worse than none.
    shortcuts: [
      { name: "Add money", short_name: "Money", url: "/money" },
      { name: "Inbox", short_name: "Inbox", url: "/inbox" },
      { name: "Career", short_name: "Career", url: "/career" },
    ],
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
