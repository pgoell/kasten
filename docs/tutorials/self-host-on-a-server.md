---
type: Tutorial
title: Self-host on a server
description: Take an empty Linux server to a kasten of your own on the internet, behind a password, with a first note in it and Claude Code reading and writing that note.
tags: [self-host, deploy, first-run, agent]
status: stable
---

# Self-host on a server

By the end of this page kasten runs on a server of yours at an address of
yours, behind a password, with a note in it that you wrote in the browser and
Claude Code then added a line to. It takes about half an hour, most of it
waiting for DNS and image downloads.

The password is basic auth, the simplest of kasten's three login gates: one
user name and one password, asked for by the browser.
[Self-host kasten](/how-to/self-host-kasten.md) covers the other two,
oauth2-proxy and Tailscale.

To run kasten on your own machine for development instead, follow
[Getting started](/tutorials/getting-started.md).

## What you need

* A Linux server, `amd64` or `arm64`, reachable from the internet, with
  [Docker Engine and its compose plugin](https://docs.docker.com/engine/install/)
  installed. `docker compose version` should print 2.24 or later.
* A domain name you can add a DNS record to. This page writes
  `notes.example.com`; use your own name wherever it appears.
* Claude Code on your laptop, for the last part.

[Requirements](/reference/requirements.md) has the details.

## 1. Point the name at the server

At your DNS provider, add an `A` record for `notes.example.com` holding the
server's public IPv4 address. Then, from your laptop:

```sh
dig +short notes.example.com
```

When it prints the server's address, carry on. That can take a few minutes.

Ports 80 and 443 must be open to the internet. If your provider has a firewall
in its console, open them there.

## 2. Get the files

On the server:

```sh
git clone https://github.com/pgoell/kasten.git
cd kasten/deploy/selfhost
cp .env.example .env
```

Everything from here happens in `kasten/deploy/selfhost/`.

## 3. Choose a password

Make a bcrypt hash of it with Caddy, which asks for it twice:

```sh
docker run --rm -it caddy:2.11.4-alpine caddy hash-password
```

Open `.env` in an editor and set these four lines, with your name, your user
name and the hash it printed:

```sh
KASTEN_DOMAIN=notes.example.com
KASTEN_GATE=basicauth
KASTEN_BASIC_AUTH_USER=you
KASTEN_BASIC_AUTH_HASH='$2a$14$...'
```

Keep the single quotes around the hash. It is full of `$`, which compose would
otherwise read as variables.

## 4. Make the data directory

The notes live in `data/vault` on the server, and the agent tokens in
`data/agent`:

```sh
mkdir -p data/vault data/agent
id -u; id -g
```

If those two numbers are not both `1000`, put them in `.env` as `KASTEN_UID`
and `KASTEN_GID`. The containers run as that user, so they can write the files
you own.

## 5. Give the vault a history

kasten records every save in a jj repo inside the vault. Make one, with your
name on it, using the jj inside the backend image:

```sh
docker compose run --rm --no-deps backend jj git init --colocate /vault
docker compose run --rm --no-deps backend jj -R /vault config set --repo user.name "Your Name"
docker compose run --rm --no-deps backend jj -R /vault config set --repo user.email "you@example.com"
```

The first command pulls the backend image, so it takes a while. Each `config set` warns that the working copy's author stays empty. That is
the vault's first, empty change, and it does no harm.

## 6. Start it

```sh
docker compose up -d
docker compose ps
```

Wait until `backend` and `frontend` read `healthy`, about a minute. Caddy gets
a certificate for your name in that time. The shell installs Claude Code into
its home on this first start, under
[Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance),
because the image does not carry it.

Now open `https://notes.example.com` on your laptop. The browser asks for the
user name and password from step 3, and then shows the notebook: a file tree
on the left, with a folder of notes kasten wrote about itself, and an editor.

Check that a stranger is kept out. From your laptop:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://notes.example.com/api/health
```

`401`: the password is in front of everything.
[Self-host kasten](/how-to/self-host-kasten.md#6-check-the-gate) has the full
set of checks, the shell's among them. Run them once you finish this page.

## 7. Write a first note

Press space, then `c`, then `f`. A prompt opens. Type `reading/borges` and press Enter.

The note opens, with a folder made for it in the tree. Press `i` to start
typing, and write a line:

```
The garden of forking paths.
```

Press Escape. The ring at the right of the bar along the foot of the window
turns, then settles green: the note is on disk. On the server:

```sh
cat data/vault/reading/borges.md
```

Your line is there, under a block of frontmatter kasten added.

## 8. Mint a token

An agent reaches the vault with a token rather than the password. Go to
`https://notes.example.com/tokens`; no menu leads there, so type it. Type
`laptop` as the name and press **Mint**.

The secret shows once, and under it a line starting `claude mcp add`. Copy that
line now. Leave the page and the secret is gone for good; you would mint
another.

## 9. Connect Claude Code

On your laptop, paste the line you copied. It reads like this, with your secret
in place of the `x`s:

```sh
claude mcp add --transport http kasten https://notes.example.com/agent/mcp \
  --header "Authorization: Bearer kasten_xxxxxxxx"
```

Start Claude Code and type `/mcp`. `kasten` is listed as connected, with eight
tools.

Ask it:

```
Append "Borges wrote it in 1941." to reading/borges.md in kasten.
```

It calls `append_note`. Look at the browser tab: the line arrives in the open
note without a reload.

## 10. See who wrote what

On the server:

```sh
docker compose exec backend jj -R /vault log --limit 3
```

The top change reads `agent(laptop): reading/borges.md`. Your own edit below it
reads `vault: reading/borges.md`. Every agent write carries the name of the
token behind it, and you can undo any of them from here.

## What you have

kasten on your own server and your own name, with a certificate, a password in
front, a history of every save, and an agent that can read and write your notes
and nothing else.

## Next

* [Back up and restore](/how-to/back-up-and-restore.md): the vault is now the
  only copy of your notes. Do this today.
* [Connect an agent](/how-to/connect-an-agent.md): codex, claude.ai,
  chatgpt.com and the rest, and how to revoke a token.
* [Upgrade kasten](/how-to/upgrade-kasten.md): when a new release comes out.
* [Self-host kasten](/how-to/self-host-kasten.md): the other two gates.
* [Security model](/explanation/security-model.md): what the password guards
  and what it does not.
