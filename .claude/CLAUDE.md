# kasten: project instructions

A self-hosted markdown notebook with wikilinks and backlinks, in the shape of
Obsidian but served as a web page. Single user, running on a Hetzner VPS behind
oauth2-proxy.

## The layout

- `backend/`: FastAPI on Python 3.14, SQLAlchemy 2 async, Alembic, uv. Settings
  through pydantic-settings with the `KASTEN_` prefix. Every endpoint and what
  it answers with is in [the HTTP API](../docs/reference/http-api.md).
- `frontend/`: React 19, Vite, TanStack Router and Query, Tailwind 4,
  CodeMirror 6 with vim mode, xterm, bun. Every key is in
  [the editor keys](../docs/reference/editor-keys.md).
- `shell/`: ttyd over herdr on a node base, with the vault mounted and jj, rg,
  git, curl, jq, Claude Code, codex and dsh beside it. It publishes no port, the way
  in being a Caddy `handle /term/*` behind oauth2-proxy.
- `vault/`: the notes, and a colocated jj repo holding their history.
- `compose.yaml` and `compose.dev.yml` at the root run dev. `deploy/` holds the
  prod compose.

Details of a feature belong in `docs/`, not here. This file goes stale the
moment it starts describing behaviour.

## Commands

mise owns every command. `mise tasks` lists them, and
[the reference page](../docs/reference/mise-tasks.md) explains them by group.
The ones you need most:

```sh
mise run dev        # backend on :8000
mise run fe:dev     # frontend on :5173
mise run test       # backend and frontend tests
mise run lint       # ruff, ty, biome
mise run db:migrate # apply migrations to the dev database
```

## Documentation

`docs/` is a [Diátaxis](https://diataxis.fr) tree written in
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
v0.2. Read [docs/index.md](../docs/index.md) first; it explains the arrangement.

When you add or change a page:

- Every page except `index.md` and `log.md` carries YAML frontmatter, and
  `type` is required. Use the quadrant as the type: `Tutorial`,
  `How-to Guide`, `Reference` or `Explanation`. Add `title`, `description`,
  `tags` and `status` too.
- Put the page in the quadrant that matches its job. A tutorial teaches a
  beginner, a how-to serves someone who knows what they want, a reference
  states what is there, an explanation gives the why. Mixing two of those into
  one page is the failure this structure exists to prevent.
- Link between pages with bundle-relative markdown links, `/reference/http-api.md`.
- Update the `index.md` of the directory you touched, and add a dated entry to
  `docs/log.md`.
- Never add AI attribution, so no `generated:` or `verified:` frontmatter.

Deployment is documentation like everything else: the runbook is
[Deploy to the VPS](../docs/how-to/deploy-to-the-vps.md) and the reasoning is
[Two environments](../docs/explanation/environments.md). `deploy/README.md`
only points at them.

Documentation describes what the code does now. If a change makes a page wrong,
fix the page in the same pull request.

## Development workflow

Work happens on a branch and lands through a pull request. 

[Cut a release](../docs/how-to/cut-a-release.md).

## Coding standards

- **No bare catchalls.** No untyped `catch` in TypeScript, no bare `except:` in
  Python. Catch the error you can handle and let the rest propagate.
- **No dynamic imports.** Keep the dependency graph analyzable. The ban is on
  kasten's own code; SHA-pinned third-party source may use them, which foliate
  does to pick a book's format.
- **Comments explain why.** The code already says what it does. A comment earns
  its place by recording the constraint, the surprise or the reason for a
  choice that looks odd. Match the density of the surrounding file.
- **SHA-pin third-party GitHub Actions.** `actions/*` and `github/*` may use
  `@vN`; everything else pins a full commit SHA with a trailing `# vX.Y.Z`.
- **Conventional Commits.** `<type>(<scope>)?: <subject>`, subject lowercase.
  `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
  `chore`, `revert`. Append `!` for breaking changes. PR titles follow the same
  rule. Nothing enforces this automatically, so it is on you.
- **Never add AI attribution** to commits, PRs, code or docs. No "Generated
  with", no "Co-Authored-By: Claude".
