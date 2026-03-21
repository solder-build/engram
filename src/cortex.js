/**
 * Engram — Cortex Client (Market Intelligence)
 *
 * HTTP client for the Cortex staging API and local anomaly detection.
 * Provides market search, trending data, trade history, and analytics
 * that the agent uses to make treasury decisions.
 */

const CORTEX_API_URL =
  process.env.CORTEX_API_URL ||
  'https://cortex-api-staging-871482515924.asia-southeast1.run.app';

const DEFAULT_TIMEOUT = 10_000;

// ── HTTP helpers ──────────────────────────────────────────────────────

/**
 * @param {string} path
 * @param {Record<string, string>} [params]
 * @returns {Promise<any>}
 */
async function get(path, params = {}) {
  const url = new URL(path, CORTEX_API_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cortex ${res.status} ${res.statusText}: ${body}`);
  }

  return await res.json();
}

// ── REST API wrappers ─────────────────────────────────────────────────

/** Health check */
export async function getHealth() {
  return await get('/health');
}

/**
 * Search prediction markets.
 * @param {string} query
 */
export async function searchMarkets(query) {
  return await get('/api/v1/predictions/markets/search', { q: query });
}

/** Get trending prediction markets. */
export async function getTrendingMarkets() {
  return await get('/api/v1/predictions/markets/trending');
}

/**
 * Get detail for a single market.
 * @param {string} slug
 */
export async function getMarketDetail(slug) {
  return await get(`/api/v1/predictions/markets/${encodeURIComponent(slug)}`);
}

/**
 * Get recent trades for a market.
 * @param {string} slug
 */
export async function getMarketTrades(slug) {
  return await get(`/api/v1/predictions/markets/${encodeURIComponent(slug)}/trades`);
}

// ── Local analytics (when REST doesn't expose these directly) ─────────

/**
 * Simple Z-score anomaly detection on trade prices.
 *
 * Fetches trade history, computes a rolling average and standard deviation,
 * then flags any price point with |Z| > threshold as anomalous.
 *
 * @param {string} slug - Market slug
 * @param {number} [threshold=2.5] - Z-score threshold
 * @returns {Promise<{ anomalies: Array<{ price: number, zScore: number, timestamp: string }>, mean: number, stdDev: number, tradeCount: number }>}
 */
export async function detectAnomalies(slug, threshold = 2.5) {
  let trades;
  try {
    const data = await getMarketTrades(slug);
    trades = Array.isArray(data) ? data : data?.trades || data?.data || [];
  } catch {
    // If API is unavailable, return empty result
    return { anomalies: [], mean: 0, stdDev: 0, tradeCount: 0 };
  }

  if (!trades.length) {
    return { anomalies: [], mean: 0, stdDev: 0, tradeCount: 0 };
  }

  const prices = trades.map((t) => Number(t.price || t.amount || 0));
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length;
  const stdDev = Math.sqrt(variance);

  const anomalies = [];
  if (stdDev > 0) {
    trades.forEach((t, i) => {
      const price = prices[i];
      const zScore = (price - mean) / stdDev;
      if (Math.abs(zScore) > threshold) {
        anomalies.push({
          price,
          zScore: Math.round(zScore * 100) / 100,
          timestamp: t.timestamp || t.created_at || new Date().toISOString(),
        });
      }
    });
  }

  return { anomalies, mean, stdDev, tradeCount: trades.length };
}

/**
 * Compute a simple trend from trade prices.
 * Returns direction (up/down/flat) and magnitude.
 *
 * @param {string} slug
 * @param {'1h' | '4h' | '1d'} [interval='1h']
 * @returns {Promise<{ direction: string, magnitude: number, priceChange: number, startPrice: number, endPrice: number }>}
 */
export async function getMarketTrend(slug, interval = '1h') {
  let trades;
  try {
    const data = await getMarketTrades(slug);
    trades = Array.isArray(data) ? data : data?.trades || data?.data || [];
  } catch {
    return { direction: 'unknown', magnitude: 0, priceChange: 0, startPrice: 0, endPrice: 0 };
  }

  if (trades.length < 2) {
    return { direction: 'flat', magnitude: 0, priceChange: 0, startPrice: 0, endPrice: 0 };
  }

  const prices = trades.map((t) => Number(t.price || t.amount || 0));
  const startPrice = prices[0];
  const endPrice = prices[prices.length - 1];
  const priceChange = endPrice - startPrice;
  const magnitude = startPrice > 0 ? Math.abs(priceChange / startPrice) : 0;

  let direction = 'flat';
  if (magnitude > 0.01) direction = priceChange > 0 ? 'up' : 'down';

  return {
    direction,
    magnitude: Math.round(magnitude * 10000) / 10000,
    priceChange: Math.round(priceChange * 100) / 100,
    startPrice,
    endPrice,
  };
}

/**
 * Volume profile from trade data — bucket trades by price range.
 *
 * @param {string} slug
 * @returns {Promise<{ buckets: Array<{ priceRange: string, volume: number, count: number }>, totalVolume: number }>}
 */
export async function getVolumeProfile(slug) {
  let trades;
  try {
    const data = await getMarketTrades(slug);
    trades = Array.isArray(data) ? data : data?.trades || data?.data || [];
  } catch {
    return { buckets: [], totalVolume: 0 };
  }

  if (!trades.length) return { buckets: [], totalVolume: 0 };

  const prices = trades.map((t) => Number(t.price || t.amount || 0));
  const volumes = trades.map((t) => Number(t.volume || t.size || 1));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const bucketCount = 10;
  const bucketSize = range / bucketCount;

  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    priceRange: `${(min + i * bucketSize).toFixed(2)}-${(min + (i + 1) * bucketSize).toFixed(2)}`,
    volume: 0,
    count: 0,
  }));

  let totalVolume = 0;
  prices.forEach((price, i) => {
    const idx = Math.min(Math.floor((price - min) / bucketSize), bucketCount - 1);
    buckets[idx].volume += volumes[i];
    buckets[idx].count += 1;
    totalVolume += volumes[i];
  });

  return { buckets, totalVolume };
}

/**
 * Search market memory — find markets matching a query, with result limit.
 *
 * @param {string} query
 * @param {number} [limit=5]
 * @returns {Promise<any>}
 */
export async function searchMarketMemory(query, limit = 5) {
  try {
    const data = await searchMarkets(query);
    const markets = Array.isArray(data) ? data : data?.markets || data?.data || [];
    return markets.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Get a summary of current market conditions for the agent.
 * Pulls trending markets and runs anomaly detection on top ones.
 *
 * @returns {Promise<{ trending: any[], anomalies: any[], timestamp: string }>}
 */
export async function getMarketConditions() {
  let trending = [];
  try {
    const data = await getTrendingMarkets();
    trending = Array.isArray(data) ? data : data?.markets || data?.data || [];
  } catch {
    // Cortex API may be down
  }

  const anomalies = [];
  // Check top 3 trending markets for anomalies
  for (const market of trending.slice(0, 3)) {
    const slug = market.slug || market.id;
    if (!slug) continue;
    try {
      const result = await detectAnomalies(slug);
      if (result.anomalies.length > 0) {
        anomalies.push({ market: slug, ...result });
      }
    } catch {
      // skip
    }
  }

  return { trending, anomalies, timestamp: new Date().toISOString() };
}

// ── DeFi Data Sources ─────────────────────────────────────────────────
// On-chain DeFi signals supplement Cortex prediction market intelligence.

/**
 * Fetch USDT/USD peg status from CoinGecko free API.
 * Detects stablecoin depegs that prediction markets won't catch.
 *
 * @returns {Promise<{ price: number, depegRisk: boolean, deviation: number }>}
 */
export async function getUsdtPegStatus() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd&include_24hr_change=true',
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    const price = data.tether?.usd || 1.0;
    const deviation = Math.abs(1.0 - price);
    return {
      price,
      depegRisk: deviation > 0.005, // > 0.5% deviation = risk
      deviation,
      change24h: data.tether?.usd_24h_change || 0,
    };
  } catch {
    return { price: 1.0, depegRisk: false, deviation: 0, change24h: 0 };
  }
}

/**
 * Fetch ETH gas price from public RPC for gas cost awareness.
 *
 * @returns {Promise<{ gasGwei: number, isExpensive: boolean }>}
 */
export async function getGasPrice() {
  try {
    const res = await fetch('https://eth.drpc.org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    const gasWei = parseInt(data.result, 16);
    const gasGwei = gasWei / 1e9;
    return {
      gasGwei: Math.round(gasGwei * 10) / 10,
      isExpensive: gasGwei > 50, // > 50 gwei = expensive
    };
  } catch {
    return { gasGwei: 0, isExpensive: false };
  }
}

/**
 * Enhanced market conditions with DeFi data layered on top of prediction markets.
 *
 * @returns {Promise<{ trending: any[], anomalies: any[], defi: { usdtPeg: any, gas: any }, timestamp: string }>}
 */
export async function getMarketConditionsEnhanced() {
  // Fetch prediction market data and DeFi data in parallel
  const [baseConditions, usdtPeg, gas] = await Promise.all([
    getMarketConditions(),
    getUsdtPegStatus(),
    getGasPrice(),
  ]);

  // Add USDT depeg as a synthetic anomaly if detected
  if (usdtPeg.depegRisk) {
    baseConditions.anomalies.push({
      market: 'usdt-peg',
      anomalies: [{
        price: usdtPeg.price,
        zScore: usdtPeg.deviation * 1000, // Scale deviation to Z-score-like value
        timestamp: new Date().toISOString(),
        source: 'defi-onchain',
      }],
      mean: 1.0,
      stdDev: 0.001,
      tradeCount: 0,
      source: 'coingecko',
    });
  }

  return {
    ...baseConditions,
    defi: { usdtPeg, gas },
  };
}

export default {
  getHealth,
  searchMarkets,
  getTrendingMarkets,
  getMarketDetail,
  getMarketTrades,
  detectAnomalies,
  getMarketTrend,
  getVolumeProfile,
  searchMarketMemory,
  getMarketConditions,
  getMarketConditionsEnhanced,
  getUsdtPegStatus,
  getGasPrice,
};
