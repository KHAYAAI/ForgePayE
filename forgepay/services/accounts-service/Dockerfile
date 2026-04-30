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
USER forgepay
EXPOSE 8040
CMD ["node", "dist/index.js"]
