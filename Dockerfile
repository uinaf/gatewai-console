# syntax=docker/dockerfile:1

FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm run generate-routes && pnpm run build && mkdir /data

# Distroless carries node and nothing else: no shell, no package manager.
FROM gcr.io/distroless/nodejs24-debian12:nonroot@sha256:14d42e2511532589a7c7e01a753667a74fcc96266e137e8125006b87b0c32d0a
WORKDIR /app
COPY --from=build --chown=1000:1000 /app/.output ./.output
COPY --from=build --chown=1000:1000 /app/drizzle ./drizzle
# Pre-owned so a fresh named volume inherits UID 1000; bind mounts must be chowned on the host.
COPY --from=build --chown=1000:1000 /data /data
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    HOST=0.0.0.0 \
    PORT=8080 \
    GATEWAI_DB_PATH=/data/console.sqlite \
    GATEWAI_MIGRATIONS_DIR=/app/drizzle
USER 1000:1000
VOLUME ["/data"]
EXPOSE 8080
CMD [".output/server/index.mjs"]
