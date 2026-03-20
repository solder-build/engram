#!/usr/bin/env bash
# test-openclaw.sh — Verify OpenClaw can route to the Engram agent with both skills
#
# Prerequisites:
#   1. OpenClaw gateway running: openclaw gateway start
#   2. WDK + Cortex skills installed in ~/.openclaw/skills/
#   3. Engram agent registered: openclaw agents list (should show "engram")
#
# Usage:
#   ./scripts/test-openclaw.sh
#   ./scripts/test-openclaw.sh --local   # Run embedded (no gateway needed)

set -euo pipefail

LOCAL_FLAG=""
if [[ "${1:-}" == "--local" ]]; then
  LOCAL_FLAG="--local"
fi

echo "=== OpenClaw Engram Integration Test ==="
echo ""

# 1. Verify skills are installed
echo "[1/4] Checking installed skills..."
SKILLS_OUTPUT=$(openclaw skills list 2>/dev/null)
if echo "$SKILLS_OUTPUT" | grep -q "wdk"; then
  echo "  OK: WDK skill found"
else
  echo "  FAIL: WDK skill not found in ~/.openclaw/skills/"
  exit 1
fi

if echo "$SKILLS_OUTPUT" | grep -q "cortex-memory"; then
  echo "  OK: Cortex skill found"
else
  echo "  FAIL: Cortex skill not found in ~/.openclaw/skills/"
  exit 1
fi

# 2. Verify engram agent exists
echo ""
echo "[2/4] Checking Engram agent..."
AGENTS_OUTPUT=$(openclaw agents list 2>/dev/null)
if echo "$AGENTS_OUTPUT" | grep -q "engram"; then
  echo "  OK: Engram agent registered"
else
  echo "  FAIL: Engram agent not found. Run: openclaw agents add engram --workspace ~/.openclaw/agents/engram-workspace --model anthropic/claude-opus-4-5 --non-interactive"
  exit 1
fi

# 3. Check gateway health (skip if --local)
echo ""
echo "[3/4] Checking gateway health..."
if [[ -n "$LOCAL_FLAG" ]]; then
  echo "  SKIP: Running in --local mode (no gateway needed)"
else
  HEALTH_OUTPUT=$(openclaw health 2>/dev/null || true)
  if echo "$HEALTH_OUTPUT" | grep -q "Telegram"; then
    echo "  OK: Gateway responding"
  else
    echo "  WARN: Gateway may not be running. Start with: openclaw gateway start"
    echo "  Tip: Use --local flag to run without gateway"
  fi
fi

# 4. Send a test message to the Engram agent
echo ""
echo "[4/4] Sending test message to Engram agent..."
echo "  Message: 'What skills do you have available? List the WDK wallet operations and Cortex market intelligence capabilities.'"
echo ""

RESULT=$(openclaw agent \
  --agent engram \
  --message "What skills do you have available? List the WDK wallet operations and Cortex market intelligence capabilities." \
  --session-id "engram-test-$(date +%s)" \
  $LOCAL_FLAG \
  --json 2>&1) || {
    echo "  FAIL: Agent call failed. Is the gateway running?"
    echo "  Output: $RESULT"
    echo ""
    echo "  To start the gateway: openclaw gateway start"
    echo "  Or run with --local: ./scripts/test-openclaw.sh --local"
    exit 1
  }

echo "  Agent response:"
echo "$RESULT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    reply = data.get('reply', data.get('message', data.get('text', str(data))))
    print('  ' + reply[:500])
except:
    print('  ' + sys.stdin.read()[:500])
" 2>/dev/null || echo "$RESULT" | head -20

echo ""
echo "=== Test Complete ==="
