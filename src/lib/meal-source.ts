/**
 * Pure, client-safe helpers for recipe video links (Instagram / TikTok / YouTube).
 *
 * The dashboard never scrapes these platforms — both block scrapers and the
 * markup changes constantly. Instead we:
 *  - parse the link into a platform + native id (this module, fully testable),
 *  - fetch public oEmbed metadata where it exists without auth
 *    (TikTok and YouTube; Instagram retired public oEmbed in 2020),
 *  - render the post through the platform's own embed iframe on the client.
 *
 * No database, no clock, no fetch here — the import route does the network.
 */

export type MealPlatform = "instagram" | "tiktok" | "youtube";

export interface MealSource {
  platform: MealPlatform;
  /** Canonical https URL of the post. */
  url: string;
  /** Platform-native id: IG shortcode, TikTok video id, YouTube video id. */
  nativeId: string;
}

const HOST_PATTERNS: { platform: MealPlatform; hosts: RegExp }[] = [
  { platform: "instagram", hosts: /^(www\.)?instagram\.com$/i },
  { platform: "tiktok", hosts: /^(www\.)?tiktok\.com$/i },
  { platform: "youtube", hosts: /^(www\.)?(youtube\.com|youtu\.be)$/i },
];

function normalizeUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

function instagramId(path: string): string | null {
  // /p/{shortcode}, /reel/{shortcode}, /reels/{shortcode} — trailing slash optional
  const m = /^\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  return m ? m[1] : null;
}

function tiktokId(path: string): string | null {
  // /@user/video/{id} — the numeric id is the stable part
  const m = /^\/@[^/]+\/video\/(\d+)\/?$/.exec(path);
  return m ? m[1] : null;
}

function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host.endsWith("youtu.be")) {
    const m = /^\/([A-Za-z0-9_-]{6,})\/?$/.exec(url.pathname);
    return m ? m[1] : null;
  }
  // youtube.com/watch?v=… or /shorts/…
  const v = url.searchParams.get("v");
  if (url.pathname === "/watch" && v && /^[A-Za-z0-9_-]{6,}$/.test(v)) return v;
  const short = /^\/shorts\/([A-Za-z0-9_-]{6,})\/?$/.exec(url.pathname);
  if (short) return short[1];
  return null;
}

/**
 * Parse a pasted link into a platform + native id, or null when it is not a
 * recognizable recipe-video URL. Short links (vm.tiktok.com, …) cannot be
 * resolved without a network request, so they are null here — the import
 * route follows the redirect and re-runs this on the landing URL.
 */
export function detectMealSource(raw: string): MealSource | null {
  const url = normalizeUrl(raw);
  if (!url || url.protocol !== "https:") return null;

  const entry = HOST_PATTERNS.find((p) => p.hosts.test(url.hostname));
  if (!entry) return null;

  let nativeId: string | null = null;
  let canonical: string;
  switch (entry.platform) {
    case "instagram":
      nativeId = instagramId(url.pathname);
      canonical = nativeId ? `https://www.instagram.com/p/${nativeId}/` : "";
      break;
    case "tiktok":
      nativeId = tiktokId(url.pathname);
      canonical = nativeId ? `https://www.tiktok.com/${url.pathname.replace(/^\/+/, "")}` : "";
      break;
    case "youtube":
      nativeId = youtubeId(url);
      canonical = nativeId ? `https://www.youtube.com/watch?v=${nativeId}` : "";
      break;
  }
  if (!nativeId) return null;
  return { platform: entry.platform, url: canonical, nativeId };
}

/** Instagram's public post embed — works for public posts, no auth. */
export function instagramEmbedUrl(shortcode: string): string {
  return `https://www.instagram.com/p/${shortcode}/embed`;
}

/** TikTok's public video embed. */
export function tiktokEmbedUrl(videoId: string): string {
  return `https://www.tiktok.com/embed/v2/${videoId}`;
}

/** YouTube's nocookie embed. */
export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

export function embedUrlFor(source: MealSource): string {
  switch (source.platform) {
    case "instagram":
      return instagramEmbedUrl(source.nativeId);
    case "tiktok":
      return tiktokEmbedUrl(source.nativeId);
    case "youtube":
      return youtubeEmbedUrl(source.nativeId);
  }
}
