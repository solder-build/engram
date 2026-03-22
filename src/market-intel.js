/**
 * Engram — Self-Contained Market Intelligence Layer
 *
 * Replaces Cortex prediction market API dependency with free public data
 * sources and local statistical analysis. Zero API keys required.
 *
 * Data sources:
 *   - CoinGecko free API: BTC, ETH, USDT prices + 24h change + volume
 *   - Local Z-score anomaly detection on rolling price history
 *   - USDT depeg monitoring (via CoinGecko)
 *   - ETH gas price (via public RPC)
 *
 * Persistence:
 *   - Rolling price history stored in data/market-history.json
 *   - Survives restarts, capped at configurable window size
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = join(__dirname, '..', 'data', 'market-history.json');

// ── Configuration ─────────────────────────────────────────────────────

const COINGECKO_URL = 'https://api.coingecko.com/api/v3';
const DEFAULT_TIMEOUT = 5_000;

/** Max data points per asset in the rolling window */
const MAX_HISTORY_POINTS = 50;

/** Minimum data points needed before Z-score is meaningful */
const MIN_POINTS_FOR_ZSCORE = 5;

/** Default Z-score threshold for flagging anomalies */
const DEFAULT_ZSCORE_THRESHOLD = 2.5;

/** Assets to track */
const TRACKED_ASSETS = ['bitcoin', 'ethereum', 'tether'];

// ── History persistence ───────────────────────────────────────────────

/**
 * @typedef {Object} PricePoint
 * @property {number} price
 * @property {number} change24h
 * @property {number} volume24h
 * @property {string} timestamp
 */

/**
 * @typedef {Object} MarketHistory
 * @property {Record<string, PricePoint[]>} assets - keyed by CoinGecko id
 * @property {string} lastUpdated
 */

/** @returns {Promise<MarketHistory>} */
async function loadHistory() {
  try {
    const raw = await readFile(HISTORY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { assets: {}, lastUpdated: new Date().toISOString() };
  }
}

/** @param {MarketHistory} history */
async function saveHistory(history) {
  await mkdir(dirname(HISTORY_FILE), { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

// ── CoinGecko data fetching ───────────────────────────────────────────

/**
 * Fetch live prices, 24h change, and 24h volume from CoinGecko.
 * No API key required.
 *
 * @returns {Promise<Record<string, { usd: number, usd_24h_change: number, usd_24h_vol: number }>>}
 */
async function fetchPrices() {
  const ids = TRACKED_ASSETS.join(',');
  const url = `${COINGECKO_URL}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`CoinGecko ${res.status} ${res.statusText}`);
  }

  return await res.json();
}

// ── Statistical analysis ──────────────────────────────────────────────

/**
 * Compute mean of an array of numbers.
 * @param {number[]} values
 * @returns {number}
 */
function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compute population standard deviation.
 * @param {number[]} values
 * @param {number} [mu] - precomputed mean
 * @returns {number}
 */
function stdDev(values, mu) {
  if (values.length < 2) return 0;
  const m = mu !== undefined ? mu : mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Compute Z-score for a value relative to a dataset.
 * @param {number} value
 * @param {number} mu - mean
 * @param {number} sigma - standard deviation
 * @returns {number}
 */
function zScore(value, mu, sigma) {
  if (sigma === 0) return 0;
  return (value - mu) / sigma;
}

/**
 * Run Z-score anomaly detection on an asset's price change history.
 *
 * Uses the rolling window of 24h percentage changes. A Z-score measures
 * how many standard deviations the latest change is from the historical
 * mean change. High |Z| means the current move is statistically unusual.
 *
 * @param {PricePoint[]} history - Rolling price points for one asset
 * @param {number} [threshold] - Z-score threshold
 * @returns {{ isAnomaly: boolean, zScore: number, mean: number, stdDev: number, dataPoints: number }}
 */
function detectAnomaly(history, threshold = DEFAULT_ZSCORE_THRESHOLD) {
  if (history.length < MIN_POINTS_FOR_ZSCORE) {
    return { isAnomaly: false, zScore: 0, mean: 0, stdDev: 0, dataPoints: history.length };
  }

  const changes = history.map((p) => p.change24h);
  const mu = mean(changes);
  const sigma = stdDev(changes, mu);

  // Z-score of the most recent data point
  const latest = changes[changes.length - 1];
  const z = zScore(latest, mu, sigma);

  return {
    isAnomaly: Math.abs(z) > threshold,
    zScore: Math.round(z * 100) / 100,
    mean: Math.round(mu * 1000) / 1000,
    stdDev: Math.round(sigma * 1000) / 1000,
    dataPoints: history.length,
  };
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Fetch live market data, update rolling history, run anomaly detection.
 *
 * Returns the same shape as the old cortex.getMarketConditions() so
 * strategies.js works without changes:
 *   { trending, anomalies, timestamp, defi? }
 *
 * @param {number} [anomalyThreshold] - Z-score threshold override
 * @returns {Promise<{ trending: any[], anomalies: any[], timestamp: string, prices: Record<string, any> }>}
 */
export async function getMarketIntel(anomalyThreshold = DEFAULT_ZSCORE_THRESHOLD) {
  const now = new Date().toISOString();

  // Fetch live prices
  let prices;
  try {
    prices = await fetchPrices();
  } catch (err) {
    // If CoinGecko is down, return empty but valid structure
    console.error(`[market-intel] CoinGecko fetch failed: ${err.message}`);
    return {
      trending: [],
      anomalies: [],
      timestamp: now,
      prices: {},
      source: 'market-intel',
      error: err.message,
    };
  }

  // Load and update rolling history
  const history = await loadHistory();

  for (const assetId of TRACKED_ASSETS) {
    const data = prices[assetId];
    if (!data) continue;

    if (!history.assets[assetId]) {
      history.assets[assetId] = [];
    }

    history.assets[assetId].push({
      price: data.usd,
      change24h: data.usd_24h_change || 0,
      volume24h: data.usd_24h_vol || 0,
      timestamp: now,
    });

    // Cap rolling window
    if (history.assets[assetId].length > MAX_HISTORY_POINTS) {
      history.assets[assetId] = history.assets[assetId].slice(-MAX_HISTORY_POINTS);
    }
  }

  history.lastUpdated = now;
  await saveHistory(history);

  // Build trending array from live price data
  const trending = TRACKED_ASSETS
    .filter((id) => prices[id])
    .map((id) => {
      const d = prices[id];
      const change = d.usd_24h_change || 0;
      return {
        slug: id,
        title: `${id.charAt(0).toUpperCase() + id.slice(1)} $${d.usd.toLocaleString()}`,
        price: d.usd,
        change24h: Math.round(change * 100) / 100,
        volume24h: d.usd_24h_vol || 0,
        direction: change > 1 ? 'up' : change < -1 ? 'down' : 'flat',
      };
    });

  // Run anomaly detection on each tracked asset
  const anomalies = [];

  for (const assetId of TRACKED_ASSETS) {
    const assetHistory = history.assets[assetId];
    if (!assetHistory || assetHistory.length === 0) continue;

    const result = detectAnomaly(assetHistory, anomalyThreshold);

    if (result.isAnomaly) {
      const latest = assetHistory[assetHistory.length - 1];
      anomalies.push({
        market: assetId,
        anomalies: [
          {
            price: latest.price,
            zScore: result.zScore,
            timestamp: latest.timestamp,
            change24h: latest.change24h,
            source: 'market-intel-zscore',
          },
        ],
        mean: result.mean,
        stdDev: result.stdDev,
        tradeCount: result.dataPoints,
        source: 'market-intel',
      });
    }
  }

  // Construct normalized price map for consumers
  const priceMap = {};
  for (const assetId of TRACKED_ASSETS) {
    if (prices[assetId]) {
      priceMap[assetId] = {
        price: prices[assetId].usd,
        change24h: prices[assetId].usd_24h_change || 0,
        volume24h: prices[assetId].usd_24h_vol || 0,
      };
    }
  }

  return {
    trending,
    anomalies,
    timestamp: now,
    prices: priceMap,
    source: 'market-intel',
  };
}

/**
 * Get the current rolling history stats without fetching new data.
 * Useful for debugging or inspecting the history file.
 *
 * @returns {Promise<{ assets: Record<string, { count: number, oldest: string, newest: string }>, lastUpdated: string }>}
 */
export async function getHistoryStats() {
  const history = await loadHistory();
  const stats = {};

  for (const [assetId, points] of Object.entries(history.assets)) {
    if (points.length === 0) continue;
    stats[assetId] = {
      count: points.length,
      oldest: points[0].timestamp,
      newest: points[points.length - 1].timestamp,
    };
  }

  return { assets: stats, lastUpdated: history.lastUpdated };
}

/**
 * Run anomaly detection on stored history without fetching new data.
 * Useful for testing or re-evaluating with different thresholds.
 *
 * @param {number} [threshold]
 * @returns {Promise<Record<string, { isAnomaly: boolean, zScore: number, mean: number, stdDev: number, dataPoints: number }>>}
 */
export async function analyzeHistory(threshold = DEFAULT_ZSCORE_THRESHOLD) {
  const history = await loadHistory();
  const results = {};

  for (const [assetId, points] of Object.entries(history.assets)) {
    results[assetId] = detectAnomaly(points, threshold);
  }

  return results;
}

export {
  TRACKED_ASSETS,
  MAX_HISTORY_POINTS,
  MIN_POINTS_FOR_ZSCORE,
  DEFAULT_ZSCORE_THRESHOLD,
  detectAnomaly,
  mean,
  stdDev,
  zScore,
};

export default {
  getMarketIntel,
  getHistoryStats,
  analyzeHistory,
  detectAnomaly,
  mean,
  stdDev,
  zScore,
  TRACKED_ASSETS,
  MAX_HISTORY_POINTS,
  MIN_POINTS_FOR_ZSCORE,
  DEFAULT_ZSCORE_THRESHOLD,
};
