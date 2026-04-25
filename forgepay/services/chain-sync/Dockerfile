FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --frozen-lockfile --omit=dev
COPY --from=builder /app/dist ./dist
COPY src/db/migrations ./src/db/migrations
USER node
EXPOSE 8050
CMD ["node", "dist/index.js"]
