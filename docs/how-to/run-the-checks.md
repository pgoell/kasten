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
mise run lint         # ruff, ty, biome, file size, folder size, copies
mise run test         # backend pytest and frontend vitest
mise run fe:typecheck # builds the frontend, then tsc --noEmit
```

CI runs the same three in two jobs, Lint and Test. Both must pass before a pull
request can merge into main. A pull request or push to main that changes no file,
such as a placeholder on an empty commit, skips them both, and a skipped job
counts as passed.

A push to main skips Lint, Test and Perf too when the pull request it merged
already passed them on the same tree. Each pull request run that passes all
three uploads an artifact named `ci-tested-tree-<tree hash>`, and the push run's
`Main gate` job, `scripts/ci_main_gate.py`, looks for it. It skips only for a
single-commit push of a merged pull request whose newest CI run passed Lint,
Test and Perf and recorded this tree; anything else, an API error included,
runs them in full. Its summary names the run it relied on or why it did not
skip.

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

The 111 files that failed when the rule came in sit on a list in the last
`overrides` entry of `frontend/biome.jsonc`, which turns the rule off for them.
That list only shrinks. When the rule fires on your function, split it: return
early instead of nesting, and lift a branch or a loop body into a function of
its own. Never add a file to the list or raise the limit;
`backend/tests/test_complexity_baseline.py` fails when the list holds more files
than its `MAX_FILES`.

To take a file off the list, make each of its functions pass, delete its line,
and lower `MAX_FILES` by one in the same commit. To see what fails on the
listed files:

```sh
cd frontend && bunx biome lint --only=complexity/noExcessiveCognitiveComplexity --max-diagnostics=200 src
```

## Get past the copy check

`lint:dup` runs jscpd over `frontend/src`, `backend/src` and `jobs/src` with
the settings in `.jscpd.json` at the root. A run of at least 70 tokens that appears twice counts
as a clone, and the check fails when clones make up more than 1% of the lines.
Generated code (`api-types.ts`, `routeTree.gen.ts`) and the fonts are left out.
On `main` the figure is 0.73%, 17 clones.

When it fails, it lists every clone with the two places it sits. Pull the
copied block into one function or component both places call, rather than
raising the threshold. To see the clones while it passes:

```sh
frontend/node_modules/.bin/jscpd
```

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
`ignore_imports` lines in `pyproject.toml`, 27 entries in
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

Globs for files that no one writes by hand are in `.file-size-excludes`.
Folders that are lists by design are in `.fan-out-excludes`. Folders over the
limit today are in `.fan-out-baseline`, and a folder may only shrink there.
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

## Answer the review on a pull request

Every pull request from this repo gets two Claude reviews in CI, `Review` and
`Security`, beside Lint and Test. Each posts its findings as threads on the
lines they name, tagged Important, Pre-existing or Nit, and a summary comment.
`REVIEW.md` at the root of the repo says what they look for.

1. Fix each Important finding with a test, or resolve its thread with one
   sentence on why it is not a bug. Main takes no merge while a thread is open.
2. Open an issue for each Pre-existing finding, and resolve the thread with
   its link. Fix a Nit or resolve it, as you see fit.
3. Push. Each review reads only the commits since its last round. After three
   rounds it stops and says so in its round comment: rethink the change rather
   than push a fourth fix.

A pull request from a fork or from Dependabot gets no review, as its run sees
no token: read it yourself. A run that fails, say on the plan's usage limit,
counts no round; rerun it.

## Approve a held pull request

The `Human gate` check holds a pull request that touches a path on
`.github/review/risk-paths`, or carries the `hold` label. Its summary lists the
paths. To let it merge, read it and add the `approved` label yourself: only the
repository owner's label counts, and the next push takes it off again.

While the pilot runs, the gate only reports: `ENFORCE: false` in
`.github/workflows/human-gate.yml` keeps it from blocking anything.

If pnpm built that tree, `.container/pnpm-store` is beside it holding a few
hundred megabytes that nothing reads any more. Delete it whenever you notice.

## Related

* [mise tasks](/reference/mise-tasks.md): every command, including the narrower ones
* [Code quality checks](/explanation/code-quality-checks.md): why the complexity rules and the copy check exist, and why their limits sit where they do
