---
name: cortex-memory
description: Solder Cortex — persistent market memory and intelligence layer for AI agents. Provides market trend analysis, anomaly detection, volume profiling, and historical market memory search. Use when the agent needs to remember past market conditions, detect unusual activity, or make memory-informed decisions.
---

# Cortex Market Intelligence

Cortex is a persistent memory and market intelligence layer for AI agents. It connects to prediction markets and DeFi data sources, providing agents with the ability to remember, analyze, and learn from market conditions over time.

## API Base URL

**Staging:** `https://cortex-api-staging-871482515924.asia-southeast1.run.app`

## Available Endpoints

### Health Check
```
GET /health
```
Returns: `{ "status": "ok", "version": "0.1.0", "database": "connected" }`

### Prediction Markets

```
GET /api/v1/predictions/markets
```
List prediction markets. Query params: platform, category, status, limit.

```
GET /api/v1/predictions/markets/search?q={query}
```
Search markets by keyword.

```
GET /api/v1/predictions/markets/trending
```
Get trending markets (highest 24h volume).

```
GET /api/v1/predictions/markets/{slug}
```
Get specific market details.

```
GET /api/v1/predictions/markets/{slug}/trades
```
Get trades for a market.

### Wallet Analysis (Solana)

```
GET /api/v1/user/{wallet}/summary
```
Get wallet summary: total value, PnL, risk metrics, protocol exposure.

```
GET /api/v1/user/{wallet}/pnl?window={24h|7d|30d|all}
```
PnL breakdown by protocol.

```
GET /api/v1/user/{wallet}/positions
```
Current open positions across DeFi protocols.

## MCP Tools (via cortex-prediction-mcp)

These tools are available when Cortex runs as an MCP server:

### detect_anomalies
Find price spikes deviating significantly from the 1-hour moving average.
- `slug` (string, required): Market slug identifier
- `threshold` (number, optional): Standard deviation threshold (default: 3.0)

### get_market_trend
Query price movement over a specific timeframe. Returns OHLCV data, volume, and trend direction.
- `slug` (string, required): Market slug identifier
- `interval` (string, required): "1m", "5m", "15m", "30m", "1h", "4h", "24h", "7d"

### get_volume_profile
Get trading volume summary and liquidity depth. Includes 24h/7d volume, trade counts, order book metrics.
- `slug` (string, required): Market slug identifier

### search_market_memory
Search historical prediction markets by keyword.
- `query` (string, required): Search query
- `limit` (integer, optional): Max results (default: 10, max: 100)

## Usage Pattern for Autonomous Agents

1. **Monitor:** Periodically call `get_market_trend` and `detect_anomalies` for tracked markets
2. **Analyze:** Use `get_volume_profile` to assess liquidity before making moves
3. **Remember:** Use `search_market_memory` to find similar past conditions
4. **Decide:** Compare current conditions with historical memory to make informed decisions
5. **Record:** Store decisions back to memory for future reference
