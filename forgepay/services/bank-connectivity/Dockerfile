# syntax=docker/dockerfile:1

# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install dependencies first (layer is cached unless package.json changes)
COPY package*.json ./
RUN npm ci --prefer-offline

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Non-root user for least-privilege execution
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 bankconnect

# Copy only what is needed at runtime
COPY --from=builder --chown=bankconnect:nodejs /app/dist         ./dist
COPY --from=builder --chown=bankconnect:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=bankconnect:nodejs /app/package.json ./

USER bankconnect

EXPOSE 3006

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3006/healthz || exit 1

CMD ["node", "dist/index.js"]
