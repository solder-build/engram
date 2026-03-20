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

// ── Strategy 1: RiskOff ───────────────────────────────────────────────

/**
 * When anomalies are detected in market data (Z-score spikes above threshold),
 * withdraw all funds from Aave and hold USDT — capital preservation.
 *
 * @param {CortexData} cortexData
 * @param {WalletState} _walletState
 * @param {LendingState} lendingState
 * @returns {StrategyAction | null}
 */
function evaluateRiskOff(cortexData, _walletState, lendingState) {
  const hasAnomalies = cortexData.anomalies && cortexData.anomalies.length > 0;
  if (!hasAnomalies) return null;

  // Check if any anomaly exceeds our threshold
  const severeAnomalies = cortexData.anomalies.filter((a) =>
    a.anomalies.some((d) => Math.abs(d.zScore) > ANOMALY_ZSCORE_THRESHOLD)
  );

  if (severeAnomalies.length === 0) return null;

  // Only trigger if we actually have collateral in Aave
  const collateral = parseFloat(lendingState.totalCollateral || '0');
  if (collateral <= 0) return null;

  const worstZScore = Math.max(
    ...severeAnomalies.flatMap((a) => a.anomalies.map((d) => Math.abs(d.zScore)))
  );

  return {
    strategy: 'RiskOff',
    action: 'withdraw',
    reason: `Market anomaly detected (Z-score ${worstZScore.toFixed(1)}) across ${severeAnomalies.length} market(s). Withdrawing from Aave to preserve capital.`,
    priority: 1,
    params: {
      markets: severeAnomalies.map((a) => a.market),
      worstZScore,
      withdrawAll: true,
    },
  };
}

// ── Strategy 2: YieldOptimize ─────────────────────────────────────────

/**
 * When idle USDT balance exceeds threshold and no anomalies detected,
 * supply to Aave for yield generation.
 *
 * @param {CortexData} cortexData
 * @param {WalletState} walletState
 * @param {LendingState} _lendingState
 * @returns {StrategyAction | null}
 */
function evaluateYieldOptimize(cortexData, walletState, _lendingState) {
  // Don't supply if anomalies are present
  if (cortexData.anomalies && cortexData.anomalies.length > 0) return null;

  const usdtBalance = walletState.usdtBalance || 0n;
  if (usdtBalance < IDLE_USDT_THRESHOLD) return null;

  return {
    strategy: 'YieldOptimize',
    action: 'supply',
    reason: `Idle USDT balance (${formatUsdt(usdtBalance)}) exceeds threshold. No anomalies detected — supplying to Aave for yield.`,
    priority: 3,
    params: {
      amount: usdtBalance,
      amountFormatted: formatUsdt(usdtBalance),
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
 * @returns {StrategyAction | null}
 */
function evaluateRebalance(_cortexData, walletState, lendingState) {
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
 *
 * @param {CortexData} cortexData
 * @param {WalletState} walletState
 * @param {LendingState} lendingState
 * @returns {{ action: StrategyAction | null, allResults: Array<{ name: string, result: StrategyAction | null }> }}
 */
export function runStrategies(cortexData, walletState, lendingState) {
  const allResults = STRATEGIES.map((s) => ({
    name: s.name,
    result: s.evaluate(cortexData, walletState, lendingState),
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
 *
 * @param {CortexData} cortexData
 * @param {WalletState} walletState
 * @param {LendingState} lendingState
 * @returns {StrategyAction | null}
 */
export function evaluateStateless(cortexData, walletState, lendingState) {
  const { action } = runStrategies(cortexData, walletState, lendingState);
  return action;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Format a USDT bigint (6 decimals) to a readable string. */
function formatUsdt(amount) {
  return `${(Number(amount) / 1e6).toFixed(2)} USDT`;
}

export { STRATEGIES, IDLE_USDT_THRESHOLD, HEALTH_FACTOR_TARGET, ANOMALY_ZSCORE_THRESHOLD };

export default {
  runStrategies,
  evaluateStateless,
  STRATEGIES,
};
