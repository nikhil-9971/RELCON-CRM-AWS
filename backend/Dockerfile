FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install  # ← npm ci se npm install mein change kar

FROM node:20-alpine AS production
RUN apk add --no-cache dumb-init
RUN addgroup -g 1001 -S nodejs && adduser -S relcon -u 1001 -G nodejs
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=relcon:nodejs . .
USER relcon
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]