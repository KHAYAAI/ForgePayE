FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --frozen-lockfile
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup -S forgepay && adduser -S -G forgepay forgepay
COPY package.json ./
RUN npm install --frozen-lockfile --omit=dev
COPY --from=builder /app/dist ./dist
# Must be set explicitly. config defaults NODE_ENV to 'development', so without
# this the shipped container ran as a development build in two ways that both
# mattered: it crashed on boot looking for the pino-pretty transport (which
# `--omit=dev` does not install), and every production guard silently
# disengaged -- fail-closed secret checks, CORS, and simulation refusals all
# key off NODE_ENV === 'production'.
ENV NODE_ENV=production

USER forgepay
EXPOSE 8040
CMD ["node", "dist/index.js"]
