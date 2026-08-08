# syntax=docker/dockerfile:1.9
#
# backend/Dockerfile
#
# Build context: repo root, so the uv workspace root manifests are reachable.

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
# Version and checksum are pinned together, and the version has to match the
# one in mise.toml: host and container work on the same repo.
FROM debian:bookworm-slim AS jj
ARG JJ_VERSION=0.37.0
ARG JJ_SHA256=7fd8e28d65106768054becbc1e0b929bed7c4c963d598f9f9a629bfa92eb7171
ADD https://github.com/jj-vcs/jj/releases/download/v${JJ_VERSION}/jj-v${JJ_VERSION}-x86_64-unknown-linux-musl.tar.gz /tmp/jj.tar.gz
RUN echo "${JJ_SHA256}  /tmp/jj.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/jj.tar.gz -C /usr/local/bin ./jj

# rg answers `GET /api/search` by reading the vault on every query, so the
# binary is as much a dependency as jj is. Pinned and checksummed the same way,
# and the version has to match mise.toml for the same reason.
FROM debian:bookworm-slim AS rg
ARG RG_VERSION=14.1.1
ARG RG_SHA256=4cf9f2741e6c465ffdb7c26f38056a59e2a2544b51f7cc128ef28337eeae4d8e
ADD https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl.tar.gz /tmp/rg.tar.gz
RUN echo "${RG_SHA256}  /tmp/rg.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/rg.tar.gz -C /usr/local/bin --strip-components=1 \
       ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl/rg

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

EXPOSE 8000
# `--timeout-graceful-shutdown` bounds how long a deploy waits on `/api/events`.
# That endpoint runs until its reader leaves, and uvicorn waits for open
# connections before it stops, so an open browser tab would otherwise hold a
# replaced container up indefinitely. A second is plenty: the stream carries no
# state and `EventSource` reconnects to the new container on its own.
CMD ["uvicorn", "kasten_backend.main:app", "--timeout-graceful-shutdown", "1", \
     "--host", "0.0.0.0", "--port", "8000"]
