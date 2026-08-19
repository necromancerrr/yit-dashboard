# syntax=docker/dockerfile:1

FROM node:22-alpine AS base

# ---- Dependencies ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- Build ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Values only need to be *present* at build time (Next.js reads process.env
# while collecting page data); real secrets are supplied at run time below.
ENV AUTH_SECRET="build-time-placeholder-secret-value-123456"
ENV APP_PASSWORD="build-time-placeholder"
RUN npm run build

# ---- Runtime ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /app/db \
  && chown -R nextjs:nodejs /app/db

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
# SQLite file lives on the mounted volume so data survives redeploys.
ENV DATABASE_URL="file:/app/db/app.db"

CMD ["node", "server.js"]
