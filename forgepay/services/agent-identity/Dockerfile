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
# Must be set explicitly. config defaults NODE_ENV to 'development', so without
# this the shipped container ran as a development build in two ways that both
# mattered: it crashed on boot looking for the pino-pretty transport (which
# `--omit=dev` does not install), and every production guard silently
# disengaged -- fail-closed secret checks, CORS, and simulation refusals all
# key off NODE_ENV === 'production'.
ENV NODE_ENV=production

EXPOSE 3010
USER node
CMD ["node", "dist/index.js"]
