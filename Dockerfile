# ---------------------------------------------------------------------------
# Production image.
#
# Multi-stage so the runtime layer carries no toolchain. This service needs no
# native modules at runtime (SQLite comes from node:sqlite), which keeps the
# image small and avoids surprising build failures.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /app

# pnpm is provisioned via corepack so the version is pinned by packageManager.
RUN corepack enable

# Dependency manifests first, so a source-only change reuses the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# Drop dev dependencies from the tree we are about to copy forward.
RUN pnpm prune --prod

# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    STORAGE_DIR=/data/uploads \
    DATABASE_PATH=/data/bot.db

WORKDIR /app

# Run unprivileged. /data is the mount point for the persistent volume.
RUN addgroup -S app && adduser -S app -G app \
 && mkdir -p /data/uploads \
 && chown -R app:app /data /app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./package.json
# The migration loader reads schema.sql from the source tree as a fallback.
COPY --from=builder --chown=app:app /app/src/db/schema.sql ./src/db/schema.sql

USER app

EXPOSE 3000

# The app touches the database in this route, so an unhealthy volume surfaces
# as an unhealthy container rather than as a 500 during a user's turn.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
