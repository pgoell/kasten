# kasten: project instructions

A self-hosted markdown notebook with wikilinks and backlinks, in the shape of
Obsidian but served as a web page. Single user, running on a Hetzner VPS behind
oauth2-proxy.

## The one rule

The vault is a directory of `.md` files and it is the source of truth. Postgres
holds a derived index only, and you must be able to drop the schema and rebuild
it from the vault. Nothing that only exists in the database is allowed to
matter.

Check any change you make against that rule before you write it. The reasoning
is in [The vault and the derived index](../docs/explanation/vault-and-derived-index.md).

## What exists today

Real, working code, not a plan:

- `backend/`: FastAPI on Python 3.14, SQLAlchemy 2 async, Alembic, uv. Eight
  endpoints, `/api/health`, `/api/files`, `/api/search`, `GET`, `POST`, `PUT`
  and `PATCH` on `/api/files/{path}`, and `PATCH` on `/api/folders/{path}`. A create starts an
  empty note and makes the folders on the way to it; a `PATCH` gives a note or a
  folder a new path and takes the folders it emptied with it. A folder moves in
  one rename, so its whole subtree arrives together. All four writes are
  recorded in the vault's jj repo, one change per note, and skipped when the
  vault has none. Settings via pydantic-settings with the `KASTEN_` prefix.
- `frontend/`: React 19, Vite, TanStack Router and Query, Tailwind 4,
  CodeMirror 6 with vim mode, bun. A vault file tree, and a markdown editor
  that opens the note you click and writes it back as you type, or on `:w`.
  One prompt does three jobs: `Space c f` makes a note at a path you type,
  `Space r f` moves one that is there, and the tree's own `r` renames whatever
  the cursor sits on, a folder included. The tree's `c` is `Space c f` from
  there. All three complete the vault's folders. A finder opens a note by name:
  `Space f f`, or `f` in the tree, ranks every note in the vault against what
  you type and shows the one under the highlight beside the list. Search reads
  what is written in the notes instead: `Space f g`, or `s` in the tree, asks
  rg for the lines holding what you type and ranks them here, and Enter opens
  the note on the line. The open note lives in the URL as `?note=` and the
  line as `?line=`, and the note follows a folder that moves out from under
  it.
- `deploy/`: dev and prod compose files. Dev bind-mounts the tree and reloads;
  prod pulls GHCR images and deploys from a GitHub release.
- `vault/`: the notes, and a colocated jj repo holding their history.

Search reads the vault with rg on every query and indexes nothing, so it is
not a reason to start writing to Postgres.

Not built yet: deleting notes or folders, making a folder on its own, merging
two folders, wikilinks, backlinks, and anything that writes to Postgres.
The database schema is empty beyond Alembic's own table. Do not document these
as though they exist.

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

Two failure modes worth knowing before you lose an hour to them:

- A git hook that hangs printing nothing is mise waiting to trust the config.
  Run `mise trust`. Every fresh clone and every new worktree hits this.
- Frontend tests failing locally while CI is green usually means `node_modules`
  is a bun install on top of an old pnpm tree. Delete it and reinstall.

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

Deployment stays in `deploy/README.md`, next to the compose files it describes.

Documentation describes what the code does now. If a change makes a page wrong,
fix the page in the same pull request.

## Development workflow

Test-driven, red-green-refactor. Write the failing test, watch it fail for the
right reason, then write the code. The repo has real tests on both sides:
pytest in `backend/tests/`, vitest in `frontend/tests/`.

Work happens on a branch and lands through a pull request. Lefthook runs `lint`
before a commit and the tests plus the frontend typecheck before a push. CI
runs Lint and Test, and both must pass before main will take the merge. Main
requires linear history and merge commits are off, so squash or rebase.

Verify before you claim. A change is done when you have run the thing, not when
it looks right.

## Coding standards

- **No bare catchalls.** No untyped `catch` in TypeScript, no bare `except:` in
  Python. Catch the error you can handle and let the rest propagate.
- **No dynamic imports.** Keep the dependency graph analyzable.
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

## Writing style

Applies to all prose: docs, commit messages, PR bodies, code comments.

- No em-dashes (—) or en-dashes (–). Rewrite with commas, periods, colons,
  semicolons, parentheses, or split the sentence.
- No hyphens standing in for punctuation mid-sentence. Hyphens inside compound
  words are fine, and markdown horizontal rules are structural.
- Short words over long ones, active over passive, and cut what does not earn
  its place.

One exception, and it is deliberate: `index.md` files in `docs/` use the
`* [Title](url) - description` form because OKF specifies that shape for
directory listings.
