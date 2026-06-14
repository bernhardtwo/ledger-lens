# 0012. Container images: compile to JS, glibc base, pnpm-workspace packaging

- **Status:** Accepted
- **Date:** 2026-06-13

## Context

ADR-0011 puts `apps/api` and `apps/web` on Azure Container Apps. This ADR records
**how the two images are built** from a pnpm workspace, and the one constraint that
makes the api image non-trivial: the Claude Agent SDK.

Three facts, verified in the repo, drive the design:

1. **The Agent SDK ships a large, per-libc native binary.**
   `@anthropic-ai/claude-agent-sdk@0.3.168` declares the runtime as a set of
   platform `optionalDependencies` — `claude-agent-sdk-linux-x64` (glibc, ~245 MB),
   `…-linux-x64-musl`, arm64 variants, etc. `query()` (`apps/api/src/agent/agent-sdk-client.ts`)
   **spawns that native `claude` binary** as a subprocess; pnpm installs only the
   one matching the install platform's **os/cpu/libc**. Therefore the libc of the
   stage that runs `pnpm install` and the libc of the runtime image **must match**,
   or the spawned binary won't load.

2. **The api runtime is a process tree, in one container.**
   ```
   node dist/http/main.js          (Nest HTTP; PORT, default 3001)
     └─ query() ─▶ claude          (native agent binary, glibc; gets ANTHROPIC_API_KEY)
          └─ spawn ─▶ node dist/.../mcp-server/main.js   (MCP over stdio; gets DATABASE_URL)
               └─ postgres.js ─▶ Postgres (TLS)
   ```
   So the api image must contain node 22, the matching `claude` binary, and the
   compiled MCP server + its deps (`db`, `shared`, drizzle, postgres.js, the MCP
   SDK). Secret propagation is **already correct in code**: `buildAskOptions`
   forwards `ANTHROPIC_API_KEY` to the agent process and `mcpChildEnv` injects
   `DATABASE_URL` into the MCP child while dropping the key (`apps/api/src/agent/query.ts`).
   The image just has to make both env vars present.

3. **`shared`/`db`/`mcp-server` ship raw TS today; the dev runtime is `tsx`.**
   `mcp-launch.ts` builds `node --import tsx <entry>` and self-documents: *"tsx is
   the dev runtime (no build step yet); Phase 7's build will launch compiled JS with
   plain node."* `apps/web` already compiles `shared` via Next `transpilePackages`;
   the webpack `.js`→`.ts` `extensionAlias` is **build-time only** and irrelevant at
   runtime. All cross-package relative imports already carry `.js` specifiers, which
   resolve to the emitted `.js` after compilation.

Constraints from CLAUDE.md: minimal runtime images, cross-platform scripts (the
build runs on Linux CI and is authored from Windows/WSL), determinism-first (the
image adds no LLM surface).

## Decision

**1. Compile to JS; no `tsx`/TS source in production.** A build stage runs `tsc` to
emit `dist/` for `api`, `mcp-server`, `db`, and `shared`; the runtime runs plain
`node dist/http/main.js`. This requires **emit tsconfigs** (the current ones are
`noEmit`, `moduleResolution: "Bundler"`); the build configs emit ESM with the
existing `.js` specifiers intact (`outDir`, `declaration` off for app code). The
prod branch of `mcpServerLaunch()` is updated to spawn the **compiled** MCP entry
with plain `node` (no `--import tsx`); the dev branch stays tsx. This is the path
the author signposted and keeps the image free of a dev transpiler.

**2. Debian-slim / glibc base for the api, for both build and runtime stages.**
`node:22-slim` (Debian, glibc) — **not** Alpine. The libc must match across stages
(fact 1), and Alpine/musl would save little because the ~245 MB binary dominates
the image regardless of base. The api pulls the **glibc** agent optionalDependency
(`claude-agent-sdk-linux-x64`). The same base is used for the api build stage so the
installed binary is glibc end-to-end.

**3. Multi-stage, pnpm-workspace-aware, pruned per app.** Build stage:
`pnpm install --frozen-lockfile` over the whole workspace → `tsc` build the api's
package set → `pnpm --filter=@ledger-lens/api deploy --prod <out>` to produce a
**self-contained** directory (pruned prod `node_modules`, the matching native
binary kept, dev deps and `testcontainers` dropped). Runtime stage copies that dir
+ `dist` and sets the entrypoint. Workspace `workspace:*` deps are resolved by
`pnpm deploy`, not hand-copied.

**4. The web image uses Next standalone output.** `next build` with
`output: "standalone"` emits a minimal `server.js` + traced `node_modules` +
`.next/static`. `shared` is bundled by `transpilePackages` during the build, so the
web runtime needs **no** workspace linkage and no `tsx`. Base `node:22-slim`. Web
carries **no** secrets and no DB/agent code.

**5. Two small deterministic code changes ride along** (detailed in spec 0007, not
here): a trivial `GET /health` for the ACA probe, and honouring TLS to managed
Postgres (`?sslmode=require`; verify postgres.js reads it from the URL, else add the
`ssl` option in `client.ts`). Neither adds an LLM call.

## Alternatives considered

- **Alpine / musl base** — smaller base, but reintroduces the libc-match hazard
  (fact 1) for a marginal saving against a 245 MB binary. Net negative.
- **Ship `tsx` at runtime** (`node --import tsx`) — zero build-config work and
  mirrors dev exactly, but ships TS source + a dev transpiler to production and
  contradicts the chosen compile-to-JS posture. Kept only as a documented fallback
  if the emit setup proves troublesome.
- **Build `node_modules` on a different libc than the runtime** (e.g. install on
  CI's glibc, run on Alpine) — silently breaks the spawned `claude` binary.
  Explicitly forbidden; it's the failure this ADR exists to prevent.
- **Copy the whole monorepo `node_modules` into the image** — bloated and
  non-reproducible vs `pnpm deploy --prod` pruning. Rejected.
- **One combined image** — already rejected in ADR-0011 (two runtimes/ports).

## Consequences

- **Positive:** production runs compiled JS on plain `node` (no dev transpiler);
  libc correctness is a single rule (glibc everywhere on the api path); images are
  pruned and reproducible from the lockfile; web ships a minimal standalone bundle
  with no secrets; the agent + MCP subprocess model works unchanged inside one
  container because env propagation is already in code.
- **Negative (accepted):** the api image is large (~600 MB), binary-dominated →
  slower scale-from-zero (the cold-start lever lives in ADR-0011); we take on
  emit-tsconfigs + a prod branch in `mcp-launch.ts` as genuine new build surface;
  the `claude` binary is pinned per-libc, so a future move to Alpine/arm64 means
  re-checking the optionalDependency.
- **Follow-ups:** if image size hurts the demo, revisit musl + the musl binary or a
  slimmer distroless runtime; revisit if the SDK changes how it ships the binary.
