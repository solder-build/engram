/**
 * Engram — Cortex Client (Market Intelligence)
 *
 * Primary: self-contained market-intel.js (CoinGecko + local Z-score).
 * Fallback: Cortex staging API when CORTEX_API_URL is configured.
 *
 * The agent works 100% without any API keys. Cortex enriches the data
 * when available but is never required.
 */

import { getMarketIntel } from './market-intel.js';

const CORTEX_API_URL = process.env.CORTEX_API_URL || '';
const CORTEX_API_KEY = process.env.CORTEX_API_KEY || '';
const DEFAULT_TIMEOUT = 10_000;

/** Whether the Cortex API is configured and should be tried */
const CORTEX_ENABLED = Boolean(CORTEX_API_URL);

// ── HTTP helpers (Cortex-specific) ────────────────────────────────────

/**
 * @param {string} path
 * @param {Record<string, string>} [params]
 * @returns {Promise<any>}
 */
async function cortexGet(path, params = {}) {
  if (!CORTEX_ENABLED) throw new Error('Cortex API not configured');

  const url = new URL(path, CORTEX_API_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const headers = { Accept: 'application/json' };
  if (CORTEX_API_KEY) headers['Authorization'] = `Bearer ${CORTEX_API_KEY}`;

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    headers,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cortex ${res.status} ${res.statusText}: ${body}`);
  }

  return await res.json();
}

// ── Cortex REST API wrappers (optional enrichment) ────────────────────

/** Health check */
export async function getHealth() {
  return await cortexGet('/health');
}

/**
 * Search prediction markets (Cortex only).
 * @param {string} query
 */
export async function searchMarkets(query) {
  return await cortexGet('/api/v1/predictions/markets/search', { q: query });
}

/** Get trending prediction markets (Cortex only). */
export async function getTrendingMarkets() {
  return await cortexGet('/api/v1/predictions/markets/trending');
}

/**
 * Get detail for a single market (Cortex only).
 * @param {string} slug
 */
export async function getMarketDetail(slug) {
  return await cortexGet(`/api/v1/predictions/markets/${encodeURIComponent(slug)}`);
}

/**
 * Get recent trades for a market (Cortex only).
 * @param {string} slug
 */
export async function getMarketTrades(slug) {
  return await cortexGet(`/api/v1/predictions/markets/${encodeURIComponent(slug)}/trades`);
}

// ── Local analytics ───────────────────────────────────────────────────
// These are kept for backward compatibility but the real anomaly
// detection now lives in market-intel.js using rolling Z-scores.

/**
 * Simple Z-score anomaly detection on trade prices (Cortex trades).
 * Falls back gracefully if Cortex is unavailable.
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
 * Compute a simple trend from Cortex trade prices.
 * @param {string} slug
 * @param {'1h' | '4h' | '1d'} [interval='1h']
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
 * Volume profile from Cortex trade data.
 * @param {string} slug
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
 * Search market memory (Cortex only, returns [] if unavailable).
 * @param {string} query
 * @param {number} [limit=5]
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

// ── DeFi Data Sources ─────────────────────────────────────────────────

/**
 * Fetch USDT/USD peg status from CoinGecko free API.
 * @returns {Promise<{ price: number, depegRisk: boolean, deviation: number, change24h: number }>}
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
      depegRisk: deviation > 0.005,
      deviation,
      change24h: data.tether?.usd_24h_change || 0,
    };
  } catch {
    return { price: 1.0, depegRisk: false, deviation: 0, change24h: 0 };
  }
}

/**
 * Fetch ETH gas price from public RPC.
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
      isExpensive: gasGwei > 50,
    };
  } catch {
    return { gasGwei: 0, isExpensive: false };
  }
}

// ── Primary entry point ───────────────────────────────────────────────

/**
 * Get market conditions — the main function strategies.js calls.
 *
 * Flow:
 *   1. Always fetch live data from market-intel.js (CoinGecko + local Z-score)
 *   2. If Cortex API is configured, try to merge Cortex prediction market data
 *   3. Layer on DeFi data (USDT peg, gas)
 *   4. Return unified structure matching CortexData typedef
 *
 * @returns {Promise<{ trending: any[], anomalies: any[], timestamp: string }>}
 */
export async function getMarketConditions() {
  // Primary: self-contained market intelligence (always works)
  const intel = await getMarketIntel();

  let conditions = {
    trending: intel.trending,
    anomalies: intel.anomalies,
    timestamp: intel.timestamp,
    prices: intel.prices,
    source: 'market-intel',
  };

  // Optional: merge Cortex prediction market data if API key is set
  if (CORTEX_ENABLED && CORTEX_API_KEY) {
    try {
      const cortexTrending = await getTrendingMarkets();
      const markets = Array.isArray(cortexTrending)
        ? cortexTrending
        : cortexTrending?.markets || cortexTrending?.data || [];

      // Append Cortex trending markets (tagged with source)
      const cortexTagged = markets.map((m) => ({ ...m, source: 'cortex' }));
      conditions.trending = [...conditions.trending, ...cortexTagged];

      // Run Cortex anomaly detection on top 3 Cortex markets
      for (const market of markets.slice(0, 3)) {
        const slug = market.slug || market.id;
        if (!slug) continue;
        try {
          const result = await detectAnomalies(slug);
          if (result.anomalies.length > 0) {
            conditions.anomalies.push({ market: slug, ...result, source: 'cortex' });
          }
        } catch {
          // skip individual market failures
        }
      }

      conditions.source = 'market-intel+cortex';
    } catch (err) {
      // Cortex failed — that's fine, we have market-intel data
      console.error(`[cortex] Optional enrichment failed: ${err.message}`);
    }
  }

  return conditions;
}

/**
 * Enhanced market conditions with DeFi data layered on top.
 * This is the function agent.js calls.
 *
 * @returns {Promise<{ trending: any[], anomalies: any[], defi: { usdtPeg: any, gas: any }, timestamp: string }>}
 */
export async function getMarketConditionsEnhanced() {
  // Fetch market-intel data and DeFi data in parallel
  const [baseConditions, usdtPeg, gas] = await Promise.all([
    getMarketConditions(),
    getUsdtPegStatus(),
    getGasPrice(),
  ]);

  // Add USDT depeg as a synthetic anomaly if detected
  if (usdtPeg.depegRisk) {
    baseConditions.anomalies.push({
      market: 'usdt-peg',
      anomalies: [
        {
          price: usdtPeg.price,
          zScore: usdtPeg.deviation * 1000,
          timestamp: new Date().toISOString(),
          source: 'defi-onchain',
        },
      ],
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
  // Primary (always works)
  getMarketConditions,
  getMarketConditionsEnhanced,
  getUsdtPegStatus,
  getGasPrice,
  // Cortex-specific (require API)
  getHealth,
  searchMarkets,
  getTrendingMarkets,
  getMarketDetail,
  getMarketTrades,
  detectAnomalies,
  getMarketTrend,
  getVolumeProfile,
  searchMarketMemory,
};
