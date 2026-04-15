# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --prefer-offline

COPY tsconfig.json ./
COPY src/ ./src/
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

USER router
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:8000/healthz || exit 1

CMD ["node", "dist/index.js"]
