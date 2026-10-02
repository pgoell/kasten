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
docs/       documentation, arranged by Diátaxis
deploy/     prod compose file, its env example, and selfhost/
scripts/    OpenAPI type generation
plugins/    Claude Code plugin for a machine with no MCP
compose.yaml      dev Postgres
compose.dev.yml   hosted dev environment
```

## Self-host

`deploy/selfhost/` runs the whole stack on one Linux machine of your own, amd64
or arm64, with Caddy doing TLS and a login gate of basic auth, oauth2-proxy or
Tailscale in front. No database to run.

* [Self-host on a server](docs/tutorials/self-host-on-a-server.md): the first
  run, from an empty server to a note and a connected agent
* [Self-host kasten](docs/how-to/self-host-kasten.md): every step, and all
  three login gates
* [Connect an agent](docs/how-to/connect-an-agent.md),
  [Back up and restore](docs/how-to/back-up-and-restore.md) and
  [Upgrade kasten](docs/how-to/upgrade-kasten.md): what comes after

## Documentation

[`docs/`](docs/index.md) holds the tutorials, how-to guides, reference and
explanation. To run kasten, start with
[Self-host on a server](docs/tutorials/self-host-on-a-server.md); to work on
its code, with [Getting started](docs/tutorials/getting-started.md).

## License

[AGPL-3.0](LICENSE). You may run, change and share kasten. If you run a
changed copy as a service for other people, you must offer them its source.
