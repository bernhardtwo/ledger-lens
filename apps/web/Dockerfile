# syntax=docker/dockerfile:1
#
# @ledger-lens/web image (ADR-0012). Next.js standalone output → a minimal node
# runtime that serves the app and proxies /api/* to the api (same-origin rewrites,
# spec 0006). No secrets, no DB/agent code in this image.
#
# Build from the repo root:
#   docker build -f apps/web/Dockerfile --build-arg API_BASE_URL=<api-url> -t ledgerlens-web .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0
RUN corepack enable
WORKDIR /app

# ---- builder: install + next build (standalone) ----
FROM base AS builder
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json
COPY packages/evals/package.json packages/evals/package.json
RUN pnpm install --frozen-lockfile
COPY . .
# The Next rewrites proxy destination is baked at build time (Next evaluates
# next.config during `next build`). The local compose passes the in-network api URL;
# the cloud rebuilds with the internal ACA FQDN (a known build-time-config limit,
# spec 0007 §3 — revisit with a runtime proxy if it becomes a constraint).
ARG API_BASE_URL=http://localhost:3001
ENV API_BASE_URL=$API_BASE_URL
RUN pnpm --filter @ledger-lens/web build

# ---- runtime: standalone server ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# Standalone bundle (server.js + traced node_modules) + the static assets it serves.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
