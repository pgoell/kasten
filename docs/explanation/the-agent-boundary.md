---
type: Explanation
title: The agent boundary
description: Why a token reaches five capabilities under /agent/ rather than the twenty-four routes the browser uses, and what it cannot do.
tags: [agent, tokens, security, api]
status: stable
---

# The agent boundary

Every route the backend serves sits behind `import oauth2_auth` in the
Caddyfile, and that snippet redirects a caller with no session to a browser
sign-in page. A headless agent cannot complete that flow. So the only agent that
could touch the vault was one running in the shell container, launched from
inside the app, or one holding an SSH key to the whole VPS.

The vault's own guide note said otherwise. It opens by telling an agent it may
be working on a machine outside the box and then teaches it curls against an API
no outside machine can reach.

The gap is narrow and real: a scheduled job, a CI step, or Claude Code on a
laptop that wants to read a note, search the vault and write something back.
None of those should need a shell, and none of them should get root on the
server to file a sentence into a daily note.

## Why not a token on the existing API

The first design published the twenty-four `/api/*` routes to bearer callers.
It did not survive review, and the reasons are worth keeping written down:

* `DELETE /api/folders/{path}` removes a whole subtree from the live vault.
* `PATCH /api/folders/{path}` rewrites wikilinks across every note there is. A
  move is a vault-wide edit, and getting one wrong from outside the box is a
  vault-wide mistake.
* `POST /api/anki` reads a ZIP member and decompresses it with no bound on the
  output, so a small upload becomes an unbounded allocation in the process that
  serves the browser.
* `POST /api/assets/{path}` accepts a 100MiB epub. The vault's history is told
  to ignore epubs and the delete route refuses them, so an agent could fill the
  disk with files no route and no history can remove.
* Telling a bearer caller apart from a browser caller meant trusting a header
  oauth2-proxy sets, and any container on the shared docker network can forge
  that against the backend directly.

An allowlist has none of those properties, because the dangerous routes are
never reachable rather than reachable-and-blocked. That is the whole argument
for a separate prefix: the audit is a list of five things, not a list of
twenty-four things with exceptions.

## What a token grants

Five capabilities and nothing else, listed in
[the Agent API](/reference/agent-api.md): list, read, search, save and append.

There is no delete, no move, no rename and no folder operation. The shell
container keeps the knife, and that makes the honest claim about this feature
"search, read, create and edit" rather than "file and reorganise". If a real
agent task turns out to be blocked on filing, that is the moment to revisit it.

There is no Anki import, no asset upload, no page fetch, no trash and no
terminal. Each is named individually above because each is a specific hazard
rather than a route that happened to be left out.

Every token grants all five. There are no scopes, no read-only tokens and no
expiry, which is a cut made for effort rather than a considered design. What a
token does have is a name and a revoke button, and that is the thing a single
environment variable cannot buy at any price: losing a laptop costs one revoke
rather than rotating a secret every agent shares.

## Why the write is conditional in one direction

A save carries the digest of the note the caller read, and is refused when the
note on disk is not that note. The comparison happens inside the same write lock
as the write, so nothing can slip between them.

This closes the direction that matters. An agent cannot overwrite an edit you
made in the browser between the agent's read and its write.

It does not close the other direction, and the feature does not claim to.
`PUT /api/files/{path}` stays unconditional, so the browser can still clobber an
agent's edit from an editor buffer that is a save behind. That is unchanged from
before this existed. Making the browser's save conditional too would change the
editor's save path, which is a separate piece of work.

## Where the tokens live

In a JSON file beside the vault, holding a name, a creation date and a SHA-256
digest per token. Never in the vault: a token there would enter jj history for
good and sit one search away from any agent reading notes. Never in Postgres
either, which has no tables and is not woken for this.

Only the digest is kept, so the file is worth nothing to whoever reads it and a
lost secret is replaced rather than recovered. SHA-256 rather than a slow hash,
because the secret is 256 bits of `secrets` output: brute-forcing the digest is
not a real failure mode, and argon2 would defend nothing while costing a hash on
every request.

A token store that does not exist reads as an empty list. There is no
configuration in which the gate opens.

## Where minting sits

The three routes that mint, list and revoke a token are under `/api/`, so they
inherit oauth2-proxy and carry no authentication of their own. The screen that
drives them is `/tokens` in the notebook.

That does put minting inside the internal trust zone: the shell container
reaches `/api/tokens` over the docker network with no session at all. It is
worth stating rather than hiding, and it grants that container nothing. It
already has the vault bind-mounted and unauthenticated access to every other
`/api/` route, so it can already do more than any token it could mint for
itself.

## What is recorded

The token's name goes into the description of the jj change its write makes, so
`jj log` reads `agent(laptop): daily/2026-08-18.md` where your own edit reads
`vault: daily/2026-08-18.md`. That is why there is no `last_used` field on a
token: it would mean a file write on every request to answer a question the
history already answers, and answers better.

A switch of writer opens a new change even when the note has not moved. That is
deliberate. An agent write must never amend the change holding your browser
edits, and the cost is that alternating edits to one note make more `jj log`
entries than they used to.

## What this does not protect against

One Caddy block is the entire boundary, it lives in another repository, and no
CI here can test it. What makes that survivable is that the backend gate is
mandatory rather than a second layer: a Caddy stanza that is wrong exposes an
endpoint answering `401`, not the vault. The deploy runbook carries three curls
that check exactly this, and the one that must never pass is a request with no
header returning anything but `401`.

An agent can also grow the vault without bound. There is no delete, so a looping
agent that creates notes cannot clean up after itself and you must use the
browser or the shell. Each request is capped at 1MiB, and the aggregate is not.

## Related

* [Agent API](/reference/agent-api.md) - the routes, the bearer rule and the digest contract
* [Connect an agent](/how-to/connect-an-agent.md) - how each client is configured
* [Two environments](/explanation/environments.md) - where the gate in front of everything else lives
* [Deploy to the VPS](/how-to/deploy-to-the-vps.md) - the Caddy stanza and the curls that check it
