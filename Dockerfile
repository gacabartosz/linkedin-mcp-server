# LinkedIn MCP — production image
# Base: Microsoft Playwright official (chromium + fonts + node 22 ready)
# Used for: dashboard, auto-publish, auto-engage, auto-analytics, newsletter-send

FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS builder

WORKDIR /app

# Native build deps (better-sqlite3 needs python3/make/g++) + sqlite3 CLI for build-time checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── Runtime stage ──────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-core \
    fonts-noto-extra \
    sqlite3 \
    tini \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Production deps only — native compile needs python3/make/g++ (kept; autoremove pulled node out)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled TypeScript + runtime files
COPY --from=builder /app/dist ./dist
COPY templates ./templates
COPY guidelines ./guidelines
COPY scripts ./scripts
COPY dashboard.mjs ./
COPY auto-publish.mjs ./
COPY auto-engage.mjs ./
COPY auto-analytics.mjs ./
COPY auto-prospect.mjs ./
COPY auto-invite.mjs ./

# Runtime expectations:
#  - /data/linkedin-mcp/  → mounted volume with auth.json, scraper-auth.json, *.db
#  - /etc/linkedin-mcp/.env → mounted env_file (read-only)
ENV LINKEDIN_DATA_DIR=/data/linkedin-mcp \
    MCP_DIR=/app \
    NODE_ENV=production \
    PORT=3336

EXPOSE 3336

# tini reaps zombies and forwards SIGTERM/SIGINT cleanly to Node
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command = dashboard. docker-compose overrides for daemons.
CMD ["node", "dashboard.mjs"]
