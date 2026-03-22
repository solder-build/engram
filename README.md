# Engram

> Autonomous DeFi treasury agent with persistent market memory -- powered by Cortex intelligence and Tether WDK self-custodial wallets.

**Track:** Autonomous DeFi Agent | **Hackathon:** Tether Hackathon Galactica: WDK Edition 1

## The Problem

Every DeFi agent has amnesia.

They check the market, make a decision, execute, and forget everything. Next tick, they start from zero. They don't know that the last time BTC spiked with a Z-score of 3.4, the market dropped 12% within the hour. They don't know that their yield optimization strategy failed three times in a row under similar conditions. They can't learn because they can't remember.

Engram doesn't forget.

## What It Does

Engram is an autonomous treasury management agent that monitors markets, detects anomalies, manages Aave V3 lending positions, and -- critically -- remembers every decision it has ever made and what happened afterward.

The core loop runs continuously:

```
Monitor --> Analyze (Cortex) --> Decide (Strategies) --> Execute (WDK) --> Record (Memory) --> Repeat
```

Each tick, the agent:

1. **Checks wallet balances** via Tether WDK (self-custodial, seed-phrase derived)
2. **Queries market conditions** from Cortex (trending markets, anomaly detection via Z-score analysis)
3. **Consults its memory** -- what did it do last time conditions looked like this? What was the outcome?
4. **Evaluates three strategies** against current state, picking the highest-priority action
5. **Executes via WDK** (supply, withdraw, or repay on Aave V3) or logs the decision in dry-run mode
6. **Records the decision** with full market context, so future ticks can learn from it

## Why Memory Matters

Here's the demo scenario that shows the difference:

**Tick 1:** Cortex detects a market anomaly (Z-score 3.4). Both a stateless agent and Engram trigger RiskOff -- withdraw from Aave. Same decision. No difference yet.

**Tick 2:** A similar anomaly appears on a different market (Z-score 2.9). The stateless agent evaluates from scratch, same as before. But Engram recalls: "In 1/1 similar past situations, the agent chose withdraw. Success rate: 100%." It makes the same decision, but faster and with higher confidence. The memory context is available for more sophisticated reasoning.

**Over time:** Engram builds a decision history. It tracks success/failure rates per strategy, per market condition. It finds patterns a stateless agent never could -- because a stateless agent can't look back.

This is the difference between a script and an agent.

## Architecture

```
                          +------------------+
                          |   Cron/Trigger   |
                          +--------+---------+
                                   |
                          +--------v---------+
                          |    Agent Loop     |
                          |   (agent.js)      |
                          +---+----+----+----+
                              |    |    |
               +--------------+    |    +--------------+
               |                   |                   |
      +--------v--------+ +-------v--------+ +--------v--------+
      |     Cortex       | |   Strategies   | |   Tether WDK    |
      | Market Intel +   | | RiskOff        | | Self-custodial  |
      | Anomaly Detect   | | YieldOptimize  | | EVM wallets     |
      | (cortex.js)      | | Rebalance      | | Aave V3 lending |
      +--------+---------+ | (strategies.js)| | (wallet.js +    |
               |           +-------+--------+ |  lending.js)    |
               |                   |           +--------+--------+
               |                   |                    |
               +----------+-------+--------------------+
                          |
                 +--------v---------+
                 |     Memory       |
                 | Decision history |
                 | Pattern matching |
                 | (memory.js)      |
                 +------------------+
```

## Strategies

| # | Strategy | Priority | Trigger | Action |
|---|----------|----------|---------|--------|
| 1 | **RiskOff** | 1 (highest) | Cortex detects anomaly with Z-score > 2.5 | Withdraw all from Aave to preserve capital |
| 2 | **Rebalance** | 2 | Aave health factor drops below 1.5 | Repay up to 25% of debt to improve position |
| 3 | **YieldOptimize** | 3 (lowest) | Idle USDT > 100 and no anomalies detected | Supply to Aave for yield |

The strategy engine evaluates all three each tick and picks the highest-priority non-null result. If nothing triggers, the agent holds.

## Tech Stack

| Component | What | Why |
|-----------|------|-----|
| [Tether WDK](https://github.com/ArcaTech-Labs/wdk) | `@tetherto/wdk`, `wdk-wallet-evm`, `wdk-protocol-lending-aave-evm` | Self-custodial wallet infrastructure. Seed-phrase derived, no third-party key custody. Direct Aave V3 integration via lending protocol module. |
| [Cortex](https://cortex.solder.build) | Market intelligence API | Prediction market data, trending analysis, and Z-score anomaly detection. Provides the "eyes" for the agent. |
| Aave V3 | DeFi lending protocol (Sepolia testnet) | Supply/withdraw/repay operations for treasury yield and risk management. |
| Node.js 24 | Runtime | ESM modules, native fetch, built-in test runner. |

## Quick Start

```bash
git clone <repo-url>
cd engram
npm install
```

### Run the Demo

The demo walks through 4 scenarios showing stateless vs. memory-equipped decision-making side by side. Best for video recordings and presentations.

```bash
node src/demo.js
```

### Run the Agent

```bash
# Single tick, demo mode (simulated data, no real transactions)
node src/index.js --demo --once

# Continuous loop, dry-run (real data, no execution)
node src/index.js --dry-run --interval=30

# Live mode (real transactions on Sepolia testnet)
node src/index.js --interval=30
```

### Configuration

Copy the example env file and edit as needed:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `ENGRAM_SEED_PHRASE` | *(auto-generated)* | BIP-39 seed phrase for wallet derivation |
| `ETH_SEPOLIA_RPC` | `https://rpc.sepolia.org` | Ethereum Sepolia RPC endpoint |
| `CORTEX_API_URL` | Cortex staging URL | Market intelligence API endpoint |
| `AGENT_INTERVAL` | `30` | Seconds between agent ticks |
| `AGENT_DRY_RUN` | `false` | Log decisions without executing |
| `AGENT_DEMO_MODE` | `false` | Use simulated market data |
| `IDLE_USDT_THRESHOLD` | `100` | USDT balance (in units) that triggers YieldOptimize |
| `HEALTH_FACTOR_TARGET` | `1.5` | Health factor below this triggers Rebalance |
| `ANOMALY_ZSCORE_THRESHOLD` | `2.5` | Z-score above this triggers RiskOff |

## Requirements

- Node.js >= 24
- npm

That's it. No database, no external services beyond the Cortex API (which gracefully degrades if unavailable). Docker is optional -- see the Docker section below for isolated execution.

## Project Structure

```
engram/
  src/
    index.js        # CLI entry point, arg parsing
    agent.js        # Core agent loop (tick orchestration)
    strategies.js   # RiskOff, YieldOptimize, Rebalance
    cortex.js       # Cortex API client + local anomaly detection
    wallet.js       # Tether WDK wallet manager
    lending.js      # Aave V3 lending operations via WDK
    memory.js       # Persistent decision history + pattern matching
    demo.js         # Side-by-side demo (memory vs. no memory)
  skills/
    wdk/            # WDK skill definition + chain references
    cortex/         # Cortex market intelligence skill
  openclaw-workspace/
    AGENTS.md       # Agent capabilities and workflows
    SOUL.md         # Agent personality and constraints
    ...             # Other OpenClaw workspace files
  data/
    memory.json     # Decision history (auto-created)
  Dockerfile        # Isolated container build
  docker-compose.yml # Service definitions
  .dockerignore
  .env.example      # Environment variable template
```

## Docker

Running Engram in Docker isolates wallet operations from host credentials (SSH keys, GCP creds, GitHub tokens). The container has no access to the host filesystem.

### Build

```bash
docker compose build
```

### Run the Agent (standalone loop)

```bash
# Single tick, demo mode (default)
docker compose run --rm engram-agent

# Single tick, dry-run with real data
docker compose run --rm engram-agent node src/index.js --dry-run --once

# Continuous loop
docker compose run --rm engram-agent node src/index.js --demo --interval=30
```

### Run OpenClaw Gateway Mode

The gateway binds to `127.0.0.1:18789` only (not exposed externally).

```bash
docker compose --profile openclaw up engram-openclaw
```

Then send messages to the agent:

```bash
openclaw agent --agent engram --message "Check my wallet balance" --gateway http://localhost:18789
```

### Environment Variables

Secrets (seed phrases, API keys) are passed via `.env` at runtime. They are never baked into the Docker image. Copy `.env.example` to `.env` and fill in values before running.

### Persistent Memory

The `data/` directory is volume-mounted into the container. Decision history in `data/memory.json` persists across container restarts.

### Security

- Non-root user (`engram`, uid 1001) inside the container
- Read-only root filesystem (writable tmpfs for `/tmp` only)
- All Linux capabilities dropped, `no-new-privileges` enforced
- No host network, no privileged mode
- Memory limited to 512MB, CPU limited to 1 core
- Seed phrases and secrets passed only via environment variables at runtime

## Limitations

I want to be upfront about what this is and isn't.

This is a hackathon MVP built in a few days. It works, it demonstrates the core thesis (memory makes agents better), and the architecture is sound. But:

- **Simulated market data in demo mode.** Cortex staging has limited prediction market coverage, so the demo uses hardcoded scenarios. The live agent connects to real Cortex APIs.
- **Sepolia testnet only.** The WDK lending module currently targets mainnet chain IDs for Aave. On Sepolia, we register the protocol manually and work around address mapping. Demo mode simulates execution.
- **3 strategies.** A production agent would have 10+ strategies covering more DeFi protocols, cross-chain arbitrage, gas optimization, etc.
- **Local JSON memory.** The `data/memory.json` file is simple and portable, but a production system would use Cortex's ClickHouse backend for queryable, persistent, cross-session memory.
- **No UI.** Terminal output only. A production version would have a dashboard showing decision history, strategy performance, and real-time position monitoring.
- **Deterministic by design.** The strategy engine uses auditable rule-based logic -- no LLM in the decision loop. For financial agents managing real capital, we believe deterministic rules with memory-adjusted thresholds are safer and more predictable than black-box LLM reasoning. You can trace exactly why Engram made every decision. The memory layer is designed to optionally feed into an LLM for more nuanced reasoning in a future version.

## How It's Different

Most hackathon agents are stateless pipelines: get data, run logic, execute, done. They're scripts with extra steps.

Engram's memory layer changes the game:

- **Decision recall** -- every action is recorded with full market context
- **Pattern matching** -- similar past conditions are found and their outcomes surfaced
- **Success tracking** -- the agent knows its own track record per strategy
- **Confidence building** -- repeated patterns get faster, better-informed responses

The memory is the moat. Everything else is plumbing.

## Built By

[Solder](https://solder.build) -- AI Agent Infrastructure

- **Cortex**: Market intelligence and persistent memory layer for AI agents
- **WDK Integration**: Self-custodial wallet operations via Tether's Wallet Development Kit

## License

MIT
