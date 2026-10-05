---
type: Explanation
title: The agent boundary
description: Why a token reaches eight capabilities under /agent/ rather than the thirty-one routes the browser uses, and what it cannot do.
tags: [agent, tokens, security, api]
status: stable
---

# The agent boundary

Before `/agent/` existed, every route the backend served sat behind the login
gate in front of it, which on the maintainer's box is `import oauth2_auth` in
the Caddyfile and redirects a caller with no session to a browser sign-in page. A headless agent
cannot complete that flow. So the only agent that
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
for a separate prefix: the audit is a list of eight things, not a list of
twenty-four things with exceptions.

## What a token grants

Eight capabilities and nothing else, listed in
[the Agent API](/reference/agent-api.md): list, read, search, graph, save,
append, dump and file.

There is no delete, no move, no rename and no folder operation. The shell
container keeps the knife, and that makes the honest claim about this feature
"search, read, create and edit" rather than "file and reorganise". If a real
agent task turns out to be blocked on filing, that is the moment to revisit it.

There is no Anki import, no trash and no terminal. Each is named individually
above because each is a specific hazard rather than a route that happened to be
left out. The asset upload and the page fetch were on that list too, until the
eighth capability below took a narrow piece of each.

Every token grants all eight. There are no scopes, no read-only tokens and no
expiry, which is a cut made for effort rather than a considered design. What a
token does have is a name and a revoke button, and that is the thing a single
environment variable cannot buy at any price: losing a laptop costs one revoke
rather than rotating a secret every agent shares.

## Why a sixth capability is acceptable

The list was five for a long time, and the argument for keeping it short is the
audit: every item on it is a thing to reason about when a token leaks. `dump`
earns its place because it adds nothing new to that reasoning. It is a
narrower append, not a new kind of power.

It writes into one section of one note, the daily note for the day it is
given, and the vault already owns that note: `<leader>gd` makes it and the
ritual reads it. The caller chooses the words and the day, never the path, so it
cannot reach any note that `append` could not already reach. It only adds: the
text goes at the end of `## Dump` and nothing that was there is moved, edited
or removed, so it cannot overwrite anything. And it is bounded the way every
other write is, 1MiB on disk, stamped, and recorded in jj under the token's
name.

What it buys is that a thought reaches the place the user reads it. `append`
could put the same line in the same note, but only after the agent had learned
the vault's periodic folder, today's file name and where a section ends, and a
model that gets any of that wrong files the thought in the inbox instead, which
is where it gets lost. The section is the ritual's, so the rule for finding it
belongs in the server rather than in every prompt.

## Why a seventh capability is acceptable

`query_graph` is a read, and a read adds nothing to what a leaked token can
break. It walks the same notes a search walks, under the same archive rule, and
writes nothing: no note, no index and no history. Everything it answers, a
token holder could already learn by listing the vault and reading each note.

That last sentence is also the case for it. An agent asking what depends on a
note would otherwise search for the note's name, read every note the search
turned up and parse the `name:: [[target]]` lines itself, one request per note
and a rule to get wrong in every prompt. The server already holds that parser,
because the browser's graph uses it, so the agent asks the one question and
gets the answer the graph pane would draw.

## Why an eighth capability is acceptable

`file` puts one PDF, epub or image into the vault, from the bytes in the
request or from a public URL the server downloads. It is the first capability
that adds something a leaked token could not already do, and the list above
named both of its halves as hazards, so it has to argue its way in.

What it buys is the documents that belong beside the notes. A paper an agent
found, a report it was handed, a scan it made: until now each had to go
through the browser or a shell, so an agent that wrote a note about a paper
could not file the paper beside it, and the reader had nothing to open.

The hazard the upload carried was disk. Books are ignored by jj and no route
deletes one, so a looping or leaked token can fill the disk with files only
the shell can remove. That is still true, and the cap is the browser's 100MiB
per file rather than the notes' 1MiB, by choice: a scanned book is bigger than
any smaller number worth picking. What bounds it is the same as for notes,
which is that a token is revoked in one click and every file it wrote sits at a
path it named. Nothing is overwritten: a taken path is refused, decided by the
filesystem rather than by a check in front of it, so a bad token can add and
never replace.

The fetch's hazard was the network. A server that downloads what it is told
can be told to read the box itself. The download goes through the checks
`GET /api/fetch` already makes: `http` or `https`, every address the name
resolves to on the public internet, every redirect checked again, and the
socket opened to the address that passed rather than to a second lookup of the
name. On top of that, what comes back has to start with the bytes its suffix
promises.

Why a URL at all, when the upload takes bytes: an MCP tool call is JSON the
model writes, and a model cannot write out a PDF. Base64 grows the file by a
third and a model types it a few characters per token, so the ceiling is tens
of kilobytes. claude.ai and chatgpt.com have no shell to send bytes with, so a
URL is the only form a document can reach them in. A file attached to a chat
there has no URL and still cannot come in; the model sees its text, never its
bytes.

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
inherit the login gate and carry no authentication of their own. The screen that
drives them is `/tokens` in the notebook.

That does put minting inside the internal trust zone: the shell container
reaches `/api/tokens` over the docker network with no session at all. It is
worth stating rather than hiding, and it grants that container nothing. It
already has the vault bind-mounted and unauthenticated access to every other
`/api/` route, so it can already do more than any token it could mint for
itself.

## The second way to get a token

claude.ai and chatgpt.com have no field for a header. A token minted at
`/tokens` cannot be given to either product, because the box you would paste it
into does not exist. What both have instead is a Connect button that finds an
authorization server, sends you through it and carries whatever it issues. An
authorization server is the only door those two products have.

What that server issues is an ordinary row in the same `tokens.json`, named for
the product's host. The gate calls the same `verify`, `/tokens` revokes it with
the same button, and a second Connect from the same product revokes the old row
before minting the new one. So this is a second way to obtain a token and not a
second thing a token reaches. The eight capabilities are still eight, there is one
gate, one store and one verification path, and nothing in the gate can tell an
OAuth grant from a string typed into a terminal. The protocol asks for two
things the store does not keep: the metadata names one scope, `kasten:notes`,
which covers all eight capabilities and narrows nothing, and the token response
states ten years as the lifetime of a token that ends when it is revoked.

Claude Code and codex still carry the header, and none of this touches them.
Claude Code cannot use this flow: it has no field to paste a client id into, so
reaching it would take dynamic client registration or client id metadata
documents, and a rule for loopback redirects on top of that: the allowlist names
three hosts, and a laptop is not one of them. That is left out on purpose.

## What the authorization server exposes

Four URLs must be reachable with no session, because the machine fetching them
has no way to get one: two metadata documents, one of them served under two
spellings because the two products probe different ones, and the endpoint that
exchanges a code. The exchange sits under `/agent/`, which is already open past
the login gate. The three metadata URLs need `/.well-known/*` open as well, and
without it the gate answers each of them with a sign-in page or a `401`, which a
connector reads as neither a document nor "there is none". The self-host stack's
Caddyfile ships both routes; on the maintainer's box they are stanzas in another
repository, written out in [Deploy to the VPS](/how-to/deploy-to-the-vps.md).
[Reverse-proxy routes](/reference/reverse-proxy-routes.md) is the list for any
proxy. Getting it wrong stops the flow rather than opening anything: the gate on
`/agent/mcp` does not depend on it.

Consent is not among the four. It stays under `/api/`, where the login gate
proves who you are, and that is why kasten has no sign-in form of its own.

The exchange is the part worth arguing about, because a stranger can reach it
and it writes to the file the gate reads on every request. What bounds that
write is the code it spends: 256 bits from `secrets`, held in this process,
dropped when it is spent, worth nothing sixty seconds after it was issued, and
refused unless the caller presents the verifier behind the PKCE challenge and
the same redirect the code was issued for. The file has a ceiling too. A row is
named for the redirect's host, the allowlist names three hosts, and a repeat
revokes before it mints, so however often this flow runs it can leave three rows
in `tokens.json` and no more.

An address is matched whole: the three fixed ones by equality, and ChatGPT's
per-app shape with a `fullmatch` rather than a search, which would take any
address carrying that shape somewhere inside it. Where a code is sent matters
more on this host than on most, because it may carry a session cookie scoped to
its whole parent domain, as the maintainer's does. The same reasoning is why a refusal at the authorize step
renders as a 400 and never as an error redirect. Sending the caller on to an
address just judged untrusted is the hole being refused.

The consent screen is a form with one button, and the POST is what mints a code.
The GET that draws the form mints nothing. The attacker worth picturing is not
someone holding your claude.ai session; it is someone with their own claude.ai
account and a connector flow pointed at this vault, waiting for a code to
arrive. If a GET minted one, that person would only have to get your browser to
open the authorize URL. oauth2-proxy's cookie is `SameSite=Lax`, a browser
attaches a Lax cookie to a top-level navigation, and your session would mint a
code straight into their pending flow. A cross-site POST carries no Lax cookie,
so oauth2-proxy turns it away before any of this runs, and the only POST that
arrives is the one from the form on the same origin.

That last step is oauth2-proxy's, not kasten's, and kasten has no login of its
own to fall back on. Put basic auth in front instead and the browser resends
the credentials with any POST to this host, from whatever site sends it. So the
POST checks its own origin as well: a `Sec-Fetch-Site` other than `same-origin`
is refused, and so is an `Origin` naming another host when that header is
missing. Behind oauth2-proxy the check never fires, because the only POST that
gets that far already came from the form. It is there for a proxy that does
less.

The passthrough the MCP spec warns about cannot happen here, and the honest
reason is structure rather than defence. kasten mints opaque random strings and
is the only party that can verify one. There is a single audience and nothing
downstream to forward a token to, so a token taken from here cannot be replayed
against another server, and this server has nowhere to pass one on. That is not
RFC 8707 conformance, which is neither built nor claimed.

## What is recorded

The token's name goes into the description of the jj change its write makes, so
`jj log` reads `agent(laptop): daily/2026-08-18.md` where your own edit reads
`vault: daily/2026-08-18.md`. That is why there is no `last_used` field on a
token: it would mean a file write on every request to answer a question the
history already answers, and answers better.

A token from the connector flow carries the product's host as its name, so a
note written from claude.ai reads `agent(claude.ai): daily/2026-08-18.md`.

A switch of writer opens a new change even when the note has not moved. That is
deliberate. An agent write must never amend the change holding your browser
edits, and the cost is that alternating edits to one note make more `jj log`
entries than they used to.

## What this does not protect against

One proxy route is the entire boundary, and no CI here can test it. On the
maintainer's box it lives in another repository. What makes that survivable is that the backend gate is
mandatory rather than a second layer: a Caddy stanza that is wrong exposes an
endpoint answering `401`, not the vault. The deploy runbook carries three curls
that check exactly this, and the one that must never pass is a request with no
header returning anything but `401`, and
[Self-host kasten](/how-to/self-host-kasten.md#6-check-the-gate) runs the same
check.

An agent can also grow the vault without bound. There is no delete, so a looping
agent that creates notes cannot clean up after itself and you must use the
browser or the shell. A note write is capped at 1MiB and a file at 100MiB, and
the aggregate is not. A book an agent files is outside jj's history and outside
every delete route, so the shell is the only way to take one out.

A leaked token is the whole vault. `list_notes` and `read_note` together are
every note there is, and no revoke takes back a copy someone already holds. The
writing half is the recoverable one: an agent write lands in the jj repo beside
the vault like any other, so a bad `save_note` is one command from being undone.
Reading is the half nothing undoes, and that is the asymmetry to weigh when
handing a token out.

## Related

* [Agent API](/reference/agent-api.md): the routes, the bearer rule and the digest contract
* [Connect an agent](/how-to/connect-an-agent.md): how each client is configured
* [Two environments](/explanation/environments.md): where the gate in front of everything else lives
* [Deploy to the VPS](/how-to/deploy-to-the-vps.md): the Caddy stanza and the curls that check it
