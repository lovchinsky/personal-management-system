# syntax=docker/dockerfile:1

# The Personal Management System App image. `docker compose build app` builds it, and `APP_IMAGE`
# sets its name (by default `personal-management-system-app:local`). The image contains the Claude
# Code CLI, a proprietary Anthropic program, so it is not published to a public registry.
#
# The `gate` target is the same image together with the compiled gate (`app/test/gate`): the
# acceptance test needs the same environment as the App. The default target is the last stage,
# `runtime`, and it does not include the gate (ADR 0041).
#
# The build context is the repository root (infra/compose.yaml).

FROM node:22-alpine AS deps
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY app/package.json app/package-lock.json app/tsconfig.json app/tsconfig.build.json app/nest-cli.json app/prisma.config.ts ./
COPY app/prisma ./prisma
COPY app/src ./src
RUN npx prisma generate && npx nest build

FROM build AS gate-build
COPY app/tsconfig.gate.json ./
COPY app/test/gate ./test/gate
RUN npx tsc -p tsconfig.gate.json

FROM node:22-alpine AS app-base
WORKDIR /app

RUN apk add --no-cache curl tini

ENV NODE_ENV=production
ENV PORT=3000
# The runner plugin; the two COPY instructions below assemble it (INV-048).
ENV RUNNER_PLUGIN_DIR=/app/plugin

# /app is already owned by `node` before anything is written to it. A recursive chown afterwards
# would rewrite every dependency file into a second layer the size of the whole tree.
RUN chown node:node /app
USER node

# The lockfile records `libc` next to `os` and `cpu` for every optional platform package, so
# `npm ci` installs the one CLI binary this image can run. A lockfile without this field makes
# npm compare only `os` and `cpu` and pull in the glibc build as well — `INV-305` enforces this.
COPY --chown=node:node app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# The schema, the migration history and the Prisma config ship with the image, as does the
# `prisma` CLI: `@prisma/client` depends on it, so it survives `--omit=dev`. That is why the
# migrations are applied from this image exactly as built.
COPY --chown=node:node app/prisma.config.ts ./
COPY --chown=node:node app/prisma ./prisma
COPY --from=build --chown=node:node /app/dist ./dist

# The behavior contract ships in the same image as the runner that loads it. The knowledge is
# stored once, in the chat plugin, and the run reads it from its own directory: the build puts it
# there (ADR 0047).
COPY --chown=node:node app/plugin ./plugin
COPY --chown=node:node plugin/skills/personal-management-system/knowledge ./plugin/skills/run/knowledge

# The Notion workspace schema and the canonical model are for the `notion` command, which builds
# the databases and writes the binding, as the Prisma migrations are for the database: the schema
# of the external store ships in the same image that works with it (ADR 0048).
COPY --chown=node:node contracts/notion-workspace.yaml contracts/canonical.yaml ./contracts/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

# Before it starts, the App applies its migrations: the database is brought up to the schema of
# the image it is launched with. A failed migration stops the container, so the App does not run
# against a schema that has fallen behind.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx --no-install prisma migrate deploy && exec node dist/src/main"]

FROM app-base AS gate
COPY --from=gate-build --chown=node:node /app/dist-gate ./dist-gate

FROM app-base AS runtime
