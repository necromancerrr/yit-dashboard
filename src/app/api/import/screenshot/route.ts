import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { handleRoute, jsonError, todayISO } from "@/lib/api-helpers";
import { getPrices, resolveCoinId } from "@/lib/prices";

// Turns a screenshot into rows you could have typed yourself.
//
// This route deliberately does NOT write anything. It returns *proposals* that
// the UI shows for review, and a second, ordinary POST to /api/crypto or
// /api/finance is what actually saves. A vision model reading a screenshot is
// very good and not perfect; silently committing its output would mean
// discovering an error weeks later in a number you now trust.

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude's per-image limit.

const requestSchema = z.object({
  // data: URL from a file input, e.g. "data:image/png;base64,iVBOR..."
  image: z.string().min(1),
  kind: z.enum(["crypto", "transactions"]),
});

const CryptoRow = z.object({
  symbol: z.string().describe("Ticker symbol, e.g. ETH, SOL, XRP"),
  name: z.string().describe("Full asset name as shown, e.g. Ethereum"),
  quantity: z
    .number()
    .nullable()
    .describe("Units held, if the screenshot states a coin amount. Null if only a dollar value is shown."),
  value_usd: z
    .number()
    .nullable()
    .describe("Total USD value of the holding, if shown. Null if only a coin quantity is shown."),
  staked_pct: z.number().nullable().describe("Percent staked if stated, else null"),
});

const TransactionRow = z.object({
  date: z.string().describe("Date as YYYY-MM-DD. Use today's date if none is visible."),
  type: z.enum(["income", "expense"]),
  category: z.string().describe("Short category, e.g. Groceries, Salary, Transport"),
  amount: z.number().describe("Positive amount in USD"),
  note: z.string().nullable(),
});

const CryptoExtraction = z.object({
  holdings: z.array(CryptoRow),
  notes: z.string().nullable().describe("Anything ambiguous or unreadable worth flagging"),
});

const TransactionExtraction = z.object({
  transactions: z.array(TransactionRow),
  notes: z.string().nullable().describe("Anything ambiguous or unreadable worth flagging"),
});

const SYSTEM = `You read screenshots of financial apps and turn them into structured data.

Rules:
- Transcribe only what is visibly present. Never invent, complete, or estimate a value that is not shown.
- Ignore aggregate rows: portfolio totals, "today" summaries, and headline balances are not holdings.
- Percentages next to an amount are usually a 24h change, not a quantity. Do not confuse them.
- If a number is cut off, obscured, or you are unsure, omit that row and say so in notes.
- It is far better to return fewer rows than to return a wrong number.`;

function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } | null {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1].toLowerCase().replace("image/jpg", "image/jpeg"), base64: match[2] };
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return jsonError(
        "Screenshot import needs an ANTHROPIC_API_KEY environment variable.",
        503
      );
    }

    const body = requestSchema.parse(await req.json());
    const parsed = parseDataUrl(body.image);
    if (!parsed) return jsonError("That file isn't a PNG, JPEG, WebP, or GIF image.", 415);

    // base64 inflates by ~4/3; check the decoded size against Claude's limit.
    if ((parsed.base64.length * 3) / 4 > MAX_IMAGE_BYTES) {
      return jsonError("That image is larger than 5MB — try a smaller screenshot.", 413);
    }

    const client = new Anthropic();
    const isCrypto = body.kind === "crypto";

    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 8000,
      system: SYSTEM,
      output_config: {
        format: zodOutputFormat(isCrypto ? CryptoExtraction : TransactionExtraction),
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: parsed.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
                data: parsed.base64,
              },
            },
            {
              type: "text",
              text: isCrypto
                ? "Extract every individual crypto holding from this screenshot. Today's date is " +
                  todayISO() +
                  "."
                : "Extract every individual transaction from this screenshot. Today's date is " +
                  todayISO() +
                  ". Use it for any row with no visible date.",
            },
          ],
        },
      ],
    });

    const extraction = response.parsed_output;
    if (!extraction) return jsonError("Couldn't read that screenshot — try a clearer image.", 422);

    if (!isCrypto) {
      const { transactions, notes } = extraction as z.infer<typeof TransactionExtraction>;
      return NextResponse.json({ kind: "transactions", proposals: transactions, notes });
    }

    // The screenshot usually shows dollar values, but a holding is only
    // meaningful as a quantity — a stored value can't track the market. So
    // where only a value is visible, convert it via the live price now.
    const { holdings, notes } = extraction as z.infer<typeof CryptoExtraction>;

    const resolved = await Promise.all(
      holdings.map(async (h) => ({ ...h, coin_id: await resolveCoinId(h.symbol, h.name) }))
    );
    const prices = await getPrices(resolved.map((h) => h.coin_id ?? "").filter(Boolean));

    const proposals = resolved.map((h) => {
      const price = h.coin_id ? prices.get(h.coin_id)?.usd ?? null : null;
      const quantity =
        h.quantity ?? (h.value_usd !== null && price ? h.value_usd / price : null);
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
