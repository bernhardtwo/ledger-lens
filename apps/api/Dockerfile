# syntax=docker/dockerfile:1
#
# @ledger-lens/api image (ADR-0012). Debian-slim / glibc on BOTH stages on purpose:
# the Claude Agent SDK ships a per-libc native `claude` binary that query() spawns,
# so the install-stage and runtime-stage libc MUST match. Inside this one container
# the api (node) spawns that binary (the agent), which in turn spawns the compiled
# MCP server over stdio. Compile-to-JS: no tsx in production.
#
# Build from the repo root:  docker build -f apps/api/Dockerfile -t ledgerlens-api .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0
RUN corepack enable
WORKDIR /app

# ---- builder: install all deps, compile to dist, emit a pruned deploy dir ----
FROM base AS builder
# Workspace manifests first, so the dependency layer caches across source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json
COPY packages/evals/package.json packages/evals/package.json
RUN pnpm install --frozen-lockfile
# Sources, then compile the api package set (shared, db, mcp-server, api) to dist.
COPY . .
RUN pnpm build:api
# Self-contained prod tree: api dist + workspace-dep dist + db/drizzle migrations +
# the glibc agent binary; no dev deps, no tsx, no web deps (see packages' `files`).
RUN pnpm --filter=@ledger-lens/api deploy --prod /deploy
# This image is glibc (Debian); the lockfile also carries the musl agent binary
# (~240MB dead weight here). The SDK selects the linux-x64 glibc `claude` at runtime,
# so drop the musl variant to keep the image lean (ADR-0012).
RUN rm -rf /deploy/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-*-musl@* && \
    if find /deploy -path '*-musl*' -name claude | grep -q .; then echo "ERROR: musl agent binary still present" >&2; exit 1; fi && \
    if ! find /deploy -path '*linux-x64*' -name claude | grep -q .; then echo "ERROR: glibc agent binary missing" >&2; exit 1; fi

# ---- runtime ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app
COPY --from=builder /deploy /app
EXPOSE 3001
# `--conditions=ledgerlens-dist` makes every @ledger-lens/* import resolve to the
# compiled dist (ADR-0012); the api passes the same condition to the MCP child it
# spawns (mcp-launch.ts). ANTHROPIC_API_KEY + DATABASE_URL arrive as runtime env.
CMD ["node", "--conditions=ledgerlens-dist", "dist/http/main.js"]
