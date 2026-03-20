/**
 * Engram — Persistent Memory Layer
 *
 * Stores the agent's decision history so it can learn from past actions.
 * Primary storage is a local JSON file (data/memory.json) — simple,
 * portable, and works offline. Cortex search is used to find similar
 * past conditions when the API is available.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE = join(__dirname, '..', 'data', 'memory.json');
const MAX_DECISIONS = 500; // cap to prevent unbounded growth

/**
 * @typedef {Object} Decision
 * @property {string} id
 * @property {string} timestamp
 * @property {string} action
 * @property {string} strategy
 * @property {string} reason
 * @property {Record<string, any>} marketContext
 * @property {string | null} outcome
 * @property {Record<string, any>} [params]
 */

/**
 * @typedef {Object} MemoryStore
 * @property {Decision[]} decisions
 * @property {string} created
 */

// ── File I/O ──────────────────────────────────────────────────────────

/** @returns {Promise<MemoryStore>} */
async function loadStore() {
  try {
    const raw = await readFile(MEMORY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { decisions: [], created: new Date().toISOString() };
  }
}

/** Deep-convert BigInts to strings before serialization */
function sanitizeBigInts(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(sanitizeBigInts);
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = sanitizeBigInts(v);
    }
    return out;
  }
  return obj;
}

/** @param {MemoryStore} store */
async function saveStore(store) {
  await mkdir(dirname(MEMORY_FILE), { recursive: true });
  const safe = sanitizeBigInts(store);
  await writeFile(MEMORY_FILE, JSON.stringify(safe, null, 2), 'utf-8');
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Record a decision the agent made.
 *
 * @param {string} action - What was done (supply, withdraw, repay, hold, alert)
 * @param {string} reason - Why the agent chose this action
 * @param {Record<string, any>} marketContext - Market conditions at decision time
 * @param {string | null} [outcome=null] - Result of the action (filled in later)
 * @param {Record<string, any>} [params={}] - Additional parameters
 * @returns {Promise<Decision>}
 */
export async function recordDecision(action, reason, marketContext, outcome = null, params = {}) {
  const store = await loadStore();

  const decision = {
    id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    action,
    strategy: params.strategy || 'unknown',
    reason,
    marketContext: {
      anomalyCount: marketContext.anomalies?.length || 0,
      trendingCount: marketContext.trending?.length || 0,
      timestamp: marketContext.timestamp,
      ...summarizeContext(marketContext),
    },
    outcome,
    params,
  };

  store.decisions.push(decision);

  // Cap history
  if (store.decisions.length > MAX_DECISIONS) {
    store.decisions = store.decisions.slice(-MAX_DECISIONS);
  }

  await saveStore(store);
  return decision;
}

/**
 * Retrieve past decisions, most recent first.
 *
 * @param {number} [limit=20]
 * @returns {Promise<Decision[]>}
 */
export async function getDecisionHistory(limit = 20) {
  const store = await loadStore();
  return store.decisions.slice(-limit).reverse();
}

/**
 * Build a context summary from recent decisions for the agent to reason about.
 * Returns a concise text block the LLM-agent can consume.
 *
 * @returns {Promise<string>}
 */
export async function getMemoryContext() {
  const recent = await getDecisionHistory(10);
  if (recent.length === 0) {
    return 'No prior decisions recorded. This is the agent\'s first run.';
  }

  const lines = recent.map((d, i) => {
    const ago = timeSince(new Date(d.timestamp));
    return `  ${i + 1}. [${ago} ago] ${d.strategy}/${d.action}: ${d.reason}${d.outcome ? ` → ${d.outcome}` : ''}`;
  });

  return `Recent decisions (${recent.length} of ${(await loadStore()).decisions.length} total):\n${lines.join('\n')}`;
}

/**
 * Find similar past conditions and what the agent did.
 * Compares anomaly presence, market direction, and health factor.
 *
 * @param {{ hasAnomalies: boolean, healthFactor: number | null, idleUsdt: boolean }} currentConditions
 * @returns {Promise<{ similar: Decision[], recommendation: string }>}
 */
export async function compareWithHistory(currentConditions) {
  const store = await loadStore();
  const all = store.decisions;

  if (all.length === 0) {
    return {
      similar: [],
      recommendation: 'No history to compare against. Operating without memory context.',
    };
  }

  // Score each past decision by similarity to current conditions
  const scored = all.map((d) => {
    let score = 0;
    const ctx = d.marketContext;

    // Anomaly match
    const pastHadAnomalies = (ctx.anomalyCount || 0) > 0;
    if (pastHadAnomalies === currentConditions.hasAnomalies) score += 3;

    // Idle USDT match
    if (d.action === 'supply' && currentConditions.idleUsdt) score += 2;
    if (d.action === 'withdraw' && currentConditions.hasAnomalies) score += 2;

    // Recency bonus (more recent = more relevant)
    const ageHours = (Date.now() - new Date(d.timestamp).getTime()) / 3.6e6;
    if (ageHours < 1) score += 2;
    else if (ageHours < 24) score += 1;

    return { decision: d, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const similar = scored.slice(0, 5).map((s) => s.decision);

  // Build recommendation from patterns
  const actionCounts = {};
  similar.forEach((d) => {
    actionCounts[d.action] = (actionCounts[d.action] || 0) + 1;
  });

  const topAction = Object.entries(actionCounts).sort((a, b) => b[1] - a[1])[0];
  let recommendation;

  if (topAction) {
    const [action, count] = topAction;
    recommendation = `In ${count}/${similar.length} similar past situations, the agent chose "${action}".`;

    // Check outcomes
    const withOutcome = similar.filter((d) => d.outcome && d.action === action);
    if (withOutcome.length > 0) {
      const successRate = withOutcome.filter((d) => d.outcome === 'success').length / withOutcome.length;
      recommendation += ` Success rate: ${(successRate * 100).toFixed(0)}%.`;
    }
  } else {
    recommendation = 'No clear pattern from past decisions.';
  }

  return { similar, recommendation };
}

/**
 * Update the outcome of a past decision (after execution).
 *
 * @param {string} decisionId
 * @param {string} outcome
 * @returns {Promise<boolean>}
 */
export async function updateOutcome(decisionId, outcome) {
  const store = await loadStore();
  const decision = store.decisions.find((d) => d.id === decisionId);
  if (!decision) return false;
  decision.outcome = outcome;
  await saveStore(store);
  return true;
}

/**
 * Get total number of decisions stored.
 * @returns {Promise<number>}
 */
export async function getDecisionCount() {
  const store = await loadStore();
  return store.decisions.length;
}

/**
 * Clear all memory (for testing).
 */
export async function clearMemory() {
  await saveStore({ decisions: [], created: new Date().toISOString() });
}

// ── Helpers ───────────────────────────────────────────────────────────

function summarizeContext(marketContext) {
  const summary = {};
  if (marketContext.anomalies?.length > 0) {
    const worst = Math.max(
      ...marketContext.anomalies.flatMap((a) =>
        (a.anomalies || []).map((d) => Math.abs(d.zScore || 0))
      )
    );
    summary.worstZScore = worst;
  }
  return summary;
}

function timeSince(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export default {
  recordDecision,
  getDecisionHistory,
  getMemoryContext,
  compareWithHistory,
  updateOutcome,
  getDecisionCount,
  clearMemory,
};
