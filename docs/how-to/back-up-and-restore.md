---
type: How-to Guide
title: Back up and restore
description: Know which three things a self-hosted kasten holds, copy them every night with tar or push the vault's history with jj, and bring them back onto a fresh machine.
tags: [backup, restore, self-host, jj]
status: stable
---

# Back up and restore

The commands assume [the self-host stack](/how-to/self-host-kasten.md), run in
`deploy/selfhost/` with `KASTEN_DATA_DIR=./data`. On another layout, swap in
your own paths.

## What to keep

| What | Where | If you lose it |
| --- | --- | --- |
| The vault | `data/vault/` | Your notes are gone. Nothing rebuilds them |
| The token store | `data/agent/tokens.json` | Every agent is refused until you mint again and reconnect it |
| The shell's home | the `kasten-selfhost_shell-home` volume | Claude Code, codex and dsh ask you to log in again, and your `~/.zshrc` is empty |

The vault is the one that matters. It holds the notes, the jj history in
`.jj/` and `.git/` beside them, and `.trash/`, where a deleted note waits. Copy
the whole directory and the history comes along.

Two things need no backup. Caddy's `caddy-data` volume holds certificates,
which Caddy fetches again. And there is no database: the self-host stack runs no
Postgres, and no module the running backend imports opens a connection.

The token file holds digests, never secrets, so a copy of it leaks nothing. The
vault is plain markdown, so a copy of it is your notes in the clear; encrypt the
backup if it leaves the machine.

## Copy everything with tar

This works while kasten runs. A save replaces a note's file in one step, so tar
never reads half a note.

```sh
mkdir -p /srv/backups/kasten
tar -C data -czf /srv/backups/kasten/data-$(date +%F).tar.gz vault agent
docker run --rm -v kasten-selfhost_shell-home:/home -v /srv/backups/kasten:/out \
  alpine tar -C /home -czf /out/shell-home-$(date +%F).tar.gz .
```

To run it every night at three and keep thirty days, add this with
`crontab -e`, with the path to your clone:

```cron
0 3 * * * cd /path/to/kasten/deploy/selfhost && tar -C data -czf /srv/backups/kasten/data-$(date +\%F).tar.gz vault agent && find /srv/backups/kasten -name '*.tar.gz' -mtime +30 -delete
```

cron reads `%` as a line break, hence the backslashes. Copy
`/srv/backups/kasten` off the machine as well; a backup on the same disk dies
with it.

## Push the vault's history with jj

The vault is a jj repo with git beside it, so you can push it to a private git
remote, and every save goes along as its own change. It carries less than the
tar: the vault's `.gitignore` keeps epubs and pdfs out of the history, so books
and documents do not travel this way, and neither do the token store and the
shell's home. Keep the tar as well.

You need jj on the host, the version the backend image carries: 0.37.0 today,
`JJ_VERSION` in `backend/Dockerfile`. Run it as the user that owns the data
directory.

Once:

```sh
jj -R data/vault git remote add backup git@github.com:you/vault-backup.git
jj -R data/vault bookmark create backup -r @
jj -R data/vault bookmark track backup --remote=backup
```

Then each time, by hand or from cron:

```sh
jj -R data/vault bookmark set backup -r @
jj -R data/vault git push --remote backup --bookmark backup --allow-empty-description
```

`--allow-empty-description` is there because the first change in a fresh vault
has no description, and jj will not push it without the flag. The remote must
be private: it holds every note and every version of it.

## Restore

On the new machine, follow steps 1 to 3 of
[Self-host kasten](/how-to/self-host-kasten.md), skip step 4, since the backup
carries the vault's history, and put the data back before the first start.

From the tar:

```sh
docker compose down
mkdir -p data
tar -C data -xzf /srv/backups/kasten/data-2026-10-02.tar.gz
docker run --rm -v kasten-selfhost_shell-home:/home -v /srv/backups/kasten:/in \
  alpine tar -C /home -xzf /in/shell-home-2026-10-02.tar.gz
sudo chown -R 1000:1000 data
docker compose up -d
```

The `chown` gives the files to uid 1000, the user the containers run as.
`docker compose down` keeps volumes, so the shell's home survives it. On a
fresh machine the `docker run` makes the volume, and compose then warns that
it was not created by compose; the warning is harmless.

From the jj remote, in place of the vault from the tar:

```sh
jj git clone --colocate git@github.com:you/vault-backup.git data/vault
jj -R data/vault new backup@origin
jj -R data/vault config set --repo user.name "Your Name"
jj -R data/vault config set --repo user.email "you@example.com"
```

The identity lives in the repo's own config, which a push does not carry, so
set it again. Books and documents come back from the tar, not from here.

Then open the notebook and check a note you know. Mint new tokens if the token
store did not come back.

## Related

* [Recover an earlier version of a note](/how-to/recover-an-earlier-version.md): read back one note from the history, without a restore
* [Upgrade kasten](/how-to/upgrade-kasten.md): take a backup first
* [The vault and the derived index](/explanation/vault-and-derived-index.md): why the vault is the only thing that cannot be rebuilt
