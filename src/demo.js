#!/usr/bin/env node

/**
 * Engram — Demo Script for Video
 *
 * Demonstrates the "money shot": agent WITH memory vs agent WITHOUT memory
 * facing the same market conditions makes different (better) decisions.
 *
 * Usage:
 *   node src/demo.js
 */

import 'dotenv/config';
import chalk from 'chalk';
import { runStrategies, evaluateStateless } from './strategies.js';
import memory from './memory.js';

const hr = () => console.log(chalk.gray('─'.repeat(72)));
const ts = () => chalk.gray(new Date().toISOString());
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Simulated market scenarios ────────────────────────────────────────

const SCENARIOS = [
  {
    name: 'Normal Market — Idle Capital',
    description: 'Markets are calm. The agent has 500 USDT sitting idle in the wallet.',
    market: {
      trending: [{ slug: 'btc-eoy-target', title: 'BTC EOY target' }],
      anomalies: [],
      timestamp: new Date().toISOString(),
    },
    wallet: {
      address: '0xEngram_Demo_001',
      ethBalance: 500000000000000000n,
      usdtBalance: 500_000000n, // 500 USDT
    },
    lending: {
      totalCollateral: '0.00',
      totalDebt: '0.00',
      healthFactor: 'N/A',
      ltv: '0.00%',
      availableBorrows: '0.00',
    },
  },
  {
    name: 'Market Anomaly Detected',
    description: 'Cortex detects a price spike (Z-score 3.4) on a major market. Agent has funds in Aave.',
    market: {
      trending: [{ slug: 'btc-eoy-target', title: 'BTC EOY target' }],
      anomalies: [
        {
          market: 'btc-eoy-target',
          anomalies: [
            { price: 102000, zScore: 3.4, timestamp: new Date().toISOString() },
          ],
          mean: 95000,
          stdDev: 2000,
          tradeCount: 1200,
        },
      ],
      timestamp: new Date().toISOString(),
    },
    wallet: {
      address: '0xEngram_Demo_001',
      ethBalance: 200000000000000000n,
      usdtBalance: 50_000000n, // 50 USDT
    },
    lending: {
      totalCollateral: '1500.00',
      totalDebt: '200.00',
      healthFactor: '2.50',
      ltv: '13.33%',
      availableBorrows: '800.00',
    },
  },
  {
    name: 'Same Anomaly Again (Memory Kicks In)',
    description: 'Similar anomaly pattern as before. Agent with memory recalls what happened last time.',
    market: {
      trending: [{ slug: 'eth-staking-yield', title: 'ETH staking yield' }],
      anomalies: [
        {
          market: 'eth-staking-yield',
          anomalies: [
            { price: 4200, zScore: 2.9, timestamp: new Date().toISOString() },
          ],
          mean: 3800,
          stdDev: 130,
          tradeCount: 950,
        },
      ],
      timestamp: new Date().toISOString(),
    },
    wallet: {
      address: '0xEngram_Demo_001',
      ethBalance: 200000000000000000n,
      usdtBalance: 1500_000000n, // 1500 USDT (from previous withdrawal)
    },
    lending: {
      totalCollateral: '500.00',
      totalDebt: '0.00',
      healthFactor: 'N/A',
      ltv: '0.00%',
      availableBorrows: '400.00',
    },
  },
  {
    name: 'Health Factor Crisis',
    description: 'Market dropped. Health factor at 1.12 — close to liquidation. Agent has USDT to repay.',
    market: {
      trending: [{ slug: 'market-crash-risk', title: 'Market crash risk' }],
      anomalies: [],
      timestamp: new Date().toISOString(),
    },
    wallet: {
      address: '0xEngram_Demo_001',
      ethBalance: 100000000000000000n,
      usdtBalance: 800_000000n, // 800 USDT
    },
    lending: {
      totalCollateral: '2000.00',
      totalDebt: '1600.00',
      healthFactor: '1.12',
      ltv: '80.00%',
      availableBorrows: '0.00',
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

  // Clear memory for clean demo
  await memory.clearMemory();
  console.log(ts(), chalk.dim('Memory cleared for fresh demo.\n'));

  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    await pause(1500);

    console.log(chalk.bold.white(`\n  SCENARIO ${i + 1}: ${scenario.name}`));
    console.log(chalk.gray(`  ${scenario.description}\n`));
    hr();

    // Show current state
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
        console.log(chalk.red(`    ! ${a.market}: Z-score ${a.anomalies[0].zScore}`));
      }
    }
    console.log('');

    await pause(1000);

    // ── Agent WITHOUT memory ──────────────────────────────────────
    console.log(chalk.bold.red('  Agent WITHOUT Memory:'));
    const statelessAction = evaluateStateless(
      scenario.market,
      scenario.wallet,
      scenario.lending
    );
    if (statelessAction) {
      console.log(chalk.red(`    Decision: ${statelessAction.strategy} → ${statelessAction.action}`));
      console.log(chalk.red(`    Reason:   ${statelessAction.reason}`));
    } else {
      console.log(chalk.red('    Decision: HOLD (no action)'));
      console.log(chalk.red('    Reason:   No strategy triggered.'));
    }
    console.log('');

    await pause(1000);

    // ── Agent WITH memory ─────────────────────────────────────────
    console.log(chalk.bold.green('  Agent WITH Memory (Engram):'));

    // Check memory for context
    const decisionCount = await memory.getDecisionCount();
    const comparison = await memory.compareWithHistory({
      hasAnomalies: scenario.market.anomalies.length > 0,
      healthFactor: parseFloat(scenario.lending.healthFactor) || null,
      idleUsdt: scenario.wallet.usdtBalance > 0n,
    });

    if (decisionCount > 0) {
      console.log(chalk.green(`    Memory: ${decisionCount} past decisions recalled`));
      console.log(chalk.green(`    Insight: ${comparison.recommendation}`));
    } else {
      console.log(chalk.green('    Memory: First run — no history yet'));
    }

    const { action } = runStrategies(
      scenario.market,
      scenario.wallet,
      scenario.lending
    );

    if (action) {
      console.log(chalk.green(`    Decision: ${action.strategy} → ${action.action}`));
      console.log(chalk.green(`    Reason:   ${action.reason}`));

      // Record this decision
      await memory.recordDecision(
        action.action,
        action.reason,
        scenario.market,
        'success',
        { strategy: action.strategy, ...action.params }
      );
    } else {
      console.log(chalk.green('    Decision: HOLD (no action)'));
      console.log(chalk.green('    Reason:   All strategies evaluated — position is healthy.'));
      await memory.recordDecision('hold', 'No action needed.', scenario.market, 'success', { strategy: 'none' });
    }

    console.log('');

    // ── Key difference ────────────────────────────────────────────
    if (i >= 2 && decisionCount > 0) {
      console.log(chalk.bold.magenta('  KEY DIFFERENCE:'));
      if (comparison.similar.length > 0) {
        const lastSimilar = comparison.similar[0];
        console.log(chalk.magenta(`    Last time in similar conditions (${lastSimilar.timestamp}):`));
        console.log(chalk.magenta(`      Action: ${lastSimilar.action} | Outcome: ${lastSimilar.outcome}`));
        console.log(chalk.magenta(`    The memory-equipped agent uses this to make faster, more confident decisions.`));
        console.log(chalk.magenta(`    A memoryless agent would react the same way every time — no learning.`));
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

  console.log('');
  console.log(chalk.bold.white('  Why Memory Matters:'));
  console.log(chalk.gray('    - Agent recalls that anomaly patterns preceded market drops'));
  console.log(chalk.gray('    - Past withdrawal decisions inform future risk thresholds'));
  console.log(chalk.gray('    - Repeated patterns get faster, more confident responses'));
  console.log(chalk.gray('    - Without memory, every tick starts from zero context'));
  console.log('');
  console.log(chalk.bold.cyan('  Built with: Tether WDK + Cortex Intelligence + Aave V3'));
  console.log(chalk.dim('  Engram — DeFi treasury that remembers.\n'));
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatEth(wei) {
  return `${(Number(wei) / 1e18).toFixed(4)} ETH`;
}

function formatUsdt(base) {
  return `${(Number(base) / 1e6).toFixed(2)} USDT`;
}

// ── Run ───────────────────────────────────────────────────────────────

runDemo().catch((err) => {
  console.error('Demo error:', err);
  process.exit(1);
});
