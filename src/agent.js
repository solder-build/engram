/**
 * Engram — The Autonomous Agent Loop
 *
 * Orchestrates the entire decision cycle:
 *   1. Check wallet balances (WDK)
 *   2. Query market conditions (Cortex)
 *   3. Fetch decision history (Memory)
 *   4. Run strategies against current state
 *   5. If action needed: execute via WDK (or dry-run)
 *   6. Record decision to memory
 *   7. Log everything with timestamps
 */

import chalk from 'chalk';
import wallet from './wallet.js';
import cortex from './cortex.js';
import lending, { USDT_SEPOLIA } from './lending.js';
import { runStrategies } from './strategies.js';
import memory from './memory.js';

/**
 * @typedef {Object} AgentConfig
 * @property {number} interval - Seconds between ticks
 * @property {boolean} dryRun - Log actions without executing
 * @property {boolean} demoMode - Use simulated data
 * @property {boolean} once - Run a single tick then exit
 */

/** @param {string} msg */
const ts = (msg) => `${chalk.gray(new Date().toISOString())} ${msg}`;

/**
 * Run a single agent tick — the full decision cycle.
 *
 * @param {AgentConfig} config
 * @returns {Promise<{ action: any, decision: any }>}
 */
export async function tick(config) {
  const { dryRun, demoMode } = config;

  console.log(ts(chalk.bold.cyan('--- Engram Tick ---')));

  // ── 1. Wallet state ─────────────────────────────────────────────
  console.log(ts(chalk.yellow('Checking wallet balances...')));
  let walletState;
  if (demoMode) {
    walletState = getDemoWalletState();
  } else {
    walletState = await wallet.getWalletState();
    // Try to get USDT balance
    try {
      walletState.usdtBalance = await wallet.getTokenBalance(USDT_SEPOLIA);
    } catch {
      walletState.usdtBalance = 0n;
    }
  }
  console.log(ts(`  Address: ${chalk.white(walletState.address)}`));
  console.log(ts(`  ETH:     ${chalk.white(formatEth(walletState.ethBalance))}`));
  console.log(ts(`  USDT:    ${chalk.white(formatUsdt(walletState.usdtBalance || 0n))}`));

  // ── 2. Market conditions (Cortex + DeFi data) ──────────────────
  console.log(ts(chalk.yellow('Querying market conditions (Cortex + DeFi)...')));
  let marketConditions;
  if (demoMode) {
    marketConditions = getDemoMarketConditions();
  } else {
    marketConditions = await cortex.getMarketConditionsEnhanced();
  }
  console.log(ts(`  Trending markets: ${chalk.white(marketConditions.trending.length)}`));
  console.log(ts(`  Anomalies found:  ${chalk.white(marketConditions.anomalies.length)}`));
  if (marketConditions.anomalies.length > 0) {
    for (const a of marketConditions.anomalies) {
      const source = a.source ? ` [${a.source}]` : '';
      console.log(ts(`    ${chalk.red('!')} ${a.market}: ${a.anomalies.length} anomalous trades${source}`));
    }
  }
  // Show DeFi data if available
  if (marketConditions.defi) {
    const peg = marketConditions.defi.usdtPeg;
    const gas = marketConditions.defi.gas;
    const pegColor = peg.depegRisk ? chalk.red : chalk.green;
    console.log(ts(`  USDT peg: ${pegColor(`$${peg.price.toFixed(4)}`)} (deviation: ${(peg.deviation * 100).toFixed(2)}%)`));
    console.log(ts(`  Gas: ${gas.isExpensive ? chalk.red(gas.gasGwei + ' gwei') : chalk.green(gas.gasGwei + ' gwei')}`));
  }

  // ── 3. Lending state ────────────────────────────────────────────
  console.log(ts(chalk.yellow('Fetching Aave account data...')));
  let lendingState;
  if (demoMode) {
    lendingState = getDemoLendingState();
  } else {
    lendingState = await lending.getAccountSummary();
  }
  console.log(ts(`  Collateral:    $${chalk.white(lendingState.totalCollateral)}`));
  console.log(ts(`  Debt:          $${chalk.white(lendingState.totalDebt)}`));
  console.log(ts(`  Health Factor: ${colorHealthFactor(lendingState.healthFactor)}`));

  // ── 4. Memory context ──────────────────────────────────────────
  console.log(ts(chalk.yellow('Consulting decision memory...')));
  const memoryContext = await memory.getMemoryContext();
  const decisionCount = await memory.getDecisionCount();
  console.log(ts(`  Decisions in memory: ${chalk.white(decisionCount)}`));

  // Compare with history — returns actionable adjustments for strategies
  const memoryInsight = await memory.compareWithHistory({
    hasAnomalies: marketConditions.anomalies.length > 0,
    healthFactor: parseFloat(lendingState.healthFactor) || null,
    idleUsdt: (walletState.usdtBalance || 0n) > 0n,
  });
  if (memoryInsight.recommendation) {
    console.log(ts(`  Memory says: ${chalk.italic(memoryInsight.recommendation)}`));
  }
  // Show active memory adjustments
  const adj = memoryInsight.adjustments;
  if (adj.zScoreModifier !== 0) {
    console.log(ts(`  ${chalk.yellow('↳ Z-score threshold adjusted by')} ${chalk.bold(adj.zScoreModifier.toFixed(1))}`));
  }
  if (adj.yieldCooldown) {
    console.log(ts(`  ${chalk.yellow('↳ Supply cooldown ACTIVE')} (recent churn detected)`));
  }
  if (adj.skipSupply) {
    console.log(ts(`  ${chalk.red('↳ Supply BLOCKED')} (recent failed supply)`));
  }

  // ── 5. Run strategies (with memory adjustments) ────────────────
  console.log(ts(chalk.yellow('Evaluating strategies...')));
  const { action, allResults } = runStrategies(marketConditions, walletState, lendingState, memoryInsight.adjustments);

  for (const r of allResults) {
    const status = r.result ? chalk.green('TRIGGERED') : chalk.gray('no action');
    console.log(ts(`  ${r.name}: ${status}`));
    if (r.result) {
      console.log(ts(`    ${chalk.italic(r.result.reason)}`));
    }
  }

  // ── 6. Execute or dry-run ──────────────────────────────────────
  let decision = null;

  if (!action) {
    console.log(ts(chalk.green('No action needed. Holding current position.')));
    decision = await memory.recordDecision('hold', 'All strategies evaluated — no action required.', marketConditions, 'success', { strategy: 'none' });
  } else if (dryRun) {
    console.log(ts(chalk.magenta(`[DRY RUN] Would execute: ${action.strategy}/${action.action}`)));
    console.log(ts(chalk.magenta(`  Reason: ${action.reason}`)));
    decision = await memory.recordDecision(action.action, `[DRY RUN] ${action.reason}`, marketConditions, 'dry-run', { strategy: action.strategy, ...action.params });
  } else if (demoMode) {
    console.log(ts(chalk.magenta(`[DEMO] Simulated execution: ${action.strategy}/${action.action}`)));
    console.log(ts(chalk.magenta(`  Reason: ${action.reason}`)));
    decision = await memory.recordDecision(action.action, action.reason, marketConditions, 'success', { strategy: action.strategy, ...action.params });
    console.log(ts(chalk.green('Simulated action completed.')));
  } else {
    console.log(ts(chalk.bold.green(`Executing: ${action.strategy}/${action.action}`)));
    console.log(ts(`  Reason: ${action.reason}`));

    try {
      await executeAction(action);
      decision = await memory.recordDecision(action.action, action.reason, marketConditions, 'success', { strategy: action.strategy, ...action.params });
      console.log(ts(chalk.green('Action executed successfully.')));
    } catch (err) {
      console.log(ts(chalk.red(`Execution failed: ${err.message}`)));
      decision = await memory.recordDecision(action.action, action.reason, marketConditions, `failed: ${err.message}`, { strategy: action.strategy, ...action.params });
    }
  }

  console.log(ts(chalk.bold.cyan('--- Tick Complete ---\n')));
  return { action, decision };
}

/**
 * Execute a strategy action via WDK.
 *
 * @param {import('./strategies.js').StrategyAction} action
 */
async function executeAction(action) {
  switch (action.action) {
    case 'withdraw': {
      // Withdraw all from Aave
      const maxUint = 2n ** 256n - 1n; // type(uint256).max = withdraw all
      await lending.withdraw({ token: USDT_SEPOLIA, amount: maxUint });
      break;
    }
    case 'supply': {
      // Approve then supply to Aave
      const amount = action.params.amount;
      const aavePool = lending.AAVE_SEPOLIA.POOL;
      await wallet.approve({ token: USDT_SEPOLIA, spender: aavePool, amount });
      await lending.supply({ token: USDT_SEPOLIA, amount });
      break;
    }
    case 'repay': {
      const amount = action.params.amount;
      const aavePool = lending.AAVE_SEPOLIA.POOL;
      await wallet.approve({ token: USDT_SEPOLIA, spender: aavePool, amount });
      await lending.repay({ token: USDT_SEPOLIA, amount });
      break;
    }
    case 'alert': {
      console.log(chalk.bgRed.white(' ALERT '), action.reason);
      break;
    }
    case 'hold':
    default:
      // Nothing to execute
      break;
  }
}

/**
 * Start the agent loop.
 *
 * @param {AgentConfig} config
 */
export async function startAgent(config) {
  console.log(chalk.bold.cyan('\n=== Engram — Autonomous DeFi Treasury Agent ==='));
  console.log(chalk.gray(`Mode: ${config.demoMode ? 'DEMO' : config.dryRun ? 'DRY RUN' : 'LIVE'}`));
  console.log(chalk.gray(`Interval: ${config.interval}s`));
  console.log('');

  // Initialize wallet
  const { seed } = wallet.createWallet();
  const masked = seed.split(' ').slice(0, 2).join(' ') + ' ... ' + seed.split(' ').slice(-1)[0];
  console.log(ts(`Wallet initialized (${chalk.dim(masked)})`));

  const address = await wallet.getAddress('ethereum-sepolia');
  console.log(ts(`ETH Sepolia address: ${chalk.white(address)}`));
  console.log('');

  if (config.once) {
    await tick(config);
    return;
  }

  // Continuous loop
  let running = true;
  const shutdown = () => {
    running = false;
    console.log(ts(chalk.yellow('\nShutting down gracefully...')));
    wallet.dispose();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (running) {
    try {
      await tick(config);
    } catch (err) {
      console.log(ts(chalk.red(`Tick error: ${err.message}`)));
    }
    // Wait for next interval
    await new Promise((r) => setTimeout(r, config.interval * 1000));
  }
}

// ── Demo data generators ──────────────────────────────────────────────

let demoTick = 0;

function getDemoWalletState() {
  demoTick++;
  return {
    address: '0xEngram_Demo_0x1234...abcd',
    ethBalance: 500000000000000000n, // 0.5 ETH
    usdtBalance: demoTick % 3 === 0 ? 0n : 500_000000n, // 500 USDT sometimes, 0 other times
    chain: 'ethereum-sepolia',
  };
}

function getDemoMarketConditions() {
  // Alternate between normal and anomalous conditions
  if (demoTick % 4 === 0) {
    return {
      trending: [
        { slug: 'btc-100k-march', title: 'BTC to $100K by March' },
        { slug: 'eth-merge-success', title: 'ETH staking yield > 5%' },
      ],
      anomalies: [
        {
          market: 'btc-100k-march',
          anomalies: [
            { price: 98500, zScore: 3.2, timestamp: new Date().toISOString() },
            { price: 97800, zScore: -2.8, timestamp: new Date().toISOString() },
          ],
          mean: 95000,
          stdDev: 1100,
          tradeCount: 847,
        },
      ],
      timestamp: new Date().toISOString(),
    };
  }

  return {
    trending: [
      { slug: 'btc-100k-march', title: 'BTC to $100K by March' },
      { slug: 'eth-merge-success', title: 'ETH staking yield > 5%' },
    ],
    anomalies: [],
    timestamp: new Date().toISOString(),
  };
}

function getDemoLendingState() {
  if (demoTick % 5 === 0) {
    return {
      totalCollateral: '1250.00',
      totalDebt: '950.00',
      healthFactor: '1.15',
      ltv: '76.00%',
      availableBorrows: '50.00',
    };
  }

  return {
    totalCollateral: '1250.00',
    totalDebt: '400.00',
    healthFactor: '2.80',
    ltv: '32.00%',
    availableBorrows: '600.00',
  };
}

// ── Formatting helpers ────────────────────────────────────────────────

function formatEth(wei) {
  return `${(Number(wei) / 1e18).toFixed(6)} ETH`;
}

function formatUsdt(base) {
  return `${(Number(base) / 1e6).toFixed(2)} USDT`;
}

function colorHealthFactor(hf) {
  const n = parseFloat(hf);
  if (isNaN(n) || hf === 'N/A') return chalk.gray('N/A');
  if (n < 1.2) return chalk.red(hf);
  if (n < 1.5) return chalk.yellow(hf);
  return chalk.green(hf);
}

export default { tick, startAgent };
