---
type: Reference
title: "HTTP API: system"
description: Routes that report the process and its version, stream changes to the vault, name the terminals, and make, revoke and review agent tokens.
resource: backend/src/kasten_backend/routes/
tags: [api, backend, openapi]
status: stable
---

# HTTP API: system

The routes that report the process and its version, stream changes to the vault, name the terminals, and make, revoke and review agent tokens.

## GET /api/health

Reports that the process is up. It deliberately does not touch the database, so
it stays a liveness check and does not become a readiness check by accident.

```json
{ "status": "ok" }
```

## GET /api/version

Names the code that is answering. In production that is the release, read off
the installed package; in development it is the seven-character commit the
working tree is on, read out of `.git/HEAD` beside the source. A route of its
own rather than a field on `/api/health`, which the deploy polls and which says
nothing but whether the process is up.

```json
{ "backend": "0.8.0" }
```

The frontend's own half of that reading is not here and cannot be: a bundle in
a browser has no repo to ask, so `vite.config.ts` stamps it in at build time.
[Two environments](/explanation/environments.md#which-one-you-are-looking-at-and-what-it-is-running)
says what the status bar does with the pair.

## GET /api/terminals

Names every herdr session a terminal pane could attach to, sorted. Takes
nothing and answers with a JSON array of strings.

```json
["agent-kasten", "notes"]
```

This is the one endpoint that reads nothing of the vault. The shell container
keeps one directory per named session under its own home, and this lists that
directory through a read-only mount of the same volume. So the backend runs no
herdr, holds no socket, and cannot start, stop or read into a session; the
worst it can do is name one.

It says what exists rather than what is running, because a directory is all it
looks at. That costs nothing in practice: `herdr --session <name>` attaches to
a stopped session and starts a missing one alike, so the two are the same
request from the browser's side.

An absent directory is not an error and answers `[]`. The mount is optional and
the shell container need not be up for the notebook to work, so the terminal
prompt falls back to a bare input that takes a name typed by hand.

## GET /api/events

Reports every change to the vault as server-sent events, one `data:` line per
change. The response stays open until the client goes away.

```
retry: 30000

data: {"path": "daily/2026-08-05.md", "change": "written", "digest": "3fda1d2d4bdf392f4939d3d3d02a091bf16144d45b4cf691ae4c2f7662f14674"}
```

Each event names a path, what happened to it, and a digest of what is on disk
now. There are four kinds:

* `written`: the note is on disk, and `digest` is the sha256 of its bytes.
* `removed`: the note is gone, and `digest` is `null`.
* `listing`: the shape of the vault moved. `path` is empty, `digest` is `null`,
  and the client rereads `GET /api/files`.
* `page`: an html page in the vault was written. `path` names it, and `digest`
  is the sha256 of its bytes. It comes beside the `listing` the same change
  sends. A removed page sends no `page`, only the `listing`.

`listing` is how a folder move arrives. `PATCH /api/folders/{path}` is a single
rename, so the kernel names the directory and stops: no note under it fires at
all, and without this the client would keep drawing rows for notes that had
moved. One per batch whatever moved, because there is one file list to reread.

There is no kind for a note that is new. A write renames a temp file over the
note, Linux reports that as a move into place, and a note kasten has held for
weeks would announce itself as new on every save. Whether a note is new is a
question about the file list the client already holds, so the client answers it
there.

Nothing under a dot-directory is ever reported, which is the rule
`GET /api/files` lists by. That is what keeps the vault's own jj repo off the
stream: every write the backend makes touches `.jj`, and a save that reported
its own bookkeeping would say more about the repo than about the note.

The stream carries no note text, only the path, the kind and the digest. A
client that wants the new content reads the note the way it always does. The
digest is what lets it tell its own write coming back from someone else's:
kasten's writes are reported like any other, and nothing here tries to know
which was which.

Two lines are not events. A `retry:` field goes out first, telling the browser
to wait 30 seconds before opening the stream again, and a comment line goes out
every 30 seconds so that a quiet connection does not read as a dead one to the
proxies in front of it. `EventSource` swallows both before any handler sees
them.

Changes are gathered over a 100ms window, so an agent rewriting forty notes
costs a handful of messages rather than forty. A vault directory that does not
exist reads as one nothing ever happens in, so a fresh checkout still serves.

The stream must not be compressed on the way out. A proxy that gzips it buffers
the whole response, and the client then holds a connection that never delivers
a byte and never errors either.
[Two environments](/explanation/environments.md#constraints-the-box-imposes)
gives the Caddy fix.

## GET /api/tokens

Lists every [agent token](/reference/agent-api.md) the vault holds, with the
time each one last made a request.

```json
[{ "name": "laptop", "created": "2026-08-18T09:00:00+00:00", "last_used": "2026-08-18T09:05:00+00:00" }]
```

`last_used` is the time of the live token's latest request, and counts only what
that token itself made since it was minted: rows of a revoked token, or of an
earlier token under the same name, do not count. It is `null` when there is no
such request, and also when no database answers: the list still answers `200`,
and the backend logs a warning. The times come from [what kasten records](/how-to/connect-an-agent.md#what-kasten-records).

Never a digest and never a secret. Only the digest is kept at all, so there is
no way back to a secret from here even by mistake.

## GET /api/tokens/{name}/actions

The most recent requests one agent token made, newest first, at most 50. Each
is a row of [what kasten records](/how-to/connect-an-agent.md#what-kasten-records).

```json
[{
  "at": "2026-08-18T09:05:00+00:00",
  "client": "203.0.113.7",
  "method": "POST",
  "path": "/agent/mcp",
  "tool": "save_note",
  "note": "daily/2026-08-18.md",
  "status": 200,
  "outcome": "ok"
}]
```

`client`, `tool` and `note` are `null` when the request had no such value. The
`outcome` is `ok`, `error` or `revoked`. `client` is the address Caddy saw, from
`Cf-Connecting-Ip`, else the last `X-Forwarded-For` hop, else the peer; a caller
inside the server can set those headers. `path`, `note` and `tool` are cut to
1024 characters. Answers `503` when no database answers within
`KASTEN_ACTIVITY_TIMEOUT_SECONDS`.

## POST /api/tokens

Mints one agent token and hands back the only copy of its secret.

```json
{ "name": "laptop" }
```

```json
{
  "name": "laptop",
  "created": "2026-08-18T09:00:00+00:00",
  "secret": "kasten_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

`201`, and the one moment the secret exists outside its holder. It is not
recoverable: the store keeps a SHA-256 digest and nothing else, so a lost secret
is replaced rather than found.

A name already taken is a `409`, the create's answer, because the user is about
to retype it and has to know which it was.

This route is under `/api/`, which means it inherits the login gate and carries
no authentication of its own. That does put minting inside the internal trust zone,
and [The agent boundary](/explanation/the-agent-boundary.md) says why that grants
the shell container nothing it does not already have.

## DELETE /api/tokens/{name}

Revokes one agent token, and answers `204`.

The next request carrying that token is refused. Nothing is held between
requests, so there is no window in which a revoked token still works.

The record moves from `tokens.json` to `tokens-revoked.json` beside it. A request
the revoked token makes after that is still recorded, with the outcome
`revoked`. Its rows stay for 90 days and show in the actions list of a token
minted later under the same name, such as a reconnect through OAuth. This list
leaves the revoked token out.

`tokens-revoked.json` keeps the last 50 records, in the order they were
revoked; a revoke drops the older ones. Dropping one cannot let its token back
in, since only `tokens.json` admits a bearer: a token whose record is gone is
refused as unknown, and only the action log stops naming it. A
`tokens-revoked.json` the backend cannot read (a permission error, a directory
in its place, bad JSON, or anything but a list of records) does not open the
gate either: every bearer `tokens.json` does not hold gets a 401, and the
backend logs a warning with the path. The next revoke moves that file to
`tokens-revoked.json.broken` and starts a fresh one; when that move fails, the
revoke still takes the token out of `tokens.json`, leaves the revoked file as it
is and logs a warning.

A `tokens.json` the backend cannot read refuses every bearer with a 401 and a
logged warning. Minting, revoking and listing raise on it and write nothing.

Either file counts as unreadable when a record's `digest` is not 64 lowercase
hex characters, the only form the backend writes, since no secret could match
it.

A name the store has not got is a `404`.

