import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, jsonError } from "@/lib/api-helpers";
import { detectMealSource, embedUrlFor, type MealPlatform } from "@/lib/meal-source";

// Turns a pasted video link into a draft — and deliberately writes NOTHING.
// Public oEmbed (TikTok, YouTube) supplies the title/author/thumbnail without
// auth; Instagram retired public oEmbed, so there the client renders the
// platform's own embed iframe from the shortcode. An ordinary POST to
// /api/meals is what saves, after the user has reviewed the draft.

const requestSchema = z.object({
  url: z.string().min(1).max(2000),
});

interface OEmbed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

async function fetchOEmbed(endpoint: string): Promise<OEmbed | null> {
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const json = (await res.json()) as OEmbed;
    return json && typeof json === "object" ? json : null;
  } catch {
    return null;
  }
}

/** Short links (vm.tiktok.com, …) only resolve over the network. */
async function resolveShortLink(raw: string): Promise<string> {
  try {
    const res = await fetch(raw, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    return res.url || raw;
  } catch {
    return raw;
  }
}

const OEMBED_ENDPOINT: Partial<Record<MealPlatform, (url: string) => string>> = {
  tiktok: (url) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
  youtube: (url) => `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
};

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const { url: raw } = requestSchema.parse(await req.json());

    let source = detectMealSource(raw);
    if (!source) {
      // One retry after following redirects, for share-sheet short links.
      const resolved = await resolveShortLink(raw.trim());
      source = detectMealSource(resolved);
    }
    if (!source) {
      return jsonError(
        "That doesn't look like an Instagram, TikTok, or YouTube video link.",
        422
      );
    }

    const endpoint = OEMBED_ENDPOINT[source.platform]?.(source.url);
    const meta = endpoint ? await fetchOEmbed(endpoint) : null;

    return NextResponse.json({
      platform: source.platform,
      url: source.url,
      nativeId: source.nativeId,
      title: meta?.title ?? null,
      author: meta?.author_name ?? null,
      thumbnailUrl: meta?.thumbnail_url ?? null,
      embedUrl: embedUrlFor(source),
    });
  });
}
