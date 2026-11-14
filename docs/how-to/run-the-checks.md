---
type: How-to Guide
title: Run the checks
description: Run the linters, tests and type checks, answer the CI review, approve a held pull request, and get past the two ways the git hooks go wrong.
tags: [testing, lint, git-hooks, ci]
status: stable
---

# Run the checks

Everything CI runs, you can run:

```sh
mise run lint         # ruff, ty, biome, file size, folder size, comments, copies, API contract
mise run test         # backend pytest and frontend vitest
mise run fe:typecheck # builds the frontend, then tsc --noEmit
```

CI runs the same three in three jobs: Lint, Backend for pytest and Test for the
frontend and chat runner tests. All must pass before a pull request can merge
into main, and so must the `Review` and `Security` checks below. A pull request
or push to main that changes no file, such as a placeholder on an empty commit,
skips them, and a skipped job counts as passed.

`mise run test:py` runs pytest on four workers with `pytest-xdist`, each with a
database of its own. To debug one test in order, call `uv run pytest <path>`
yourself.

A new test goes at the highest layer that reproduces the bug: e2e, frame, unit
or pytest. [Testing layers](/explanation/testing-layers.md) says why.

A push to main skips Lint, Backend, Test and Perf too when the pull request it merged
already passed them on the same tree. Each pull request run that passes all
four uploads an artifact named `ci-tested-tree-<tree hash>`, and the push run's
`Main gate` job, `scripts/ci_main_gate.py`, looks for it. It skips only for a
single-commit push of a merged pull request whose newest CI run passed Lint,
Backend, Test and Perf and recorded this tree; anything else, an API error included,
runs them in full. Its summary names the run it relied on or why it did not
skip.

A pull request also runs `Dependencies`, a required check that lists the
packages it adds to `uv.lock` and `frontend/bun.lock` against the merge base,
with each one's licence and latest release date, in the job summary. It reads
the licence from the registry's metadata (PyPI's JSON API, the npm registry),
never from a README, and fails on a licence outside MIT, BSD, Apache-2.0, ISC,
PostgreSQL and MPL-2.0, or one it cannot read, naming the package. To get a
package past it whose licence you have read and accept, add it to `ACCEPTED`
in `.github/deps/new_dependencies.py` with the reason; that file is a code
owner's path, so pgoell reviews the line.

Every Monday the `Audit` workflow checks every package already locked, not
only new ones, against the advisories: `uv audit` on `uv.lock`, `bun audit`
on `frontend/bun.lock` and `e2e/bun.lock`. It fails on any known hole, and
GitHub mails the failure to whoever last changed its cron. Run the same
commands locally to see the list, or start it by hand from the Actions tab.
On the same day Dependabot opens one pull request per ecosystem (uv, bun,
docker) with the minor and patch bumps, and one of its own for each major
bump, except postgres, whose major moves by hand with `pg_upgrade`. Actions
are not grouped: each Action bump comes as its own pull request.

## Run the end-to-end journeys

`mise run e2e` builds the frontend, then runs the Playwright journeys in `e2e/`
against it. You need Docker, for Postgres and nginx, and Chromium. Each test gets
its own copy of the fixture vault, its own database and its own backend, and
teardown removes the containers. Unlike `fe:e2e`, it stubs no API.

The journeys sit in `e2e/journeys/`: review in `review/` (a sitting, a question jotted in one, a cloze card, Enter on the overview's rows, the daily limits, the sitting's keys with vim on and off, and the deck notes that could not be read), panes in
`panes/` (layout and the top bar, the pane and tab keys, pane acts whose write is held while the focus moves, links to pages and assets; a note changed on disk under
unsaved text and a conflicted note reopened in `panes/conflict/`; the stored workspace across a reload, held text in a restored pane and a URL over a stored workspace in `panes/workspace/`), notes, the finder, a tree row moved by a drag, the new note prompt's folder rows and the save sign in the status bar in `notes/`, with saving in `notes/saving/` (edits,
the backlinks panel's mention links, held text) and the content search in `notes/search/`, the todo list, the board,
a person note's card of open todos and the shared lists app in `todos/`, capture, the web page import prompt, the chat pane's drawing of a reply and the log in `day/`, and the book, video and clip panes and csv and svg files in
`media/`. `harness.spec.ts` checks the harness itself. Each journey is a
thing done daily, and each one that writes checks the file on disk. Twenty-seven files
also run journeys at phone width, 414 px with touch, where the editor starts
without vim: `review/sitting.spec.ts`; `notes/finder.spec.ts`, `notes/status-bar.spec.ts`, the three
`notes/search/content-search-*.spec.ts`, `notes/search/book-open-listing.spec.ts`, `notes/saving/edits.spec.ts` and
`notes/saving/mentions.spec.ts`; `panes/links.spec.ts`, `panes/narrow/drawer.spec.ts`,
`panes/narrow/phone.spec.ts`, `panes/narrow/key-help.spec.ts` and `panes/workspace/reload.spec.ts`;
`todos/list.spec.ts`, `todos/board.spec.ts`, `todos/twin-ids.spec.ts`,
`todos/person-card.spec.ts` and `todos/lists.spec.ts`; `day/capture.spec.ts` and `day/log.spec.ts`; and
`media/book.spec.ts`, `media/book-finder.spec.ts`, `media/clip.spec.ts`,
`media/csv.spec.ts`, `media/svg.spec.ts` and `media/video.spec.ts`.
`phone` in `e2e/harness/app.ts` sets that up, and
`git grep -l 'test.use(phone)' e2e/journeys` lists them.
A runner has no YouTube, so the video journey serves a fake player for each
embed (`fakeYouTube` in `e2e/harness/youtube.ts`) and aborts any other request
that would leave the box.
The journeys block the service worker: Chromium crashed closing a context while
it installed (#1606). `mise run fe:e2e` checks the offline worker.

Install Chromium once, after `mise run e2e` has put the packages in `e2e/node_modules`:

```sh
e2e/node_modules/.bin/playwright install chromium
```

To run one journey:

```sh
cd e2e && mise exec -- bunx playwright test journeys/<file>
```

On failure, the run writes a trace and a screenshot to `e2e/test-results/`. Open
a trace from `e2e/` with `bunx playwright show-trace <zip>`.

CI's E2E jobs run the same journeys on every pull request, split in two by
`E2E_SHARD=1/2` and `2/2`, each on 3 workers where a local run takes 4. Set
`E2E_SHARD` yourself to run one slice locally. They are not required checks
yet. Each slice's `e2e-results-<n>` artifact holds its traces and screenshots.

## The hooks

Lefthook runs some of this for you, from `.config/lefthook.yaml`:

* `pre-commit` runs `mise run lint`, which stays fast on purpose, and the file
  size and folder size checks on the staged files.
* `pre-push` runs `mise run test` and `mise run fe:typecheck`.

Anything slow enough to make you reach for `--no-verify` belongs in pre-push,
not pre-commit.

## Get a backend function past the complexity rules

Besides its style and bug rules, ruff in `lint:py` holds every backend function,
tests included, to these limits, all set in the root `pyproject.toml`:

* `C901`: a McCabe complexity of at most 10. Each `if`, `elif`, loop, `except`,
  `case` and nested `def` adds one; a boolean operator, a conditional
  expression and a comprehension add nothing.
* `PLR0911`, `PLR0912`, `PLR0915`: at most 6 returns, 12 branches and 50
  statements.
* `PLR0913`: at most 5 arguments, keyword-only ones included.
* `TID252`: no relative import, the sibling kind (`from .x import y`)
  included; import by the package name.

When one fires, make the function simpler rather than silencing it: lift a
closure or a loop with a job of its own into a module function, give each
branch of a long `elif` chain its own method, or pass two values that travel
together as one tuple. Use `# noqa` only where the function reads better whole,
with a comment above it saying why, as `apkg` in `backend/tests/anki_build.py`
has. The 12 relative imports in the job and finance tests that were there when
the ban came in carry a `# noqa: TID252` each, and a new one fails.

## Get a frontend function past the complexity rule

Biome, in `fe:lint` and `shell:lint`, fails any function with a cognitive
complexity over 15 (`noExcessiveCognitiveComplexity`, set in
`frontend/biome.jsonc`). Each `if`, loop, `catch` and `? :` adds one, plus one
for every level of nesting it sits in; a run of `&&` or `||` adds one.

One file stays exempt: `src/lib/notes/note/save-queue.ts`, the last of the
files that failed when the rule came in, which pgoell keeps. It sits in the last
`overrides` entry of `frontend/biome.jsonc`, and that list may not grow. When
the rule fires on your function, split it: return early instead of nesting, and
lift a branch or a loop body into a function of its own. Never add a file to the
list or raise the limit; `backend/tests/test_complexity_baseline.py` fails when
the list holds more files than its `MAX_FILES` of 1.

To see what fails:

```sh
cd frontend && bunx biome lint --only=complexity/noExcessiveCognitiveComplexity --max-diagnostics=200 src
```

## Get past the copy check

`lint:dup` runs jscpd over `frontend/src`, `backend/src` and `jobs/src` with
the settings in `.config/jscpd.json`. A run of at least 70 tokens that appears twice counts
as a clone, and the check fails when clones make up more than 1% of the lines.
Generated code (`api-types.ts`, `routeTree.gen.ts`) and the fonts are left out.
On `main` the figure is 0.73%, 17 clones.

When it fails, it lists every clone with the two places it sits. Pull the
copied block into one function or component both places call, rather than
raising the threshold. To see the clones while it passes:

```sh
frontend/node_modules/.bin/jscpd --config .config/jscpd.json
```

## Get past the comment checks

`lint:comments` runs `scripts/structure/check-comments` over `frontend/src`,
`backend/src` and `jobs/src`, generated `api-types.ts` and `routeTree.gen.ts`
left out. It fails in two ways:

* `<file> is N% comment lines`: a file of 20 lines or more is over 20% lines
  that hold only a comment, and over its line in `.config/comment-ratio-baseline`.
  Docstrings and JSDoc blocks are left out of both sides of the share, and a
  comment after code on the same line counts as code.
* `<file> has N docstrings or JSDoc blocks over 6 lines`: the file holds more
  of them than its line in `.config/long-docstring-baseline`, or any with no line.
  The count includes the `/**` and `*/` lines, so a body of five lines between
  them is already too long.

Fix the comment, not the count. Delete history (it goes in the commit message
or `docs/`), the code read back in prose, and anything a name or a doc already
says. Cut what is left to one or two lines that record a constraint, a
surprise or an issue number. A docstring says what a caller needs. Moving the
text to another comment or a new file is not a fix, and neither is raising a
baseline.

When a file gets better, lower its lines in both baselines:

```sh
uv run python scripts/structure/check-comments --update-baseline
```

It only lowers or drops lines; a file that was not on a baseline stays off it.

## Get past the import checks

`lint:imports` runs three checks. import-linter reads the contracts in
`[tool.importlinter]` of the root `pyproject.toml`: the jobs never import the
backend, only `main` imports `kasten_backend.routes`, nothing imports `main`,
and no two sibling modules import each other. dependency-cruiser reads
`frontend/.dependency-cruiser.cjs` over `src`, `sw` and `scripts`: no cycles,
`lib` never imports `components` or `routes`, `components` never imports
`routes`, the lists app and the notebook stay apart, and no dynamic `import()`.
dependency-cruiser cannot follow an `import()` of a variable or a template, or
`import.meta.glob`, so a `git grep` bans those. In Python, ruff's `TID251` bans
`importlib.import_module`, `importlib.reload`, the `importlib.util` loaders,
`importlib.machinery`, `pkgutil` and `runpy`, and a `git grep` bans the builtin
`__import__`. The frontend's root config files (`vite.config.ts` and the like)
are not scanned. `frontend/tests` is not scanned: vitest's mock-then-`await
import` is how a test loads a module fresh.

Each failure names the rule and the fix. Fix the import. The breaches that were
there when the checks came in are accepted, so only new ones fail: 19
`ignore_imports` lines in `pyproject.toml`, 26 entries in
`frontend/.dependency-cruiser-known-violations.json` (with the four heavy
bundles `.claude/CLAUDE.md` allows) and two `# noqa: TID251`. When you fix one,
drop its line, or refresh the frontend list:

```sh
cd frontend && node_modules/.bin/depcruise src sw scripts --config .dependency-cruiser.cjs --output-type baseline > .dependency-cruiser-known-violations.json
bunx biome format --write .dependency-cruiser-known-violations.json
```

A stale `ignore_imports` line fails import-linter, and a test fails when the
frontend list differs from a fresh run, so neither list can hide a new breach.

## Find files and folders over the limits

An authored file should stay under 5,000 tokens, counted as bytes divided by
four (20 KB). A folder should hold about seven entries, files and folders alike.
To list every file over the first limit, which is every file committed at HEAD:

```sh
scripts/structure/check-file-size
```

To check particular files, pass their paths. The check then sizes the staged
copy of each:

```sh
scripts/structure/check-file-size docs/log.md frontend/src/routes/index.tsx
```

To list every folder over the second limit:

```sh
scripts/structure/check-fan-out --all
```

Globs for files that no one writes by hand are in `.config/file-size-excludes`.
Folders that are lists by design are in `.config/fan-out-excludes`. Folders over the
limit today are in `.config/fan-out-baseline`, and a folder may only shrink there.
Run `scripts/structure/check-fan-out --update-baseline` after a folder shrinks to
lower its line. Do not raise a line to pass.

The pre-commit hook runs `mise run lint`, whose `lint:size` and `lint:fanout`
check the whole repo, and it runs both checks on the staged files, which names a
staged file or folder over a limit on its own. CI's Lint job runs `mise run lint`
too. Claude Code also runs both checks after each edit it makes. The
[file and folder limits](/explanation/file-size-limit.md) page says why the
limits exist and how to split a file or folder that is over one.

## When the hook hangs with no output

A commit that sits there printing nothing but the lefthook banner is mise
waiting for you to trust the config. It happens in every fresh clone and every
new git worktree, because mise trusts by path.

```sh
mise trust
```

Then commit again.

## When node_modules is a pnpm and bun hybrid

This project moved from pnpm to bun. A `node_modules` directory that pnpm
built and bun later installed into is broken in a way that neither tool
reports, because bun writes its flat tree over the top without clearing
pnpm's, and pnpm's top-level entries are symlinks into `.pnpm/`. What is left
is a mix of real directories and symlinks pointing at packages that are no
longer there.

It surfaces differently depending on which copy is stale, and there are two
copies.

**Your own tree, `frontend/node_modules`.** The symptom is the vim test in
`frontend/tests/editor-save-and-undo.test.tsx` failing locally while CI is green. Two copies
of `@codemirror/state` survive the mix, so vim mode binds to a different editor
instance than the one under test and the keystrokes go nowhere.

```sh
rm -rf frontend/node_modules
mise run fe:install
```

**The container's tree, `.container/node_modules`.** The hosted dev environment
mounts this instead of yours, and it persists across restarts. The container
installs again whenever `bun.lock` changes, so a package added there needs
nothing from you. A stale tree is another matter: no install clears it, and it
outlives every `dev:restart`. The symptom is the page loading
while the stylesheet 500s, with `ENOENT` on a path under
`node_modules/.pnpm/tailwindcss@x.y.z/` in the logs.

```sh
docker compose -f compose.yaml -f compose.dev.yml stop frontend-dev
rm -rf .container/node_modules && mkdir -p .container/node_modules
docker compose -f compose.yaml -f compose.dev.yml up -d frontend-dev
```

Recreate the directory yourself before starting the container, as above. It is
a bind mount, so Docker creates it as root if it is missing, and the container
runs as uid 1000 and cannot then write to it.

If pnpm built that tree, `.container/pnpm-store` is beside it holding a few
hundred megabytes that nothing reads any more. Delete it whenever you notice.

## Answer the review on a pull request

Every pull request from this repo gets two Claude reviews in CI, `Review` and
`Security`, once Lint, Backend and Test pass; a pull request that fails any gets no
round. Only Important findings become threads on the lines they name, and main
takes no merge while a thread is open. Design, Pre-existing and Nit findings
from `Review` are lines in its summary comment, and nothing waits on them.
`REVIEW.md` at the root of the repo says what they look for, and the review
also reads the issues the pull request closes or is part of, when pgoell or the
pull request's author wrote them.

1. Answer each Important thread with a reply whose first word says what you
   did, then resolve it: `Fixed` (with a test), `Rejected` (it is not a bug,
   and why), `Intentional` (it is meant so, and why) or `Didn't matter`.
2. Read the summary. Make the Design changes you agree with, open an issue for
   each Pre-existing line, and leave the rest.
3. Push. Each review reads only the commits since its last round, with no
   limit on the rounds. After round 1, `Security` runs only when the new
   commits change more than 100 lines or touch a path in `.github/CODEOWNERS`;
   otherwise it passes, and its round comment says it skipped and why. A
   skipped push counts no round, and the next `Security` round reads its
   commits too.

To see how the findings were answered, run
`python3 .github/review/outcomes.py [days] [sample size]`. It counts the
Important threads of pull requests merged in the last 7 days by the first word
of their answer, counts pull requests by rounds, and lists 5 whose summaries
held Design points. An agent fixes whatever it is told, so read those 5
yourself to judge whether the Design points were worth making.

A pull request from a fork or from Dependabot gets no review, as its run sees
no token: read it yourself. A draft gets none until it is marked ready. A run
that fails, say on the plan's usage limit, counts no round; rerun it. `Review`
and `Security` are required checks, so a failed run blocks the merge until it
passes.

## Approve a held pull request

A pull request that touches a path in `.github/CODEOWNERS` waits for pgoell's
approving review. Read it and approve it in GitHub, or `gh pr review N
--approve`. A push dismisses the approval, so approve again after one. The
issue loop pushes as its bot account, so its pull requests can be approved;
a Dependabot pull request touches a lock file and waits too.

A risky pull request of your own you cannot approve, as GitHub does not let an
author approve their own. Merge it with `gh pr merge N --admin` once the checks
pass: branch protection does not hold admins, and only pgoell is one.

## Related

* [mise tasks](/reference/mise-tasks.md): every command, including the narrower ones
* [Code quality checks](/explanation/code-quality-checks.md): why the complexity rules, the comment checks and the copy check exist, and why their limits sit where they do
