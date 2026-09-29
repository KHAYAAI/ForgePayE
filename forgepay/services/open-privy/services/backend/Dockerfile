# syntax=docker/dockerfile:1
#
# Production image for the OpenPrivy backend.
# Build context is the REPO ROOT:  docker build -f services/backend/Dockerfile .
#
# The backend is treated as a standalone package (the root workspace manifest is
# intentionally NOT copied) so the monorepo's mobile-app peer-dep conflicts never
# reach this image. Multi-stage keeps the final image lean and dev-deps-free.

# ---- deps: full install (incl. dev) for building -----------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY services/backend/package.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

# ---- build: compile TypeScript ----------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY services/backend/package.json ./
COPY services/backend/tsconfig.json services/backend/nest-cli.json ./
COPY services/backend/src ./src
RUN npm run build

# ---- prod-deps: production-only dependencies --------------------------------
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY services/backend/package.json ./
RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund

# ---- runner: minimal runtime image ------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# tini for correct PID-1 signal handling (graceful shutdown on SIGTERM)
RUN apk add --no-cache tini wget

# Run as the built-in unprivileged `node` user (uid 1000), matching the k8s
# securityContext (runAsUser: 1000, readOnlyRootFilesystem: true).
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node services/backend/package.json ./

USER node
EXPOSE 3001

# Container-level healthcheck (k8s uses its own probes; this helps plain docker).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3001}/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
