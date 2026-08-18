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
second thing a token reaches. The five capabilities are still five, there is one
gate, one store and one verification path, and nothing in the gate can tell an
OAuth grant from a string typed into a terminal. The protocol asks for two
things the store does not keep: the metadata names one scope, `kasten:notes`,
which covers all five capabilities and narrows nothing, and the token response
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
exchanges a code. The exchange sits under `/agent/`, which is already the one
Caddy block carrying no `oauth2_auth`. The three metadata URLs need a block of
their own, and without it the catch-all answers each of them with a redirect to
a sign-in page on another host, which a connector reads as neither a document
nor "there is none". That block is a stanza in another repository, written out
in [Deploy to the VPS](/how-to/deploy-to-the-vps.md), and no connector reaches
this vault until it is deployed there. Getting it wrong stops the flow rather
than opening anything: the gate on `/agent/mcp` does not depend on it.

Consent is not among the four. It stays under `/api/`, where oauth2-proxy proves
who you are, and that is why kasten has no sign-in form of its own.

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
more on this host than on most, because the host carries a session cookie scoped
to `.pascalkraus.com`. The same reasoning is why a refusal at the authorize step
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

One Caddy block is the entire boundary, it lives in another repository, and no
CI here can test it. What makes that survivable is that the backend gate is
mandatory rather than a second layer: a Caddy stanza that is wrong exposes an
endpoint answering `401`, not the vault. The deploy runbook carries three curls
that check exactly this, and the one that must never pass is a request with no
header returning anything but `401`.

An agent can also grow the vault without bound. There is no delete, so a looping
agent that creates notes cannot clean up after itself and you must use the
browser or the shell. Each request is capped at 1MiB, and the aggregate is not.

A leaked token is the whole vault. `list_notes` and `read_note` together are
every note there is, and no revoke takes back a copy someone already holds. The
writing half is the recoverable one: an agent write lands in the jj repo beside
the vault like any other, so a bad `save_note` is one command from being undone.
Reading is the half nothing undoes, and that is the asymmetry to weigh when
handing a token out.

## Related

* [Agent API](/reference/agent-api.md) - the routes, the bearer rule and the digest contract
* [Connect an agent](/how-to/connect-an-agent.md) - how each client is configured
* [Two environments](/explanation/environments.md) - where the gate in front of everything else lives
* [Deploy to the VPS](/how-to/deploy-to-the-vps.md) - the Caddy stanza and the curls that check it
