---
type: Explanation
title: Security model
description: Why kasten has no login of its own, what the gate in front of it covers, the two prefixes left open and what guards them, what the shell can reach, and the two checks the backend makes for a proxy that does less.
tags: [security, deploy, self-host, agent]
status: stable
---

# Security model

kasten is a notebook for one person, and it trusts whoever reaches it. The rest
of this page is what that costs and where the edges are.

## No login of its own

The backend has no users, no passwords and no sessions. Every route under
`/api/` answers anyone who can send it a request. The login is a gate in front:
basic auth, oauth2-proxy or Tailscale in
[the self-host stack](/how-to/self-host-kasten.md), and oauth2-proxy on the
maintainer's box.

That is a choice. A login written into kasten
would be one more password store, one more session cookie and one more place
for a bug, all to hold one user. The gates in front are small, widely used and
built for exactly this, and each brings what kasten would never build well on
its own: GitHub's two-factor sign-in, or a network nobody outside can reach. It
also keeps the backend's code about notes.

The cost is that the gate is the boundary. A proxy that routes one path around
it opens that path to the world, with nothing behind to catch it.
[Reverse-proxy routes](/reference/reverse-proxy-routes.md) lists every path and
which side of the gate it belongs on, and
[Self-host kasten](/how-to/self-host-kasten.md#6-check-the-gate) has the curls
that prove the gate is there.

## Two prefixes stay open

An agent on another machine cannot complete a browser sign-in, so two prefixes
pass the gate.

`/agent/*` is guarded by the backend itself. Every route under it checks a
bearer token against the token store before it runs, and the check hangs off
the router, so a route added later cannot forget it. A proxy that is wrong
there exposes routes that answer `401`, not the vault. What a token reaches,
eight capabilities and no delete, is
[The agent boundary](/explanation/the-agent-boundary.md).

`/.well-known/*` serves the OAuth discovery documents. They are public by
design, the same for everyone, and name nothing secret.

The token exchange, `/agent/oauth/token`, sits under the open prefix because the
machine calling it has no session. What it hands out is bounded by the code it
spends: 256 random bits, sixty seconds, one use, bound to a PKCE verifier and to
one of three callback hosts.

## The internal trust zone

Behind the gate, the backend listens on port `8000` on the docker network with
no check at all. Any container on that network can call every `/api/` route,
mint a token included. In the self-host stack the network holds only kasten's
own containers. On a box where other services share the network, as the
maintainer's does, they are inside the zone too.

## What the shell can reach

The terminal pane is a live shell in its own container, and whoever passes the
gate gets it. From there:

* The vault, read and write, through the same bind mount the backend uses. A
  `rm -rf` there is real, and only the jj history brings the notes back.
* The backend at `$KASTEN_API`, with no login, which is every `/api/` route
  and the power to mint tokens.
* Its own home volume, where Claude Code, codex and dsh keep their logins.
  Whoever reaches the shell can spend them.
* The internet, outward.

Not the docker socket, which would hand out root on the host, and not your home
directory on the host. No port is published for it, so the gate's `/term/*`
route is the only way in. Those two facts are its whole defence, which is why
every runbook here ends by proving them.

## Two checks for a proxy that does less

The gate does most of the work, but two attacks get through some gates and not
others, so the backend checks for them itself.

**The consent step.** Pressing Connect in a claude.ai or chatgpt.com flow posts
to `/api/oauth/authorize`, and that post mints a code. oauth2-proxy's
`SameSite=Lax` cookie keeps another site from pressing the button for you;
basic auth does not, because the browser resends the password with any post to
the host, from any site. So the backend refuses a post that does not come from
its own page.
[The agent boundary](/explanation/the-agent-boundary.md#what-the-authorization-server-exposes)
says why, and [Agent API](/reference/agent-api.md#get-and-post-apioauthauthorize)
states the headers it reads.

**Page fetching.** `GET /api/fetch` reads a web page from the server, because a
browser will not let a script read another site's page. A server that fetches
any address it is given can be pointed at the docker network, the host or a
router. So the backend resolves the name, refuses any address that is not on
the public internet, and checks every redirect hop the same way. The route is
behind the gate, so the person asking is you; the check stops a page you clip
from sending the server somewhere else. One gap remains and is written down in
the code: the fetch resolves the name a second time when it connects, so a name
that changes its answer within one request gets past.

## What the backend says at startup

Two settings leave something open without breaking anything, so the backend
logs a warning and starts anyway:

* `KASTEN_AGENT_HOST` empty: the MCP endpoint answers any `Host`, which turns
  off its DNS-rebinding guard, and the OAuth issuer comes off each request.
* A vault with no `.jj`: saves keep no history, so an overwrite or an agent's
  bad write is final.

Both are right for dev on a laptop and wrong on a server.
[Configuration](/reference/configuration.md) has the settings.

## What none of this covers

A leaked token reads the whole vault, and no revoke takes back a copy. The
writing half is recoverable from jj; the reading half is not.

Anyone past the gate is you, as far as kasten knows. There is no audit beyond
`jj log`, which names the token behind every agent write and records a browser
save as `vault`.

The vault on disk is plain markdown. Whoever can read the host directory can
read the notes, and backups carry them in the clear unless you encrypt them.

## Related

* [Reverse-proxy routes](/reference/reverse-proxy-routes.md): every path and its side of the gate
* [The agent boundary](/explanation/the-agent-boundary.md): what a token can and cannot do
* [Two environments](/explanation/environments.md): how the maintainer's box applies this
* [Back up and restore](/how-to/back-up-and-restore.md): what to keep and where
