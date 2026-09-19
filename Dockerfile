# Magpie on ECS Fargate.
#
# Node runs the build and the server; Bun only installs, so `bun.lock` is honoured
# exactly and nothing resolves to a different version than it does locally.
#
# No `output: "standalone"` — this ships the full `node_modules`. The image is larger,
# but it is the same thing `bun run start` runs on a laptop, and a deploy that matches
# the machine it was tested on is worth more than a smaller layer.
FROM node:22-bookworm-slim

# OpenSSL: Prisma's engines link against it. Bun: the installer, pinned to the version
# in package.json's `packageManager` so the lockfile is read by what wrote it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g bun@1.3.9

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# `lib/db.ts` throws at *module load* when DATABASE_URL is unset, and Next evaluates
# every route module while building — so the build needs a syntactically valid URL even
# though it never opens a connection. A placeholder is correct here: baking the real one
# in would put the production password in an image layer.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npx prisma generate && npx next build

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["npx", "next", "start"]
