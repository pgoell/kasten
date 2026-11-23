# syntax=docker/dockerfile:1.9
#
# frontend/Dockerfile
#
# Build context: repo root. Bun builder, then nginx:alpine serving the static
# bundle on port 3000.

FROM oven/bun:1.4.5-alpine@sha256:da816670775f4c2b4e990b6b1847cf5540dcdc721a42033dd331ce7a88ba6a3b AS builder
WORKDIR /app/frontend

# Install from the manifests alone so the dependency layer survives source edits.
COPY frontend/package.json frontend/bun.lock ./
# The install applies these, the lockfile naming them.
COPY frontend/patches ./patches
RUN bun install --frozen-lockfile

COPY frontend/ ./
# Vite and the plugins it loads still carry `#!/usr/bin/env node` shebangs.
# There is no node in this image; `bun run` shims one that is bun itself.
RUN bun run build

FROM nginx:1.31-alpine@sha256:fed7e14be83cbd2661a75cdc5b872d936cf155d46c327084d30b8df19ae88d72 AS runtime
# nginx 1.27 gets no new images, and its bundle still trusts emSign ECC Root
# CA - G3, which Mozilla dropped. Both packages, or the trigger rebuilds the old
# bundle.
RUN apk upgrade --no-cache ca-certificates ca-certificates-bundle
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 3000
# nginx:alpine already has a sensible default CMD; do not override.
