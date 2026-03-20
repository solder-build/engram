# Engram OpenClaw Integration

OpenClaw agent integration for Engram, providing autonomous treasury management through WDK (wallet operations) and Cortex (market intelligence).

## Prerequisites

- OpenClaw 2026.2.1+ installed globally (`openclaw --version`)
- OpenClaw configured at `~/.openclaw/`
- Anthropic API key configured in OpenClaw auth profiles

## What's Installed

### Skills (in `~/.openclaw/skills/`)

| Skill | Directory | Capabilities |
|-------|-----------|-------------|
| **wdk** | `~/.openclaw/skills/wdk/` | Multi-chain wallet: create, balance, transfer, swap, bridge, lend. Chains: BTC, EVM, Solana, TON, TRON, Spark. |
| **cortex-memory** | `~/.openclaw/skills/cortex/` | Market intelligence: trend analysis, anomaly detection, volume profiling, historical memory search. |

### Agent

| Agent | Workspace | Model |
|-------|-----------|-------|
| **engram** | `~/.openclaw/agents/engram-workspace/` | anthropic/claude-opus-4-5 |

The Engram agent has its own isolated workspace with AGENTS.md (capabilities + workflows) and SOUL.md (personality + constraints).

## Usage

### Start the Gateway

The gateway must be running for non-local agent calls:

```bash
openclaw gateway start
```

Check health:

```bash
openclaw health
```

### Send Messages to Engram

```bash
# Via gateway (must be running)
openclaw agent --agent engram --message "Check my Solana wallet balance and current market conditions"

# Via embedded mode (no gateway needed, uses local API keys)
openclaw agent --agent engram --message "Check my Solana wallet balance" --local

# With JSON output
openclaw agent --agent engram --message "Detect anomalies for bitcoin-2024-election" --json

# With explicit session tracking
openclaw agent --agent engram --session-id "treasury-review-20260320" --message "Full treasury health check"
```

### Example Prompts

**Wallet operations (WDK skill):**
```
"Check my EVM wallet balance on Ethereum mainnet"
"Quote a transfer of 100 USDT to 0x123... on Ethereum"
"What chains does WDK support?"
```

**Market intelligence (Cortex skill):**
```
"Detect anomalies in the bitcoin-2024-election market"
"Get the 24h trend for ethereum-merge"
"Search market memory for similar conditions to current BTC volatility"
```

**Combined treasury management:**
```
"Full treasury health check — balances across all chains plus market conditions"
"Should I rebalance? Check my positions and current market trends"
"Alert: is there anything unusual in the markets I'm exposed to?"
```

### Run the Test Script

```bash
# With gateway running
./scripts/test-openclaw.sh

# Without gateway (embedded mode)
./scripts/test-openclaw.sh --local
```

The test verifies:
1. WDK and Cortex skills are installed
2. Engram agent is registered
3. Gateway is healthy (unless --local)
4. Agent can receive and respond to messages

## Architecture

```
~/.openclaw/
  openclaw.json              # Global config (gateway, auth, plugins)
  skills/
    wdk/                     # Wallet Development Kit skill
      SKILL.md               # Skill definition + security rules
      references/            # Chain-specific and protocol-specific docs
    cortex/                  # Cortex Market Intelligence skill
      SKILL.md               # Skill definition + API endpoints
  agents/
    main/                    # Default agent
    engram/                  # Engram agent state
      agent/
    engram-workspace/        # Engram agent workspace
      AGENTS.md              # Agent capabilities and workflows
      SOUL.md                # Agent personality and constraints
```

Skills are global — all agents can access them. The Engram agent's workspace (AGENTS.md, SOUL.md) tells it how to combine WDK + Cortex for treasury management.

## Updating Skills

To update skills after editing source files in the Engram project:

```bash
# Re-copy from source
cp -r ~/rick_quantum3labs_com/dev/engram/skills/wdk/ ~/.openclaw/skills/wdk/
cp -r ~/rick_quantum3labs_com/dev/engram/skills/cortex/ ~/.openclaw/skills/cortex/

# Verify
openclaw skills list | grep -E "wdk|cortex"
```

## Security Notes

- The WDK skill enforces human confirmation for all write operations (transfers, swaps, etc.)
- The agent will always quote fees before proposing execution
- Private keys and seed phrases are never logged or exposed
- Cortex API calls are read-only market intelligence queries
- The gateway runs on loopback (localhost only) by default
