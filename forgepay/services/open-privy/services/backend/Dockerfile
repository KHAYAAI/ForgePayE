FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY services/backend/package*.json ./services/backend/

RUN npm install

COPY services/backend ./services/backend
COPY tsconfig.json ./

RUN cd services/backend && npm run build

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/services/backend/package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/services/backend/dist ./dist
COPY --from=builder /app/.env.example ./.env.example

EXPOSE 3001

CMD ["node", "dist/main.js"]
