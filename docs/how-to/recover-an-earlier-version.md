---
type: How-to Guide
title: Recover an earlier version of a note
description: Read back or restore a note as it was before a save overwrote it, from the history pane or with jj.
tags: [vault, jj, history, recovery]
status: stable
---

# Recover an earlier version of a note

Every save writes over what was there. The vault is a
[jj](https://jj-vcs.github.io/jj/) repo, so what was there is still readable.

This assumes the vault has a history. If `vault/.jj` is missing it does not,
and there is nothing to recover; see [Give the vault a
history](#give-the-vault-a-history) at the end.

## From the history pane

1. Open the note, and press `<leader>gh`. On a phone, tap `run` and pick
   **Show this note's history beside it**.
2. The pane opens beside the note and lists its changes, newest first, each
   with its time and description. A change from before the note moved shows
   its old path under it.
3. The newest change is picked, and its text shows against the note as it is
   now: a `-` line is one the restore takes away, a `+` line one it brings
   back. Move with `j` and `k` or the arrows and press `Enter`, or click or tap
   a change, to pick another.
4. Press `Ctrl+Enter`, or tap **Restore**, to write the picked change over the
   note.

The restore goes through the same save as your typing, but always opens a jj
change of its own, which shows at the top of the list. The text it replaced
stays in the change below it, so restoring that change undoes the restore.
Kasten refuses
it, and says why in the line under the diff, when:

* the note's own pane has the focus, or a save of the note is still in the air,
  which includes the save of what you typed just before you pressed `gh`;
* the note holds text a failed save left, listed on the status bar;
* somebody wrote the note after the diff was drawn. The pane reads the note
  again, so press `Ctrl+Enter` once more if the new diff is still what you want.

A change whose text is the note as it is now cannot be restored, and the line
says so. `Escape` or `q` closes the pane. Every key is in
[Editor keys](/reference/editor-keys.md#the-history-pane).

The rest of this page does the same with jj on the server.

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

* [HTTP API](/reference/http-api.md): the endpoint that writes, and what it records
* [The vault and the derived index](/explanation/vault-and-derived-index.md): why the history lives with the files
