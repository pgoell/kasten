# syntax=docker/dockerfile:1.9
#
# backend/Dockerfile
#
# Build context: repo root, so the uv workspace root manifests are reachable.
#
# Built for linux/amd64 and linux/arm64. BuildKit fills TARGETARCH with one of
# the two, and the `FROM jj-${TARGETARCH}` lines below pick the stage that
# fetches that architecture's binary, so a build only downloads its own.
# TARGETARCH is not declared here on purpose: BuildKit already defines it in
# the global scope, and an `ARG TARGETARCH` above the first FROM blanks it.

# The versions sit here, above every stage, so each architecture's stage reads
# the same one and only the checksum differs between them.
ARG JJ_VERSION=0.37.0
ARG RG_VERSION=14.1.1

FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim AS builder
WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv

COPY pyproject.toml uv.lock ./
COPY backend/ backend/

# --no-editable installs kasten-backend as a real wheel rather than a .pth
# editable install. Editable entries point at /app/backend/src, which does not
# exist in the runtime stage, so imports would fail there.
RUN uv sync --frozen --no-dev --no-editable --package kasten-backend

# jj records every vault write, so the backend needs the binary beside it. The
# release build is static, which is why it can be lifted into another image.
# One stage per architecture, each with the checksum of its own asset, and the
# version has to match the one in mise.toml: host and container work on the
# same repo.
FROM debian:bookworm-slim AS jj-amd64
ARG JJ_VERSION
ARG JJ_SHA256=7fd8e28d65106768054becbc1e0b929bed7c4c963d598f9f9a629bfa92eb7171
ADD https://github.com/jj-vcs/jj/releases/download/v${JJ_VERSION}/jj-v${JJ_VERSION}-x86_64-unknown-linux-musl.tar.gz /tmp/jj.tar.gz
RUN echo "${JJ_SHA256}  /tmp/jj.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/jj.tar.gz -C /usr/local/bin ./jj

FROM debian:bookworm-slim AS jj-arm64
ARG JJ_VERSION
ARG JJ_SHA256=f42164567abbcc0b13354eeb1ecd11f4245d7dce4de849bf794a4d5e1b615c62
ADD https://github.com/jj-vcs/jj/releases/download/v${JJ_VERSION}/jj-v${JJ_VERSION}-aarch64-unknown-linux-musl.tar.gz /tmp/jj.tar.gz
RUN echo "${JJ_SHA256}  /tmp/jj.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/jj.tar.gz -C /usr/local/bin ./jj

FROM jj-${TARGETARCH} AS jj

# rg answers `GET /api/search` by reading the vault on every query, so the
# binary is as much a dependency as jj is. Pinned and checksummed the same way,
# and the version has to match mise.toml for the same reason.
FROM debian:bookworm-slim AS rg-amd64
ARG RG_VERSION
ARG RG_SHA256=4cf9f2741e6c465ffdb7c26f38056a59e2a2544b51f7cc128ef28337eeae4d8e
ADD https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl.tar.gz /tmp/rg.tar.gz
RUN echo "${RG_SHA256}  /tmp/rg.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/rg.tar.gz -C /usr/local/bin --strip-components=1 \
       ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl/rg

# ripgrep publishes no musl build for aarch64, so this is the glibc one. It
# links glibc dynamically, which the bookworm runtime carries.
FROM debian:bookworm-slim AS rg-arm64
ARG RG_VERSION
ARG RG_SHA256=c827481c4ff4ea10c9dc7a4022c8de5db34a5737cb74484d62eb94a95841ab2f
ADD https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-aarch64-unknown-linux-gnu.tar.gz /tmp/rg.tar.gz
RUN echo "${RG_SHA256}  /tmp/rg.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/rg.tar.gz -C /usr/local/bin --strip-components=1 \
       ripgrep-${RG_VERSION}-aarch64-unknown-linux-gnu/rg

FROM rg-${TARGETARCH} AS rg

FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim AS runtime
WORKDIR /app

COPY --from=jj /usr/local/bin/jj /usr/local/bin/jj
COPY --from=rg /usr/local/bin/rg /usr/local/bin/rg
COPY --from=builder /app/.venv /app/.venv
# The wheel carries the backend source, so the runtime only needs the Alembic
# config and migration scripts for the migrate container.
COPY backend/alembic.ini /app/backend/alembic.ini
COPY backend/alembic /app/backend/alembic

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# The mount points deploy/compose.yaml uses. The settings' own defaults are
# relative, which suits dev from the repo root, but here they would resolve
# under /app, inside the container: a deploy that forgot the variable would
# save notes and tokens that vanish with the next image. An env_file still wins.
ENV KASTEN_VAULT_PATH=/vault \
    KASTEN_TOKENS_PATH=/agent-data/tokens.json

EXPOSE 8000
# `--timeout-graceful-shutdown` bounds how long a deploy waits on `/api/events`.
# That endpoint runs until its reader leaves, and uvicorn waits for open
# connections before it stops, so an open browser tab would otherwise hold a
# replaced container up indefinitely. A second is plenty: the stream carries no
# state and `EventSource` reconnects to the new container on its own.
CMD ["uvicorn", "kasten_backend.main:app", "--timeout-graceful-shutdown", "1", \
     "--host", "0.0.0.0", "--port", "8000"]
