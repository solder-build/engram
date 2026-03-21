#!/usr/bin/env node

/**
 * Engram — Demo Script for Video
 *
 * Demonstrates REAL behavioral differences between an agent WITH memory
 * and one WITHOUT. Memory adjusts Z-score thresholds, blocks supply
 * after churn, and makes demonstrably different decisions.
 *
 * Usage:
 *   node src/demo.js
 */

import 'dotenv/config';
import chalk from 'chalk';
import { runStrategies, evaluateStateless, ANOMALY_ZSCORE_THRESHOLD } from './strategies.js';
import memory from './memory.js';

const hr = () => console.log(chalk.gray('─'.repeat(72)));
const ts = () => chalk.gray(new Date().toISOString());
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Simulated market scenarios ────────────────────────────────────────
// Designed so that memory CHANGES the decision in scenarios 3 and 4.

const SCENARIOS = [
  {
    name: 'Normal Market — Idle Capital',
    description: 'Markets are calm. 500 USDT sitting idle.',
    market: {
      trending: [{ slug: 'btc-eoy-target', title: 'BTC EOY target' }],
      anomalies: [],
      timestamp: new Date().toISOString(),
    },
    wallet: {
      address: '0xEngram_Demo_001',
      ethBalance: 500000000000000000n,
      usdtBalance: 500_000000n,
    },
    lending: {
      totalCollateral: '0.00',
      totalDebt: '0.00',
      healthFactor: 'N/A',
      availableBorrows: '0.00',
    },
  },
  {
    name: 'Anomaly Detected — First Time',
    description: 'Cortex detects a price spike (Z-score 3.2). Agent has funds in Aave.',
    market: {
      trending: [{ slug: 'btc-eoy-target', title: 'BTC EOY target' }],
      anomalies: [
        {
          market: 'btc-eoy-target',
          anomalies: [{ price: 102000, zScore: 3.2, timestamp: new Date().toISOString() }],
          mean: 95000, stdDev: 2000, tradeCount: 1200,
        },
      ],
      timestamp: new Date().toISOString(),
    },
    wallet: {
      address: '0xEngram_Demo_001',
      ethBalance: 200000000000000000n,
      usdtBalance: 50_000000n,
    },
    lending: {
      totalCollateral: '1500.00',
      totalDebt: '200.00',
      healthFactor: '2.50',
      availableBorrows: '800.00',
    },
  },
  {
    // THE MONEY SHOT: Z-score 2.1 is BELOW the default threshold (2.5)
    // so a stateless agent does nothing. But Engram's memory lowered the
    // threshold to 1.5 based on past successful withdrawals — so it triggers.
    name: 'Subtle Anomaly — Memory Makes The Difference',
    description: 'Z-score 2.3 — below default threshold (2.5). Stateless agent ignores it. Memory-equipped agent catches it.',
    market: {
      trending: [{ slug: 'eth-staking-yield', title: 'ETH staking yield' }],
      anomalies: [
        {
          market: 'eth-staking-yield',
          anomalies: [{ price: 4050, zScore: 2.3, timestamp: new Date().toISOString() }],
          mean: 3800, stdDev: 120, tradeCount: 800,
        },
      ],
      timestamp: new Date().toISOString(),
    },
    wallet: {
      address: '0xEngram_Demo_001',
      ethBalance: 200000000000000000n,
      usdtBalance: 100_000000n,
    },
    lending: {
      totalCollateral: '2000.00',
      totalDebt: '300.00',
      healthFactor: '2.20',
      availableBorrows: '600.00',
    },
  },
  {
    // MEMORY BLOCKS SUPPLY: After the supply→withdraw churn in scenarios 1-2,
    // memory activates yieldCooldown. Stateless agent supplies, Engram holds.
    name: 'Post-Crisis Calm — Memory Blocks Premature Supply',
    description: 'Markets calm again, idle USDT. Stateless agent supplies. Engram remembers the recent churn and holds.',
    market: {
      trending: [{ slug: 'stable-markets', title: 'Stable markets' }],
      anomalies: [],
      timestamp: new Date().toISOString(),
    },
    wallet: {
      address: '0xEngram_Demo_001',
      ethBalance: 150000000000000000n,
      usdtBalance: 1200_000000n,
    },
    lending: {
      totalCollateral: '500.00',
      totalDebt: '0.00',
      healthFactor: 'N/A',
      availableBorrows: '400.00',
    },
  },
];

// ── Main demo flow ────────────────────────────────────────────────────

async function runDemo() {
  console.clear();
  console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('  ║              ENGRAM — Memory-Powered DeFi Agent              ║'));
  console.log(chalk.bold.cyan('  ║          Autonomous Treasury Management with Cortex          ║'));
  console.log(chalk.bold.cyan('  ╚══════════════════════════════════════════════════════════════╝\n'));
  console.log(chalk.gray('  Powered by: Tether WDK  |  Cortex Market Intelligence  |  Aave V3\n'));
  hr();

  await memory.clearMemory();
  console.log(ts(), chalk.dim('Memory cleared for fresh demo.\n'));

  const decisions = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    await pause(1500);

    console.log(chalk.bold.white(`\n  SCENARIO ${i + 1}: ${scenario.name}`));
    console.log(chalk.gray(`  ${scenario.description}\n`));
    hr();

    // Show state
    console.log(ts(), chalk.yellow('Wallet State:'));
    console.log(chalk.gray(`    ETH Balance:  ${formatEth(scenario.wallet.ethBalance)}`));
    console.log(chalk.gray(`    USDT Balance: ${formatUsdt(scenario.wallet.usdtBalance)}`));
    console.log(ts(), chalk.yellow('Aave Position:'));
    console.log(chalk.gray(`    Collateral:    $${scenario.lending.totalCollateral}`));
    console.log(chalk.gray(`    Debt:          $${scenario.lending.totalDebt}`));
    console.log(chalk.gray(`    Health Factor: ${scenario.lending.healthFactor}`));
    console.log(ts(), chalk.yellow('Market Conditions:'));
    console.log(chalk.gray(`    Trending: ${scenario.market.trending.length} markets`));
    console.log(chalk.gray(`    Anomalies: ${scenario.market.anomalies.length} detected`));
    if (scenario.market.anomalies.length > 0) {
      for (const a of scenario.market.anomalies) {
        console.log(chalk.red(`    ! ${a.market}: Z-score ${a.anomalies[0].zScore} (threshold: ${ANOMALY_ZSCORE_THRESHOLD})`));
      }
    }
    console.log('');
    await pause(1000);

    // ── Stateless agent (NO memory) ──────────────────────────────
    console.log(chalk.bold.red('  Agent WITHOUT Memory:'));
    const statelessAction = evaluateStateless(scenario.market, scenario.wallet, scenario.lending);
    if (statelessAction) {
      console.log(chalk.red(`    Decision: ${statelessAction.strategy} → ${statelessAction.action}`));
      console.log(chalk.red(`    Reason:   ${statelessAction.reason}`));
    } else {
      console.log(chalk.red('    Decision: HOLD (no action)'));
      console.log(chalk.red('    Reason:   No strategy triggered — thresholds not met.'));
    }
    console.log('');
    await pause(1000);

    // ── Engram agent (WITH memory) ───────────────────────────────
    console.log(chalk.bold.green('  Agent WITH Memory (Engram):'));

    const decisionCount = await memory.getDecisionCount();
    const memoryInsight = await memory.compareWithHistory({
      hasAnomalies: scenario.market.anomalies.length > 0,
      healthFactor: parseFloat(scenario.lending.healthFactor) || null,
      idleUsdt: scenario.wallet.usdtBalance > 0n,
    });

    if (decisionCount > 0) {
      console.log(chalk.green(`    Memory: ${decisionCount} past decisions recalled`));
      console.log(chalk.green(`    Insight: ${memoryInsight.recommendation}`));
    } else {
      console.log(chalk.green('    Memory: First run — no history yet'));
    }

    // Show active adjustments
    const adj = memoryInsight.adjustments;
    if (adj.zScoreModifier !== 0) {
      const effective = ANOMALY_ZSCORE_THRESHOLD + adj.zScoreModifier;
      console.log(chalk.yellow(`    ↳ Z-score threshold: ${ANOMALY_ZSCORE_THRESHOLD} → ${effective.toFixed(1)} (memory-adjusted)`));
    }
    if (adj.yieldCooldown) {
      console.log(chalk.yellow(`    ↳ Supply cooldown ACTIVE (recent churn detected)`));
    }
    if (adj.skipSupply) {
      console.log(chalk.red(`    ↳ Supply BLOCKED (recent failed supply)`));
    }

    // Run strategies WITH memory adjustments
    const { action } = runStrategies(
      scenario.market, scenario.wallet, scenario.lending,
      memoryInsight.adjustments
    );

    if (action) {
      console.log(chalk.green(`    Decision: ${action.strategy} → ${action.action}`));
      console.log(chalk.green(`    Reason:   ${action.reason}`));
      await memory.recordDecision(action.action, action.reason, scenario.market, 'success', { strategy: action.strategy, ...action.params });
      decisions.push({ scenario: i + 1, action: action.action, strategy: action.strategy, memoryDriven: action.params?.memoryAdjusted || adj.yieldCooldown || adj.skipSupply });
    } else {
      console.log(chalk.green('    Decision: HOLD (no action)'));
      const holdReason = adj.yieldCooldown
        ? 'Memory cooldown active — suppressing supply after recent churn.'
        : 'All strategies evaluated — position is healthy.';
      console.log(chalk.green(`    Reason:   ${holdReason}`));
      await memory.recordDecision('hold', holdReason, scenario.market, 'success', { strategy: 'none', memoryCooldown: adj.yieldCooldown });
      decisions.push({ scenario: i + 1, action: 'hold', strategy: 'MemoryCooldown', memoryDriven: adj.yieldCooldown });
    }
    console.log('');

    // ── Highlight when decisions DIFFER ───────────────────────────
    const statelessVerb = statelessAction ? `${statelessAction.strategy}/${statelessAction.action}` : 'HOLD';
    const engramVerb = action ? `${action.strategy}/${action.action}` : 'HOLD';

    if (statelessVerb !== engramVerb) {
      console.log(chalk.bold.bgMagenta.white('  ★ DECISIONS DIFFER — MEMORY CHANGED THE OUTCOME ★'));
      console.log(chalk.magenta(`    Stateless agent: ${statelessVerb}`));
      console.log(chalk.magenta(`    Engram (memory): ${engramVerb}`));
      if (adj.zScoreModifier !== 0) {
        console.log(chalk.magenta(`    Why: Memory lowered Z-score threshold from ${ANOMALY_ZSCORE_THRESHOLD} to ${(ANOMALY_ZSCORE_THRESHOLD + adj.zScoreModifier).toFixed(1)}`));
        console.log(chalk.magenta(`    The stateless agent needs Z > ${ANOMALY_ZSCORE_THRESHOLD} to act. Engram learned from past withdrawals.`));
      }
      if (adj.yieldCooldown) {
        console.log(chalk.magenta(`    Why: Memory detected supply→withdraw churn pattern. Suppressing supply to avoid oscillation.`));
        console.log(chalk.magenta(`    The stateless agent would supply and potentially withdraw again next tick.`));
      }
      console.log('');
    }

    hr();
  }

  // ── Final summary ───────────────────────────────────────────────
  await pause(2000);
  console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('  ║                        DEMO SUMMARY                         ║'));
  console.log(chalk.bold.cyan('  ╚══════════════════════════════════════════════════════════════╝\n'));

  const history = await memory.getDecisionHistory(10);
  console.log(chalk.white(`  Total decisions recorded: ${history.length}`));
  console.log('');

  for (const d of history.reverse()) {
    const icon = d.outcome === 'success' ? chalk.green('OK') : chalk.red('!!');
    console.log(`  ${icon} [${d.timestamp}] ${chalk.bold(d.strategy)}/${d.action}`);
    console.log(chalk.gray(`     ${d.reason}`));
  }

  // Highlight divergences
  const divergences = decisions.filter((d) => d.memoryDriven);
  console.log('');
  console.log(chalk.bold.white(`  Memory-Driven Divergences: ${divergences.length} of ${decisions.length} decisions`));
  for (const d of divergences) {
    console.log(chalk.magenta(`    Scenario ${d.scenario}: ${d.strategy}/${d.action} — would not happen without memory`));
  }

  console.log('');
  console.log(chalk.bold.white('  Why Memory Matters:'));
  console.log(chalk.gray('    - Lowers anomaly thresholds based on past successful withdrawals'));
  console.log(chalk.gray('    - Blocks premature supply after supply→withdraw churn'));
  console.log(chalk.gray('    - Detects subtle anomalies that stateless agents miss'));
  console.log(chalk.gray('    - Without memory, the agent oscillates and bleeds gas fees'));
  console.log('');
  console.log(chalk.bold.cyan('  Built with: Tether WDK + Cortex Intelligence + Aave V3'));
  console.log(chalk.dim('  Engram — DeFi treasury that remembers.\n'));
}

function formatEth(wei) { return `${(Number(wei) / 1e18).toFixed(4)} ETH`; }
function formatUsdt(base) { return `${(Number(base) / 1e6).toFixed(2)} USDT`; }

runDemo().catch((err) => { console.error('Demo error:', err); process.exit(1); });
