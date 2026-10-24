---
type: How-to Guide
title: Run the checks
description: Run the linters, tests and type checks, and get past the two ways the git hooks go wrong.
tags: [testing, lint, git-hooks, ci]
status: stable
---

# Run the checks

Everything CI runs, you can run:

```sh
mise run lint         # ruff, ty, biome, file size, copies
mise run test         # backend pytest and frontend vitest
mise run fe:typecheck # builds the frontend, then tsc --noEmit
```

CI runs the same three in two jobs, Lint and Test. Both must pass before a pull
request can merge into main.

## The hooks

Lefthook runs some of this for you, from `.config/lefthook.yaml`:

* `pre-commit` runs `mise run lint`, which stays fast on purpose, and the file
  size check on the staged files.
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

When one fires, make the function simpler rather than silencing it: lift a
closure or a loop with a job of its own into a module function, give each
branch of a long `elif` chain its own method, or pass two values that travel
together as one tuple. Use `# noqa` only where the function reads better whole,
with a comment above it saying why, as `apkg` in `backend/tests/anki_build.py`
has.

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

`lint:dup` runs jscpd over `frontend/src` and `backend/src` with the settings in
`.jscpd.json` at the root. A run of at least 70 tokens that appears twice counts
as a clone, and the check fails when clones make up more than 1% of the lines.
Generated code (`api-types.ts`, `routeTree.gen.ts`) and the fonts are left out.
On `main` the figure is 0.73%, 17 clones.

When it fails, it lists every clone with the two places it sits. Pull the
copied block into one function or component both places call, rather than
raising the threshold. To see the clones while it passes:

```sh
frontend/node_modules/.bin/jscpd
```

## Find files over the size limit

An authored file should stay under 5,000 tokens, counted as bytes divided by
four (20 KB). To list every tracked file over it:

```sh
python3 scripts/file_size.py
```

To check particular files, pass their paths:

```sh
python3 scripts/file_size.py docs/log.md frontend/src/routes/index.tsx
```

The pre-commit hook runs `mise run lint`, and its `lint:size` checks every
tracked file as it stands in the working tree. A commit fails while any tracked
file is over the limit, staged or not. The hook also runs the check on the staged
files, which names a staged file over the limit on its own. CI's Lint job runs
`mise run lint` too. The [file size limit](/explanation/file-size-limit.md)
page says why the limit exists and how to split a file that is over it.

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

## Related

* [mise tasks](/reference/mise-tasks.md): every command, including the narrower ones
* [Code quality checks](/explanation/code-quality-checks.md): why the complexity rules and the copy check exist, and why their limits sit where they do
