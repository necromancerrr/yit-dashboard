import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { getPrices, resolveCoinId } from "@/lib/prices";
import type { CryptoHolding, CryptoHoldingWithPrice } from "@/lib/types";

const createSchema = z.object({
  symbol: z.string().min(1, "Symbol is required").max(20),
  name: z.string().min(1, "Name is required").max(80),
  coin_id: z.string().max(80).nullable().optional(),
  quantity: z.coerce.number().nonnegative("Quantity cannot be negative"),
  staked_pct: z.coerce.number().int().min(0).max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function GET() {
  return handleRoute(async () => {
    return withDb(async () => {
      const result = await db.execute("SELECT * FROM crypto_holdings ORDER BY id DESC");
      const holdings = result.rows as unknown as CryptoHolding[];

      // Backfill any missing coin ids once, so later reads are a single lookup.
      for (const h of holdings) {
        if (h.coin_id) continue;
        const resolved = await resolveCoinId(h.symbol, h.name);
        if (resolved) {
          h.coin_id = resolved;
          await db.execute({
            sql: "UPDATE crypto_holdings SET coin_id = ? WHERE id = ?",
            args: [resolved, h.id],
          });
        }
      }

      const prices = await getPrices(holdings.map((h) => h.coin_id ?? "").filter(Boolean));

      const items: CryptoHoldingWithPrice[] = holdings.map((h) => {
        const price = h.coin_id ? prices.get(h.coin_id) : undefined;
        return {
          ...h,
          price_usd: price?.usd ?? null,
          // null, not 0 — "we don't know" and "it's worthless" are different
          // things, and the UI says so rather than quietly showing $0.
          value_usd: price ? price.usd * h.quantity : null,
          change_24h_pct: price?.change24h ?? null,
        };
      });

      const totalValue = items.reduce((sum, i) => sum + (i.value_usd ?? 0), 0);
      const pricedCount = items.filter((i) => i.value_usd !== null).length;

      return NextResponse.json({
        items,
        totalValue,
        // So the UI can say "total excludes 2 holdings we couldn't price".
        unpricedCount: items.length - pricedCount,
      });
    });
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const body = createSchema.parse(await req.json());
    return withDb(async () => {
      const coinId = body.coin_id ?? (await resolveCoinId(body.symbol, body.name));
      const result = await db.execute({
        sql: `INSERT INTO crypto_holdings (symbol, name, coin_id, quantity, staked_pct, notes)
              VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
        args: [
          body.symbol.toUpperCase(),
          body.name,
          coinId,
          body.quantity,
          body.staked_pct ?? null,
          body.notes ?? null,
        ],
      });
      return NextResponse.json({ item: result.rows[0] }, { status: 201 });
    });
  });
}
