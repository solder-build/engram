# Engram — Autonomous DeFi Treasury Agent
# Isolated container for running wallet-managing agents away from host credentials

FROM node:24-slim AS base

# Install dumb-init for proper signal handling
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    git \
    ca-certificates \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Configure git to use HTTPS (some npm deps use git:// protocol)
RUN git config --global url."https://github.com/".insteadOf git@github.com: && \
    git config --global url."https://github.com/".insteadOf ssh://git@github.com/ && \
    git config --global url."https://".insteadOf git://

# Install OpenClaw globally
RUN npm install -g openclaw@latest

# Create non-root user
RUN groupadd --gid 1001 engram && \
    useradd --uid 1001 --gid engram --shell /bin/bash --create-home engram

# Set up OpenClaw directory structure owned by engram user
RUN mkdir -p /home/engram/.openclaw/skills/wdk \
             /home/engram/.openclaw/skills/cortex \
             /home/engram/.openclaw/agents/engram-workspace \
             /home/engram/.openclaw/agents/engram/sessions

# App directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source
COPY src/ ./src/
COPY scripts/ ./scripts/

# Copy skills into OpenClaw directories
COPY skills/wdk/ /home/engram/.openclaw/skills/wdk/
COPY skills/cortex/ /home/engram/.openclaw/skills/cortex/

# Copy OpenClaw workspace files for the engram agent
# These define the agent's identity, capabilities, and personality
COPY openclaw-workspace/AGENTS.md /home/engram/.openclaw/agents/engram-workspace/
COPY openclaw-workspace/SOUL.md /home/engram/.openclaw/agents/engram-workspace/
COPY openclaw-workspace/BOOTSTRAP.md /home/engram/.openclaw/agents/engram-workspace/
COPY openclaw-workspace/IDENTITY.md /home/engram/.openclaw/agents/engram-workspace/
COPY openclaw-workspace/TOOLS.md /home/engram/.openclaw/agents/engram-workspace/
COPY openclaw-workspace/USER.md /home/engram/.openclaw/agents/engram-workspace/
COPY openclaw-workspace/HEARTBEAT.md /home/engram/.openclaw/agents/engram-workspace/

# Initialize git repo in workspace (OpenClaw expects it)
RUN cd /home/engram/.openclaw/agents/engram-workspace && \
    git init && \
    git config user.email "engram@solder.build" && \
    git config user.name "Engram Agent" && \
    git add -A && \
    git commit -m "Initial workspace" --allow-empty

# Create data directory for persistent memory
RUN mkdir -p /app/data

# Own everything by the non-root user
RUN chown -R engram:engram /app /home/engram

# Switch to non-root user
USER engram

# OpenClaw gateway port (internal use only)
EXPOSE 18789

# Health check — verify node process is running
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

# Default: run the standalone agent loop in demo mode
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js", "--demo", "--once"]
