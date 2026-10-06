FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production image
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
# Production dependencies only. The builder's node_modules is deliberately NOT copied over them: it carries the dev
# dependencies (test runner and friends), which shipped in the image and failed the vulnerability scan. npm is removed
# afterwards because the server is started with node directly and the npm bundled in the base image has its own findings.
RUN npm ci --omit=dev \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY next.config.js ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/healthz', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["node", "node_modules/next/dist/bin/next", "start"]
