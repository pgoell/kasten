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

FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim AS runtime
WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
# The wheel carries the backend source, so the runtime only needs the Alembic
# config and migration scripts for the migrate container.
COPY backend/alembic.ini /app/backend/alembic.ini
COPY backend/alembic /app/backend/alembic

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000
CMD ["uvicorn", "kasten_backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
