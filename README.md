# kasten

A self-hosted markdown notebook with wikilinks and backlinks, in the shape of
Obsidian but served as a web page.

## Design rules

The vault is a directory of `.md` files. That directory is the source of truth.
Postgres holds a derived index only (documents, links, tags, full-text), and you
must be able to drop the schema and rebuild it from the vault. Nothing that only
exists in the database is allowed to matter.

## Stack

- Backend: Python 3.14, FastAPI, SQLAlchemy 2 async, Alembic, uv
- Frontend: React 19, Vite, TanStack Router and Query, Tailwind, CodeMirror 6, bun
- Toolchain: mise pins everything; `mise tasks` lists the commands

## Getting started

```sh
mise install     # toolchain
mise run install # backend + frontend dependencies
mise run db:up   # dev Postgres on :5434
cp backend/.env.example backend/.env
mise run db:migrate

mise run dev     # backend on :8000
mise run fe:dev  # frontend on :5173, proxying /api to the backend
```

## Layout

```
backend/    FastAPI service and Alembic migrations
frontend/   Vite SPA
scripts/    OpenAPI type generation
compose.yaml  dev Postgres
```
