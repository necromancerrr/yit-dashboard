import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, jsonError } from "@/lib/api-helpers";
import { getVisionProvider } from "@/lib/ai";
import { detectMealSource } from "@/lib/meal-source";
import type { ScreenshotImage } from "@/lib/ai/types";

// Drafts a recipe from a video link. Writes NOTHING — the UI shows the
// proposal for review, and an ordinary POST to /api/meals is what saves.
// A vision model reads the thumbnail (and any screenshots the user
// attaches); it cannot watch the video, so the proposal is a draft by
// construction and the UI must label it as one.

const MAX_SCREENSHOTS = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const requestSchema = z.object({
  url: z.string().min(1).max(2000),
  title: z.string().max(500).nullable().optional(),
  author: z.string().max(200).nullable().optional(),
  thumbnailUrl: z.string().url().max(2000).nullable().optional(),
  screenshots: z.array(z.string().max(8 * 1024 * 1024)).max(MAX_SCREENSHOTS).optional(),
});

function parseDataUrl(dataUrl: string): ScreenshotImage | null {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  if ((match[2].length * 3) / 4 > MAX_IMAGE_BYTES) return null;
  return { mediaType: match[1].toLowerCase().replace("image/jpg", "image/jpeg"), base64: match[2] };
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    // Vision falls back to a provider that has eyes. Null means nothing
    // available can see — a different problem from a draft that failed, and
    // one with a different fix.
    const provider = getVisionProvider();
    if (!provider) {
      return jsonError(
        "No AI provider available that can read images. Set ANTHROPIC_API_KEY, or name a vision-capable model in DEEPSEEK_VISION_MODEL.",
        503
      );
    }

    const body = requestSchema.parse(await req.json());
    const source = detectMealSource(body.url);
    if (!source) return jsonError("That doesn't look like an Instagram, TikTok, or YouTube video link.", 422);

    const screenshots: ScreenshotImage[] = [];
    for (const shot of body.screenshots ?? []) {
      const parsed = parseDataUrl(shot);
      if (!parsed) return jsonError("One of the screenshots isn't a PNG, JPEG, WebP, or GIF image.", 415);
      screenshots.push(parsed);
    }

    const proposal = await provider.extractRecipe({
      title: body.title ?? null,
      author: body.author ?? null,
      pageUrl: source.url,
      platform: source.platform,
      thumbnailUrl: body.thumbnailUrl ?? null,
      screenshots,
    });
    if (!proposal) {
      return jsonError(
        "Couldn't draft a recipe from that link — try attaching a screenshot of the recipe from the video.",
        422
      );
    }

    return NextResponse.json({ proposal });
  });
}
