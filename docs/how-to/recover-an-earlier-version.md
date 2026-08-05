---
type: How-to Guide
title: Recover an earlier version of a note
description: Read back or restore a note as it was before a save overwrote it.
tags: [vault, jj, history, recovery]
status: stable
---

# Recover an earlier version of a note

Every save writes over what was there. The vault is a
[jj](https://jj-vcs.github.io/jj/) repo, so what was there is still readable.

This assumes the vault has a history. If `vault/.jj` is missing it does not,
and there is nothing to recover; see [Give the vault a
history](#give-the-vault-a-history) at the end.

## See what happened to a note

Changes are named after the note they hold, one per note rather than one per
save:

```sh
jj -R vault log
```

To narrow it to one note:

```sh
jj -R vault log -r 'files("root:daily/2026-08-05.md")'
```

## Read an old version without changing anything

`@` is the change in hand, `@-` its parent, and any change id from the log
works in the same place:

```sh
jj -R vault file show -r @- 'root:daily/2026-08-05.md'
```

Use `root:` in front of the path. A bare path is read relative to the directory
you are standing in, which is the repo root only by luck.

Send it somewhere to compare:

```sh
jj -R vault file show -r @- 'root:daily/2026-08-05.md' > /tmp/before.md
diff /tmp/before.md vault/daily/2026-08-05.md
```

## Put an old version back

Restore the one note, leaving every other note alone:

```sh
jj -R vault restore --from @- 'root:daily/2026-08-05.md'
```

The note on disk is now the older text, and kasten serves it on the next read.
A note open in a browser tab still holds the newer text in the editor, and the
next keystroke writes it back over the restore, so reload the tab first.

## Undo the last thing that happened

Every save is an operation, so this reaches a single one:

```sh
jj -R vault op log
jj -R vault undo            # reverse the last operation
jj -R vault op restore <id> # or go back to a moment in the list
```

## Give the vault a history

A vault with no repo in it is saved to normally and kept no history of. To
start one:

```sh
jj git init --colocate vault
jj -R vault config set --repo user.name  "Your Name"
jj -R vault config set --repo user.email "you@example.com"
```

`--colocate` keeps a git repo alongside, so `git -C vault push` still works for
backup and so do the git tools you already have. The identity goes on the repo
because the backend runs jj from a container with no home directory to read a
personal config out of.

## Related

* [HTTP API](/reference/http-api.md) - the endpoint that writes, and what it records
* [The vault and the derived index](/explanation/vault-and-derived-index.md) - why the history lives with the files
