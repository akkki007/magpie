# Multi-stage build for App Runner (`docs/deploy-plan.md`).
#
# Bun builds it, plain Node runs it. `next.config.ts`'s `output: "standalone"` traces every
# import a route actually reaches and copies just those `node_modules` into
# `.next/standalone` — the runtime stage never runs `bun install` or `bun run build`, so it
# never needs Bun at all. That is also why the runtime stage is `node:22-slim` rather than a
# Bun image: `server.js` is plain Node, and the smaller base is one less thing to patch.
#
# Prisma 7 has no query engine binary of its own (`lib/db.ts`) — every query goes through the
# `pg` driver adapter, a pure-JS dependency — so there is no libssl/engine-target dance to get
# right for the runtime base image, unlike Prisma 6 and earlier.

FROM oven/bun:1-slim AS build
WORKDIR /app

# Dependencies first, so an `bun install` only reruns when the lockfile actually changes.
COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

COPY . .

# `prisma generate` reads only `prisma/schema.prisma`'s shape, not a live database — the
# schema's `datasource` block carries no `url` (Prisma 7, `prisma7.config.ts`) — so the build
# needs no DATABASE_URL. A placeholder is set anyway for any code that reads
# `process.env.DATABASE_URL` at *module init* (`lib/db.ts` throws if it is unset) without
# calling it; nothing in the build should reach that path, but a build that fails on a live
# secret is worse than one that fails on a fake one.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV NEXT_TELEMETRY_DISABLED=1

RUN bun run build

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone output only: server.js plus the trimmed node_modules it traced. Static assets and
# `public/` are not part of that trace and are copied in separately, as Next's own docs for
# this output mode say to.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
