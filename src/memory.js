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
 * Find similar past conditions and compute memory-driven adjustments.
 * Returns both a recommendation string AND actionable threshold modifiers
 * that the strategy engine uses to change its behavior.
 *
 * @param {{ hasAnomalies: boolean, healthFactor: number | null, idleUsdt: boolean }} currentConditions
 * @returns {Promise<MemoryInsight>}
 */
export async function compareWithHistory(currentConditions) {
  const store = await loadStore();
  const all = store.decisions;

  /** @type {MemoryInsight} */
  const insight = {
    similar: [],
    recommendation: '',
    adjustments: {
      zScoreModifier: 0,      // negative = more sensitive, positive = less sensitive
      yieldCooldown: false,    // true = suppress yield supply temporarily
      urgencyBoost: false,     // true = act faster on risk-off
      skipSupply: false,       // true = block supply entirely (recent bad outcome)
    },
    hasMemory: all.length > 0,
    decisionCount: all.length,
  };

  if (all.length === 0) {
    insight.recommendation = 'No history. Operating without memory context.';
    return insight;
  }

  // Score each past decision by similarity to current conditions
  const scored = all.map((d) => {
    let score = 0;
    const ctx = d.marketContext;

    const pastHadAnomalies = (ctx.anomalyCount || 0) > 0;
    if (pastHadAnomalies === currentConditions.hasAnomalies) score += 3;

    if (d.action === 'supply' && currentConditions.idleUsdt) score += 2;
    if (d.action === 'withdraw' && currentConditions.hasAnomalies) score += 2;

    // Recency bonus
    const ageHours = (Date.now() - new Date(d.timestamp).getTime()) / 3.6e6;
    if (ageHours < 1) score += 2;
    else if (ageHours < 24) score += 1;

    return { decision: d, score };
  });

  scored.sort((a, b) => b.score - a.score);
  insight.similar = scored.slice(0, 10).map((s) => s.decision);

  // ── Compute memory-driven adjustments ──────────────────────────────

  // 1. If past withdrawals during anomalies were successful, lower the
  //    Z-score threshold (trigger risk-off earlier next time)
  const pastAnomalyWithdrawals = all.filter(
    (d) => d.action === 'withdraw' && (d.marketContext.anomalyCount || 0) > 0
  );
  const successfulWithdrawals = pastAnomalyWithdrawals.filter(
    (d) => d.outcome === 'success'
  );
  if (successfulWithdrawals.length >= 1) {
    // Each successful withdrawal lowers threshold by 0.3 (max -1.0)
    insight.adjustments.zScoreModifier = -Math.min(successfulWithdrawals.length * 0.3, 1.0);
    insight.adjustments.urgencyBoost = successfulWithdrawals.length >= 2;
  }

  // 2. If a recent supply was followed by an anomaly within the next few
  //    decisions, add a cooldown on supply (learned: don't supply before storms)
  const recentDecisions = all.slice(-5);
  const recentSupply = recentDecisions.find((d) => d.action === 'supply');
  const recentWithdrawAfterSupply = recentSupply
    ? recentDecisions.find(
        (d) =>
          d.action === 'withdraw' &&
          new Date(d.timestamp) > new Date(recentSupply.timestamp)
      )
    : null;
  if (recentWithdrawAfterSupply) {
    insight.adjustments.yieldCooldown = true;
  }

  // 3. If a past supply had a failed outcome, block supply entirely
  const recentFailedSupply = all
    .slice(-10)
    .find((d) => d.action === 'supply' && d.outcome && d.outcome.startsWith('failed'));
  if (recentFailedSupply) {
    insight.adjustments.skipSupply = true;
  }

  // 4. If we've withdrawn and re-supplied multiple times recently (churn),
  //    suppress supply to avoid oscillation
  const last8 = all.slice(-8);
  const withdrawCount = last8.filter((d) => d.action === 'withdraw').length;
  const supplyCount = last8.filter((d) => d.action === 'supply').length;
  if (withdrawCount >= 2 && supplyCount >= 2) {
    insight.adjustments.yieldCooldown = true;
  }

  // ── Build recommendation text ──────────────────────────────────────

  const actionCounts = {};
  insight.similar.forEach((d) => {
    actionCounts[d.action] = (actionCounts[d.action] || 0) + 1;
  });

  const topAction = Object.entries(actionCounts).sort((a, b) => b[1] - a[1])[0];
  if (topAction) {
    const [action, count] = topAction;
    insight.recommendation = `In ${count}/${insight.similar.length} similar past situations, the agent chose "${action}".`;

    const withOutcome = insight.similar.filter((d) => d.outcome && d.action === action);
    if (withOutcome.length > 0) {
      const successRate = withOutcome.filter((d) => d.outcome === 'success').length / withOutcome.length;
      insight.recommendation += ` Success rate: ${(successRate * 100).toFixed(0)}%.`;
    }
  } else {
    insight.recommendation = 'No clear pattern from past decisions.';
  }

  // Append adjustment explanations
  if (insight.adjustments.zScoreModifier !== 0) {
    insight.recommendation += ` Threshold adjusted by ${insight.adjustments.zScoreModifier.toFixed(1)} based on ${successfulWithdrawals.length} past successful withdrawals.`;
  }
  if (insight.adjustments.yieldCooldown) {
    insight.recommendation += ' Supply cooldown active — recent churn or supply-then-withdraw pattern detected.';
  }
  if (insight.adjustments.skipSupply) {
    insight.recommendation += ' Supply BLOCKED — recent supply had failed outcome.';
  }

  return insight;
}

/**
 * @typedef {Object} MemoryInsight
 * @property {Decision[]} similar
 * @property {string} recommendation
 * @property {{ zScoreModifier: number, yieldCooldown: boolean, urgencyBoost: boolean, skipSupply: boolean }} adjustments
 * @property {boolean} hasMemory
 * @property {number} decisionCount
 */

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
