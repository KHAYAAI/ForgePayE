FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev \
 # The bureau never runs npm. The copy bundled in the base image carries its own
 # vulnerable dependencies (brace-expansion, ip-address, pacote and others), so remove it.
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm
COPY --from=builder /app/dist ./dist
# Must be set explicitly. config defaults NODE_ENV to 'development', so without
# this the shipped container ran as a development build in two ways that both
# mattered: it crashed on boot looking for the pino-pretty transport (which
# `--omit=dev` does not install), and every production guard silently
# disengaged -- fail-closed secret checks, CORS, and simulation refusals all
# key off NODE_ENV === 'production'.
ENV NODE_ENV=production

EXPOSE 3018
USER node
CMD ["node", "dist/index.js"]
