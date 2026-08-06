---
type: Tutorial
title: Getting started
description: Take a fresh clone to a running notebook with notes of your own in it.
tags: [setup, dev, first-run]
status: stable
---

# Getting started

By the end of this page you have kasten running on your own machine, with two
notes of your own in the file tree: one you write on the shell, and one you
make from the browser. It takes about ten minutes, most of it downloads.

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
editor on the right holds a sample document, with the cursor already in it: the
page hands the editor the focus when nothing else has taken it.

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

Fold the tree away with space then `b`, or drag its right edge to resize it.
Space is the leader key, and space then `?` shows every binding kasten adds.
Space then `e` moves the cursor into the tree, where `j`, `k`, `h` and `l` move
around it the way they move around a note, and Escape comes back to the editor.
[Editor keys](/reference/editor-keys.md) lists the lot.

## 6. Make a note without leaving the browser

A note does not have to come from the shell. Press space, then `c`, then `f`.
A prompt opens over the editor. Type `reading/borges` into it.

The line under the input reads `creates folder reading/`, because your vault
has no `reading` yet. Press Enter. The note opens, empty, with the cursor
already in it, and the tree has grown both the folder and the note. Nothing
reloaded.

The prompt added the `.md` for you. While you type it lists the folders the
vault already has, at most twenty, ranked against the whole input, and Tab
takes the highlighted one, so `d` then Tab is the whole of `daily/`. The list
empties once you type the note's own name, which is the same ranking rather
than a fault: no folder is called `reading/borges`. The `＋` at the top of the
panel opens the same prompt for the mouse.

Look at what landed:

```sh
ls vault/reading
```

`borges.md` is there and it is empty. The folder was made because the note
needed one, and neither of them went near Postgres.

## 7. Open a note and edit it

Click `today` in the tree. The note opens, and the URL gains
`?note=daily/today.md`, so a reload keeps your place.

The note is rendered, not shown as source: the `#` is gone and the heading is
large. The editor starts in vim's normal mode, so press `i` before you type,
and that same keystroke turns the line under the cursor back into the markdown
behind it. [Live preview and the vim mode](/explanation/live-preview.md) says
why the mode decides that. The ring
at the right of the bar along the foot of the window turns while you type and
settles, green, about a second after you stop. `:w` and Ctrl+S write at once
instead of waiting. Should a write fail, the ring gives way to a red warning
sign. The left of the same bar carries the weekday, the date, the calendar week
and the time.

Read the file back:

```sh
cat vault/daily/today.md
```

Your edit is in it. It went to the file, and again nothing went to Postgres.

## 8. Give a note a better name

The note you made in step 6 sits in `reading/`. Say it belongs under the year.
Open it from the tree, then press space, then `r`, then `f`.

The prompt is back, this time headed `rename note`, holding `reading/borges.md`
with just `borges` selected. The folder and the `.md` are the parts a rename
usually keeps.

Select the whole input and type `reading/2026/borges` over it. The line
underneath reads `creates folder reading/2026/`. Press Enter.

The note moves, the tree grows `2026` under `reading`, and the URL follows to
`?note=reading/2026/borges.md`, so a reload still lands on it. Check what
happened on disk:

```sh
ls -R vault/reading
```

`2026/borges.md` is there. Anything you had typed and not yet saved went to the
old path before the note moved, so nothing was stranded.

Now try to rename it onto a name that is taken. Press space, `r`, `f` again,
select the whole input and type `daily/today` over it, which is the note from
step 5. The line reads `a note is already there` and Enter does nothing: the
vault will not write one note over another. Press Escape to back out.

Renaming from the tree works the same way and acts on the row the tree cursor
sits on, which need not be the note you have open. That one stays open.

## 9. Move a whole folder

The tree has its own keys, and they are single letters rather than leader
sequences. Press space then `e` to put the focus on it, then `j` and `k` until
the cursor sits on `reading`. Press `r`.

The prompt is back, headed `rename folder` and holding `reading`, with the whole
name selected. A folder has a name and not a suffix, so no `.md` is added to
whatever you type.

Type `archive` over it. The line underneath reads how many notes the move
carries. Press Enter.

Every note under `reading/` went with it, in one move:

```sh
ls -R vault/archive
```

`2026/borges.md` is there, under its new parent, and `vault/reading` is gone: a
folder the move emptied is one nothing would ever show again. If the note you
had open was one of the notes that moved, the URL followed it; if it was not,
the editor stayed where it was.

Two things the vault will not do. Press `r` on `archive` again and type
`archive/2026/deeper`: the line reads `a folder cannot move inside itself`. Type
`daily` instead, which is a folder that already exists, and it reads `a folder
is already there`. Merging two folders is a different thing and kasten does not
do it. Press Escape.

The tree's `c` is the same idea for making a note. With the cursor on a folder
it opens the new note prompt already holding that folder.

## 10. Give the vault a history

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

Notes can be made, opened, edited, renamed and moved from the browser, and so
can folders, except that a folder is never made on its own: it comes into being
when a note names it. Nothing can be deleted, so getting rid of a note is still
a file you delete yourself. Wikilinks, backlinks and search are not built.
Tables and images keep their syntax on screen, because live preview does not
render them yet.

## Next

* [The vault and the derived index](/explanation/vault-and-derived-index.md) explains why your note went to disk and not to the database.
* [mise tasks](/reference/mise-tasks.md) lists every command you can run.
