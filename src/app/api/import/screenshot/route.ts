import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, jsonError, todayISO } from "@/lib/api-helpers";
import { getPrices, resolveCoinId } from "@/lib/prices";
import { getAIProvider } from "@/lib/ai";
import type { ScreenshotCrypto, ScreenshotTransactions } from "@/lib/ai/types";

// Turns a screenshot into rows you could have typed yourself.
//
// This route deliberately writes NOTHING. It returns *proposals* the UI shows
// for review, and an ordinary POST to /api/crypto or /api/finance is what
// saves. A vision model reading a screenshot is very good and not perfect;
// committing its output silently would mean discovering an error weeks later
// in a number you had started to trust.
//
// The model is reached through getAIProvider(), never a vendor SDK: provider
// choice is configuration (AI_PROVIDER), and this route used to be the one
// place in the codebase that broke that rule.

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const requestSchema = z.object({
  image: z.string().min(1), // data: URL from a file input
  kind: z.enum(["crypto", "transactions"]),
});

function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } | null {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1].toLowerCase().replace("image/jpg", "image/jpeg"), base64: match[2] };
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const provider = getAIProvider();
    if (!provider) {
      return jsonError("Screenshot import needs an AI provider — set AI_PROVIDER and its API key.", 503);
    }
    // Distinguishing "no provider" from "provider can't see" matters: the two
    // have completely different fixes, and a generic failure would send you
    // hunting for a bad screenshot when the model simply has no eyes.
    if (!provider.supportsVision) {
      return jsonError(
        `The configured AI provider (${provider.name}) can't read images. Set AI_PROVIDER=anthropic, or name a vision-capable model in DEEPSEEK_VISION_MODEL.`,
        503
      );
    }

    const body = requestSchema.parse(await req.json());
    const parsed = parseDataUrl(body.image);
    if (!parsed) return jsonError("That file isn't a PNG, JPEG, WebP, or GIF image.", 415);

    // base64 inflates by ~4/3; check the decoded size against the model's limit.
    if ((parsed.base64.length * 3) / 4 > MAX_IMAGE_BYTES) {
      return jsonError("That image is larger than 5MB — try a smaller screenshot.", 413);
    }

    const extraction = await provider.extractFromScreenshot(parsed, body.kind, todayISO());
    if (!extraction) return jsonError("Couldn't read that screenshot — try a clearer image.", 422);

    if (body.kind === "transactions") {
      const { transactions, notes } = extraction as ScreenshotTransactions;
      return NextResponse.json({ kind: "transactions", proposals: transactions, notes });
    }

    // The screenshot usually shows dollar values, but a holding is only
    // meaningful as a quantity — a stored value can't track the market. So
    // where only a value is visible, convert it via the live price now.
    const { holdings, notes } = extraction as ScreenshotCrypto;

    const resolved = await Promise.all(
      holdings.map(async (h) => ({ ...h, coin_id: await resolveCoinId(h.symbol, h.name) }))
    );
    const prices = await getPrices(resolved.map((h) => h.coin_id ?? "").filter(Boolean));

    const proposals = resolved.map((h) => {
      const price = h.coin_id ? prices.get(h.coin_id)?.usd ?? null : null;
      const quantity = h.quantity ?? (h.value_usd !== null && price ? h.value_usd / price : null);
      return {
        symbol: h.symbol.toUpperCase(),
        name: h.name,
        coin_id: h.coin_id,
        quantity,
        staked_pct: h.staked_pct,
        price_usd: price,
        value_usd: h.value_usd ?? (quantity !== null && price ? quantity * price : null),
        // Surfaced so the UI can warn instead of proposing a row you can't verify.
        needs_attention: quantity === null,
      };
    });

    return NextResponse.json({ kind: "crypto", proposals, notes });
  });
}
