FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

# Must be set explicitly. config.ts defaults NODE_ENV to 'development', so
# without this the shipped container ran as a development build in two ways
# that both mattered:
#
#   1. It crashed on boot. The development branch of lib/logger.ts routes pino
#      through a pino-pretty transport, which `npm ci --omit=dev` does not
#      install — "unable to determine transport target for pino-pretty".
#
#   2. Every production guard silently disengaged. The CORS fail-closed check
#      (config.ts), assertShieldedPaymentsSafeToBoot(), and the payout
#      broadcaster's refusal to simulate a transfer (lib/payouts.ts) all key
#      off NODE_ENV === 'production'. In a container that believed it was in
#      development, none of them applied.
ENV NODE_ENV=production

EXPOSE 8020
CMD ["node", "dist/index.js"]
