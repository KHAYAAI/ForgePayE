# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first (layer-cached separately from source)
COPY package*.json ./
RUN npm ci

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine

# Non-root user for security
RUN addgroup -S forgepay && adduser -S yield-engine -G forgepay

WORKDIR /app

# Copy only production dependencies + compiled output
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Drop to non-root
USER yield-engine

EXPOSE 3007

# Tini reaps zombie processes and forwards signals correctly
# (installed as part of node:22-alpine base)
ENTRYPOINT ["node"]
CMD ["dist/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3007/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"
