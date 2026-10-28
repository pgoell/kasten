---
type: Explanation
title: Security model
description: Why kasten has no login of its own, what the gate in front of it covers, the two prefixes left open and what guards them, the second gate and host check for the shared lists, what the shell and the chat pane can reach, and the two checks the backend makes for a proxy that does less.
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

## A second edge for the shared lists

The shared lists have their own host, `liste.pgoell.com`, and their own gate. It
is a second oauth2-proxy with Google sign-in, and it admits two addresses, one
of them Alicia's, from a file on the server. Its cookie is scoped to that host,
so a session on the main host does not pass here, and this one does not reach
the main host. The main gate still admits one person.

The second person gets this edge, not a login in kasten, for the reason in
[Shared lists](/explanation/shared-lists.md). The edge has two locks. Caddy
sends only `/share/*` and the app's own files on to kasten, and answers every
other path `404`. The backend then refuses every path outside `/share/*` when
the request's `Host` is `KASTEN_SHARE_HOST`. A fault in either lock leaves the
other standing.

The routes behind this edge are the six `/share/` routes, which read and write
the notes in the shared folder and nothing else. The shell and the chat pane sit
behind the main gate, on routes this host does not carry, so the second person
has no path to them. The table is in
[Reverse-proxy routes](/reference/reverse-proxy-routes.md#the-share-host).

## The internal trust zone

Behind the gate, the backend listens on port `8000` on the docker network with
no check at all. Any container on that network can call every `/api/` route,
mint a token included. The jobs on the host that write
[finance](/reference/http-api/finance.md) reach it this way. In the self-host stack the network holds only kasten's
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
route, and `/chat/*` beside it, is the only way in. Those two facts are its whole defence, which is why
every runbook here ends by proving them.

## What the chat pane can reach

The chat pane talks to a second process in the shell container, the chat
runner, through the gate's `/chat/*` route. The runner starts Claude Code in
the vault and lets it use every tool without asking: shell commands, file
writes, file deletes.

That sounds like more than the terminal pane and is exactly as much. Whoever
passes the gate already has a shell in that container, with the vault, the
backend and the agents' logins in reach, and can start Claude Code there with
any flag they like. A permission prompt in the chat pane would guard a door
that stands beside an open one. So the runner asks for none, and says so here
instead of leaving it to be found.

What the runner does check:

* **A post must come from kasten's own page.** It must be JSON and carry an
  `Origin` naming the host it was sent to. Under basic auth a browser resends
  the password with any post to the host, from any site, and a post here runs
  an agent. A form on another site cannot send JSON without a preflight, and
  the runner answers none.
* **Nothing the pane cannot show is approved.** A few things reach the runner
  for a decision even with prompts off: an `rm` of a path Claude Code holds
  critical, a rule in the vault's settings that says ask. The pane has no form
  for those, so the runner refuses them and the agent is told to find another
  way. Only a question the agent asks of you gets through, as a form.

The stream, `GET /chat/events`, carries no such check and needs none. A page
on another site can open it and cannot read it: the runner sends no CORS
header, so the browser withholds every byte.

What it does not check: who is on the docker network. Port `7682` answers any
container there, as ttyd's `7681` does, and a container that can send a
request can send a matching `Origin` with it. The trust zone above is the
boundary for both.

A run spends the Claude login in the home volume. Whoever reaches the pane can
spend it, as whoever reaches the shell can.

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
says why, and [Agent API](/reference/agent-api/oauth.md#get-and-post-apioauthauthorize)
states the headers it reads.

**Page fetching.** `GET /api/fetch` reads a web page from the server, because a
browser will not let a script read another site's page. A server that fetches
any address it is given can be pointed at the docker network, the host or a
router. So the backend resolves the name, refuses any address that is not on
the public internet, and opens the socket to the address it checked rather
than looking the name up again. Every redirect hop connects the same way. The
route is behind the gate, so the person asking is you; the check stops a page
you clip from sending the server somewhere else. `POST /agent/files/{path}/fetch`
and the MCP tool `save_file`, for a URL, download through the same connection.

## What the backend says at startup

Two settings leave something open without breaking anything, so the backend
logs a warning and starts anyway:

* `KASTEN_AGENT_HOST` empty: the MCP endpoint answers any `Host`, which turns
  off its DNS-rebinding guard, and the OAuth issuer comes off each request.
* A vault with no `.jj`: saves keep no history, so an overwrite or an agent's
  bad write is final.

Both are right for dev on a laptop and wrong on a server.
[Configuration](/reference/configuration.md) has the settings.

## A page of HTML runs as nobody

A research run leaves HTML in the vault, and the HTML pane draws it. That page
can carry script, and kasten serves it from its own origin, the one holding the
login cookie. Run as written, the page could read every note and write
anything.

So `GET /api/html/{path}` sends the page with a sandbox in its
`Content-Security-Policy` header, and the pane's `<iframe>` carries the same
sandbox. The page runs in an opaque origin: no cookie, no storage, no reading
the app around it. In the header and not only on the frame, so a page opened
straight from its address is held the same way. `connect-src 'none'` closes
the last gap, a blind `POST` that would land wherever the browser still sends
the cookie. What is left is the page drawing itself, which is the point.

A page an agent writes, through `POST /agent/files/{path}` or `save_file`, gets
the same sandbox and policy. So a token holder can plant script, and it runs in
the page's own opaque origin, never kasten's.

Only kasten may frame the page or the app: `HTML_POLICY` and the app's own
policy both end in `frame-ancestors 'self'`. Without it, another site could
frame a vault page while you are signed in and read the keys the page posts to
its parent, or lay the app under a page of its own and steer clicks into it.
`'self'` is matched against the address the page was served from, not the
opaque origin its sandbox gives it, so the pane's frame passes.

The frame never gets `allow-same-origin`. With it beside `allow-scripts`, a
page could reach into its own frame and lift the sandbox off.

The page talks to kasten by postMessage, and kasten acts on a message only when
it comes from its own frame. Only Space, `?`, Escape and `y` count, and a key
counts only while the frame holds the focus. A page can still post Space while
you type into it, and then your next keys reach the leader panel.

A page can also send its text selection, and a `y` while it holds one, so a
passage can be taken into today's dump. kasten checks the selection field by
field and drops a message of the wrong shape. It shows a button only while the
frame holds the focus, and it takes a passage on `y` only while one is held.
Before the text reaches the dump, control characters go, every markup character
is escaped, and every line starts with `> `, so no line the page sends can
stand as a heading, a fence, a tag or a todo. The text is capped at 2000
characters and 50 paragraphs, and the heading and the anchor of the link are
cut to what a wikilink can hold, with nothing that opens markup or a comment.

A PDF in the pdf pane sends nothing. pdf.js draws it into the pane itself, not
into a frame, so no script can post a selection or a `y` for it. A passage is taken
from the PDF only when the reader selects words in its text layer and then
presses `y` or the Take button. The PDF's text is as untrusted as a page's. It
goes through the same `quoteParagraphs` escape and the same caps, so no line of
it can stand as a heading, a fence, a tag or a todo, and the link names the file
and the page only. The forged-focus limit below does not reach the pdf pane.

The limit that remains: a click into the page gives it the focus, and a page
with the focus can forge a selection and a `y`; it can move the focus out to
kasten and back without any input too. What it cannot forge is the browser's
user activation: a real key or click in the page activates kasten's window as
well, for a few seconds, and no script can make one. A `y` the page sends takes
only while kasten's window holds an activation, and kasten spends it, in its own
document, at each take and whenever the page reports a new passage (#877). So a
relayed `y` takes once per press of the reader: any key or click in the page or
in kasten, `j` and Space included, since the activation does not say which key
made it. Where the browser cannot spend it, a relayed `y` takes once per visit,
as before. So each press lets a hostile
page write at most one quoted paragraph into today's dump, escaped and capped as
above, under a link to a heading the page names. The toast shows it with Undo,
so the reader sees it and can take it back. The page learns that a take
happened, which it could send out, and nothing of the vault. Text in the dump
is still read as prose by whoever plans from it, an agent included. The write is the one a
reader makes with `<leader>cd`, through the same outbox and `POST /api/dump`,
and the page cannot read the dump or the daily note from there. "Open in a browser tab" shows the page in a
tab of its own under kasten's address, held by the same sandbox header, so a
page there can draw a fake login form; it reads nothing of kasten's.

The theme adds little to that. An opted-in page is sent two names in its
address, a theme and a palette, each from a short fixed list. kasten puts its
token file and four font files into the page itself, and all of it is public.
The page script acts on a theme message only when the message comes from its
parent. The frame fetches nothing for the theme, and the frame still has no
`allow-same-origin`.

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
