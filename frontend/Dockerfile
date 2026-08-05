# syntax=docker/dockerfile:1.9
#
# frontend/Dockerfile
#
# Build context: repo root. Bun builder, then nginx:alpine serving the static
# bundle on port 3000.

FROM oven/bun:1.3.8-alpine AS builder
WORKDIR /app/frontend

# Install from the manifests alone so the dependency layer survives source edits.
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile

COPY frontend/ ./
# Vite and the plugins it loads still carry `#!/usr/bin/env node` shebangs.
# There is no node in this image; `bun run` shims one that is bun itself.
RUN bun run build

FROM nginx:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 3000
# nginx:alpine already has a sensible default CMD; do not override.
