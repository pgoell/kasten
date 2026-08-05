---
type: Tutorial
title: Getting started
description: Take a fresh clone to a running notebook that lists your notes.
tags: [setup, dev, first-run]
status: stable
---

# Getting started

By the end of this page you have kasten running on your own machine, with a
note of your own showing in the file tree. It takes about ten minutes, most of
it downloads.

You need Docker and [mise](https://mise.jdx.dev). mise installs everything
else, so you do not need Python, bun or Postgres up front.

## 1. Install the toolchain

From the repo root:

```sh
mise install
```

That reads `mise.toml` and pins Python 3.14, uv, bun and lefthook. mise asks
you to trust the config the first time it sees it. Say yes, or run
`mise trust` yourself. A clone that is not trusted makes the git hooks hang
with no output.

## 2. Install the dependencies

```sh
mise run install
```

This installs the git hooks, the backend packages with uv, and the frontend
packages with bun.

## 3. Start the database

```sh
mise run db:up
cp backend/.env.example backend/.env
mise run db:migrate
```

`db:up` starts kasten's own Postgres in Docker, published on port 5434. Every
value in `.env.example` is already the default, so the copy is optional, but
having the file makes your own overrides easy to find later.

## 4. Run both servers

Two terminals, because both stay in the foreground:

```sh
mise run dev      # backend on :8000
mise run fe:dev   # frontend on :5173
```

Open http://localhost:5173. The panel on the left says "No notes yet" and the
editor on the right holds a sample document.

The panel is empty because your notebook is empty. The `vault/` directory is
gitignored, so a clone brings you the software and none of the notes.

## 5. Add a note and watch it appear

The `vault/` directory at the repo root is your notebook. Create a file in it:

```sh
mkdir -p vault/daily
echo "# My first note" > vault/daily/today.md
```

Reload the page. `daily` shows in the tree now, with `today` under it. The
backend read that straight off disk: nothing wrote your note to Postgres, and
nothing had to.

Fold the tree away with Ctrl+B, or drag its right edge to resize it.

## 6. Open it and edit it

Click `today` in the tree. The note opens, and the URL gains
`?note=daily/today.md`, so a reload keeps your place.

The editor starts in vim's normal mode, so press `i` before you type. The ring
at the right of the bar along the foot of the window turns while you type and
settles, green, about a second after you stop. `:w` and Ctrl+S write at once
instead of waiting. Should a write fail, the ring gives way to a red warning
sign.

Read the file back:

```sh
cat vault/daily/today.md
```

Your edit is in it. It went to the file, and again nothing went to Postgres.

## 7. Give the vault a history

Every save writes over what was there. Make the vault a
[jj](https://jj-vcs.github.io/jj/) repo and the old text stays reachable:

```sh
jj git init --colocate vault
jj -R vault config set --repo user.name  "Your Name"
jj -R vault config set --repo user.email "you@example.com"
```

Edit the note again, then look:

```sh
jj -R vault log
```

There is a change named after the note you edited. Saving that note again
amends it; opening another note starts the next one.
[Recover an earlier version of a note](/how-to/recover-an-earlier-version.md)
covers getting the old text back.

This step is optional. A vault with no repo in it is saved to just the same,
and keeps no history, so an overwrite is final.

## What you cannot do yet

Notes can be opened and edited but not created or deleted from the browser, so
a new note is still a file you make yourself. Wikilinks, backlinks and search
are not built.

## Next

* [The vault and the derived index](/explanation/vault-and-derived-index.md) explains why your note went to disk and not to the database.
* [mise tasks](/reference/mise-tasks.md) lists every command you can run.
