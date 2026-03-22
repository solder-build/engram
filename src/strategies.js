/**
 * Engram — Trading/Treasury Strategies
 *
 * Three autonomous strategies the agent evaluates each tick:
 *   1. RiskOff   — anomaly detected? withdraw from Aave, hold USDT
 *   2. YieldOptimize — idle USDT sitting around? supply to Aave for yield
 *   3. Rebalance — health factor dropping? repay debt to stay safe
 *
 * The StrategyEngine runs all three, picks the highest-priority action,
 * and returns it to the agent loop for execution.
 */

const IDLE_USDT_THRESHOLD = BigInt(
  process.env.IDLE_USDT_THRESHOLD || '100'
) * 10n ** 6n; // USDT has 6 decimals

const HEALTH_FACTOR_TARGET = Number(process.env.HEALTH_FACTOR_TARGET || '1.5');
const ANOMALY_ZSCORE_THRESHOLD = Number(process.env.ANOMALY_ZSCORE_THRESHOLD || '2.5');

/**
 * @typedef {Object} CortexData
 * @property {Array} trending
 * @property {Array<{ market: string, anomalies: Array<{ zScore: number }> }>} anomalies
 * @property {string} timestamp
 * @property {{ usdtPeg?: { price: number, depegRisk: boolean }, gas?: { gasGwei: number, isExpensive: boolean } }} [defi]
 */

/**
 * @typedef {Object} WalletState
 * @property {string} address
 * @property {bigint} ethBalance
 * @property {bigint} [usdtBalance]
 */

/**
 * @typedef {Object} LendingState
 * @property {string} totalCollateral
 * @property {string} totalDebt
 * @property {string} healthFactor
 * @property {string} availableBorrows
 */

/**
 * @typedef {Object} StrategyAction
 * @property {string} strategy - Name of the strategy
 * @property {string} action - Action to take (withdraw, supply, repay, hold)
 * @property {string} reason - Human-readable explanation
 * @property {number} priority - 1 = highest, 3 = lowest
 * @property {Record<string, any>} params - Parameters for execution
 */

/**
 * @typedef {Object} MemoryAdjustments
 * @property {number} zScoreModifier - Adjusts anomaly threshold (negative = more sensitive)
 * @property {boolean} yieldCooldown - If true, suppress yield supply temporarily
 * @property {boolean} urgencyBoost - If true, act faster on risk-off
 * @property {boolean} skipSupply - If true, block supply entirely
 */

/** @type {MemoryAdjustments} */
const NO_MEMORY = { zScoreModifier: 0, yieldCooldown: false, urgencyBoost: false, skipSupply: false };

// ── Strategy 1: RiskOff ───────────────────────────────────────────────

/**
 * When anomalies are detected in market data (Z-score spikes above threshold),
 * withdraw all funds from Aave and hold USDT — capital preservation.
 *
 * MEMORY EFFECT: Past successful withdrawals lower the Z-score threshold,
 * making the agent more sensitive to anomalies it has seen before.
 *
 * @param {CortexData} cortexData
 * @param {WalletState} _walletState
 * @param {LendingState} lendingState
 * @param {MemoryAdjustments} memAdj
 * @returns {StrategyAction | null}
 */
function evaluateRiskOff(cortexData, _walletState, lendingState, memAdj = NO_MEMORY) {
  const hasAnomalies = cortexData.anomalies && cortexData.anomalies.length > 0;
  if (!hasAnomalies) return null;

  // Memory adjusts the threshold: past successful withdrawals make agent more sensitive
  const effectiveThreshold = ANOMALY_ZSCORE_THRESHOLD + memAdj.zScoreModifier;

  // Check if any anomaly exceeds our (memory-adjusted) threshold
  const severeAnomalies = cortexData.anomalies.filter((a) =>
    a.anomalies.some((d) => Math.abs(d.zScore) > effectiveThreshold)
  );

  if (severeAnomalies.length === 0) return null;

  // Only trigger if we actually have collateral in Aave
  const collateral = parseFloat(lendingState.totalCollateral || '0');
  if (collateral <= 0) return null;

  const worstZScore = Math.max(
    ...severeAnomalies.flatMap((a) => a.anomalies.map((d) => Math.abs(d.zScore)))
  );

  const memNote = memAdj.zScoreModifier !== 0
    ? ` Memory adjusted threshold from ${ANOMALY_ZSCORE_THRESHOLD} to ${effectiveThreshold.toFixed(1)}.`
    : '';

  return {
    strategy: 'RiskOff',
    action: 'withdraw',
    reason: `Market anomaly detected (Z-score ${worstZScore.toFixed(1)}) across ${severeAnomalies.length} market(s). Withdrawing from Aave to preserve capital.${memNote}`,
    priority: memAdj.urgencyBoost ? 0 : 1, // Higher urgency if memory says act fast
    params: {
      markets: severeAnomalies.map((a) => a.market),
      worstZScore,
      effectiveThreshold,
      memoryAdjusted: memAdj.zScoreModifier !== 0,
      withdrawAll: true,
    },
  };
}

// ── Strategy 2: YieldOptimize ─────────────────────────────────────────

/**
 * When idle USDT balance exceeds threshold and no anomalies detected,
 * supply to Aave for yield generation.
 *
 * MEMORY EFFECTS:
 * - yieldCooldown: blocks supply if recent supply was followed by a withdrawal (churn)
 * - skipSupply: blocks supply if recent supply had a failed outcome
 *
 * @param {CortexData} cortexData
 * @param {WalletState} walletState
 * @param {LendingState} _lendingState
 * @param {MemoryAdjustments} memAdj
 * @returns {StrategyAction | null}
 */
function evaluateYieldOptimize(cortexData, walletState, _lendingState, memAdj = NO_MEMORY) {
  // Don't supply if anomalies are present
  if (cortexData.anomalies && cortexData.anomalies.length > 0) return null;

  // Memory: block supply if recent supply failed
  if (memAdj.skipSupply) return null;

  // Memory: cooldown if recent churn (supply→withdraw→supply oscillation)
  if (memAdj.yieldCooldown) return null;

  // Gas awareness: don't supply when gas is expensive (tx cost may exceed yield)
  const gas = cortexData.defi?.gas;
  if (gas && gas.isExpensive) return null;

  const usdtBalance = walletState.usdtBalance || 0n;
  if (usdtBalance < IDLE_USDT_THRESHOLD) return null;

  const gasNote = gas ? ` Gas: ${gas.gasGwei} gwei.` : '';
  return {
    strategy: 'YieldOptimize',
    action: 'supply',
    reason: `Idle USDT balance (${formatUsdt(usdtBalance)}) exceeds threshold. No anomalies detected — supplying to Aave for yield.${gasNote}`,
    priority: 3,
    params: {
      amount: usdtBalance,
      amountFormatted: formatUsdt(usdtBalance),
      gasGwei: gas?.gasGwei || 0,
    },
  };
}

// ── Strategy 3: Rebalance ─────────────────────────────────────────────

/**
 * When health factor drops below target, repay some debt to bring it
 * back above the safe threshold. Prevents liquidation.
 *
 * @param {CortexData} _cortexData
 * @param {WalletState} walletState
 * @param {LendingState} lendingState
 * @param {MemoryAdjustments} _memAdj
 * @returns {StrategyAction | null}
 */
function evaluateRebalance(_cortexData, walletState, lendingState, _memAdj = NO_MEMORY) {
  const hf = parseFloat(lendingState.healthFactor || '0');

  // health factor of 0 means no position, N/A means error
  if (hf === 0 || isNaN(hf)) return null;

  // Already healthy
  if (hf >= HEALTH_FACTOR_TARGET) return null;

  const totalDebt = parseFloat(lendingState.totalDebt || '0');
  if (totalDebt <= 0) return null;

  // Check if we have USDT to repay with
  const usdtBalance = walletState.usdtBalance || 0n;
  if (usdtBalance === 0n) {
    return {
      strategy: 'Rebalance',
      action: 'alert',
      reason: `Health factor (${hf.toFixed(2)}) below target (${HEALTH_FACTOR_TARGET}). No USDT available for repayment — manual intervention needed.`,
      priority: 1,
      params: { healthFactor: hf, totalDebt, needsFunds: true },
    };
  }

  // Repay up to 25% of debt to improve HF
  const repayAmountUsd = totalDebt * 0.25;
  const repayAmountBase = BigInt(Math.floor(repayAmountUsd * 1e6));
  const repayAmount = usdtBalance < repayAmountBase ? usdtBalance : repayAmountBase;

  return {
    strategy: 'Rebalance',
    action: 'repay',
    reason: `Health factor (${hf.toFixed(2)}) below target (${HEALTH_FACTOR_TARGET}). Repaying ${formatUsdt(repayAmount)} to improve position.`,
    priority: 2,
    params: {
      amount: repayAmount,
      amountFormatted: formatUsdt(repayAmount),
      currentHealthFactor: hf,
      targetHealthFactor: HEALTH_FACTOR_TARGET,
    },
  };
}

// ── Strategy Engine ───────────────────────────────────────────────────

const STRATEGIES = [
  { name: 'RiskOff', evaluate: evaluateRiskOff },
  { name: 'YieldOptimize', evaluate: evaluateYieldOptimize },
  { name: 'Rebalance', evaluate: evaluateRebalance },
];

/**
 * Run all strategies against current state and pick the highest-priority action.
 * Memory adjustments modify strategy thresholds and can block/boost actions.
 *
 * @param {CortexData} cortexData
 * @param {WalletState} walletState
 * @param {LendingState} lendingState
 * @param {MemoryAdjustments} [memAdj] - Memory-driven threshold adjustments
 * @returns {{ action: StrategyAction | null, allResults: Array<{ name: string, result: StrategyAction | null }> }}
 */
export function runStrategies(cortexData, walletState, lendingState, memAdj = NO_MEMORY) {
  const allResults = STRATEGIES.map((s) => ({
    name: s.name,
    result: s.evaluate(cortexData, walletState, lendingState, memAdj),
  }));

  // Pick highest priority (lowest number) non-null result
  const candidates = allResults
    .filter((r) => r.result !== null)
    .sort((a, b) => a.result.priority - b.result.priority);

  return {
    action: candidates.length > 0 ? candidates[0].result : null,
    allResults,
  };
}

/**
 * Evaluate what the agent would do without memory (stateless).
 * Used in demo to contrast with memory-informed decisions.
 * Explicitly passes NO_MEMORY to prove the difference.
 *
 * @param {CortexData} cortexData
 * @param {WalletState} walletState
 * @param {LendingState} lendingState
 * @returns {StrategyAction | null}
 */
export function evaluateStateless(cortexData, walletState, lendingState) {
  const { action } = runStrategies(cortexData, walletState, lendingState, NO_MEMORY);
  return action;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Format a USDT bigint (6 decimals) to a readable string. */
function formatUsdt(amount) {
  return `${(Number(amount) / 1e6).toFixed(2)} USDT`;
}

export { STRATEGIES, IDLE_USDT_THRESHOLD, HEALTH_FACTOR_TARGET, ANOMALY_ZSCORE_THRESHOLD, NO_MEMORY };

export default {
  runStrategies,
  evaluateStateless,
  STRATEGIES,
};
