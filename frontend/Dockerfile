# syntax=docker/dockerfile:1.9
#
# frontend/Dockerfile
#
# Build context: repo root. Node builder with pnpm via corepack, then
# nginx:alpine serving the static bundle on port 3000.

FROM node:22-alpine AS builder
WORKDIR /app/frontend

RUN corepack enable
RUN corepack prepare pnpm@10.33.2 --activate

# Install from the manifests alone so the dependency layer survives source edits.
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
RUN pnpm run build

FROM nginx:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 3000
# nginx:alpine already has a sensible default CMD; do not override.
