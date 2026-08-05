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
mise run lint         # ruff, ty, biome
mise run test         # backend pytest and frontend vitest
mise run fe:typecheck # builds the frontend, then tsc --noEmit
```

CI runs the same three in two jobs, Lint and Test. Both must pass before a pull
request can merge into main.

## The hooks

Lefthook runs some of this for you, from `.config/lefthook.yaml`:

* `pre-commit` runs `mise run lint`, which stays fast on purpose.
* `pre-push` runs `mise run test` and `mise run fe:typecheck`.

Anything slow enough to make you reach for `--no-verify` belongs in pre-push,
not pre-commit.

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
`frontend/tests/editor.test.tsx` failing locally while CI is green. Two copies
of `@codemirror/state` survive the mix, so vim mode binds to a different editor
instance than the one under test and the keystrokes go nowhere.

```sh
rm -rf frontend/node_modules
mise run fe:install
```

**The container's tree, `.container/node_modules`.** The hosted dev environment
mounts this instead of yours, and it persists across restarts, so a stale one
outlives every `dev:restart` you throw at it. The symptom is the page loading
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

* [mise tasks](/reference/mise-tasks.md) - every command, including the narrower ones
