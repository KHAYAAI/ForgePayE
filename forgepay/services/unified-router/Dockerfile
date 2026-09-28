# syntax=docker/dockerfile:1
#
# Build context is the `forgepay/` parent, not this directory — checkout.ts
# reads ../../config/pricing.yaml at runtime as its one source of truth for
# what it charges, and Docker COPY cannot reach outside its build context.
# Build with: docker build -f services/unified-router/Dockerfile forgepay/
# (forgepay-docker.yml's unified-router matrix entry does this already.)

FROM node:20-alpine AS builder
WORKDIR /app

COPY services/unified-router/package*.json ./
RUN npm ci --prefer-offline

COPY services/unified-router/tsconfig.json ./
COPY services/unified-router/src/ ./src/
RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 router

COPY --from=builder --chown=router:nodejs /app/dist ./dist
COPY --from=builder --chown=router:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=router:nodejs /app/package.json ./
# Shared pricing config — see the note at the top of this file. Lands at
# /app/config/pricing.yaml, which is what PRICING_YAML_PATH's default
# ('../../config/pricing.yaml', resolved from dist/lib/) points at.
COPY --chown=router:nodejs config/pricing.yaml ./config/pricing.yaml

USER router
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:8000/healthz || exit 1

CMD ["node", "dist/index.js"]
