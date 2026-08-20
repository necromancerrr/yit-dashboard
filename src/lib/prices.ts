// Live crypto prices, from CoinGecko's public API (no key needed on the free
// tier, but it is rate limited — hence the cache below).
//
// Prices are never written to the database. A stored price is a lie the moment
// the market moves, so worth is always computed at read time as
// quantity x live price. The database stores only what you actually own.

const API = "https://api.coingecko.com/api/v3";

// Rate limits on the free tier are strict (roughly 5-15 calls/minute), and the
// overview polls every 60s, so responses are cached in the module scope. On
// serverless this is per-instance and simply gets a lower hit rate — correct
// either way, never stale beyond the TTL.
const PRICE_TTL_MS = 60_000;
const COIN_LIST_TTL_MS = 24 * 60 * 60 * 1000;

export interface Price {
  usd: number;
  change24h: number | null;
}

declare global {
  var __priceCache: { at: number; data: Map<string, Price> } | undefined;
  var __coinList: { at: number; data: { id: string; symbol: string; name: string }[] } | undefined;
}

/**
 * Symbols are ambiguous — several coins answer to "AWE" — so the price API is
 * keyed by its own ids. This resolves a symbol/name to an id once so it can be
 * stored against the holding and never guessed again.
 */
export async function resolveCoinId(symbol: string, name: string): Promise<string | null> {
  const now = Date.now();
  if (!global.__coinList || now - global.__coinList.at > COIN_LIST_TTL_MS) {
    const res = await fetch(`${API}/coins/list`, { next: { revalidate: 86_400 } });
    if (!res.ok) return null;
    global.__coinList = { at: now, data: await res.json() };
  }

  const list = global.__coinList.data;
  const wantedSymbol = symbol.trim().toLowerCase();
  const wantedName = name.trim().toLowerCase();

  // An exact name match is the strongest signal ("Ethereum" -> ethereum);
  // fall back to symbol, which is where the ambiguity lives.
  return (
    list.find((c) => c.name.toLowerCase() === wantedName)?.id ??
    list.find((c) => c.id === wantedSymbol)?.id ??
    list.find((c) => c.symbol.toLowerCase() === wantedSymbol)?.id ??
    null
  );
}

/** Look up USD prices for a set of coin ids. Unknown ids are simply absent. */
export async function getPrices(coinIds: string[]): Promise<Map<string, Price>> {
  const ids = [...new Set(coinIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const now = Date.now();
  const cache = global.__priceCache;
  if (cache && now - cache.at < PRICE_TTL_MS && ids.every((id) => cache.data.has(id))) {
    return cache.data;
  }

  const url = `${API}/simple/price?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    // A rate limit or outage must not take the page down — the UI renders
    // "price unavailable" rather than a wrong number or an error screen.
    console.warn(`Price lookup failed: ${res.status} ${res.statusText}`);
    return cache?.data ?? new Map();
  }

  const body: Record<string, { usd?: number; usd_24h_change?: number }> = await res.json();
  const prices = new Map<string, Price>();
  for (const [id, row] of Object.entries(body)) {
    if (typeof row.usd === "number") {
      prices.set(id, { usd: row.usd, change24h: row.usd_24h_change ?? null });
    }
  }

  global.__priceCache = { at: now, data: prices };
  return prices;
}
