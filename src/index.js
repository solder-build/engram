#!/usr/bin/env node

/**
 * Engram — Entry Point
 *
 * Usage:
 *   node src/index.js                     # Run live agent loop
 *   node src/index.js --dry-run           # Show decisions without executing
 *   node src/index.js --demo              # Simulated demo data
 *   node src/index.js --once              # Single tick then exit
 *   node src/index.js --interval=10       # Custom tick interval (seconds)
 *   node src/index.js --demo --once       # Single demo tick
 */

import 'dotenv/config';
import { startAgent } from './agent.js';

// ── Parse CLI args ────────────────────────────────────────────────────

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function getFlagValue(name, defaultValue) {
  const prefix = `--${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : defaultValue;
}

const config = {
  interval: parseInt(getFlagValue('interval', process.env.AGENT_INTERVAL || '30'), 10),
  dryRun: hasFlag('dry-run') || process.env.AGENT_DRY_RUN === 'true',
  demoMode: hasFlag('demo') || process.env.AGENT_DEMO_MODE === 'true',
  once: hasFlag('once'),
};

// ── Graceful shutdown ─────────────────────────────────────────────────

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});

// ── Go ────────────────────────────────────────────────────────────────

startAgent(config).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
