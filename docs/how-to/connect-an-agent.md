---
type: How-to Guide
title: Connect an agent
description: Mint, list and revoke a token, then point Claude Code, codex, claude.ai, chatgpt.com, another MCP client or curl at the vault, or install the skill where MCP is off.
tags: [agent, mcp, tokens, oauth, claude]
status: stable
---

# Connect an agent

An agent on another machine reaches the vault through `/agent/`, with a token
and nothing else. A client that can send a header is given one. claude.ai and
chatgpt.com cannot, so they go through an OAuth flow that hands them the same
kind of token. What either grants, and what neither does, is
[The agent boundary](/explanation/the-agent-boundary.md).

`notes.example.com` below stands for your own host, the `KASTEN_DOMAIN` of
[the self-host stack](/how-to/self-host-kasten.md).

## Before you start

The server needs three things. The self-host stack does all three for you.

* `/agent/*` and `/.well-known/*` reach the backend with no login gate in front,
  and every other route stays behind it.
  [Reverse-proxy routes](/reference/reverse-proxy-routes.md) lists them.
* [`KASTEN_AGENT_HOST`](/reference/configuration.md#kasten_agent_host) is the
  bare hostname the world uses, `notes.example.com`, with no scheme, port or
  slash. The self-host stack copies it from `KASTEN_DOMAIN`.
* [`KASTEN_TOKENS_PATH`](/reference/configuration.md#kasten_tokens_path) names a
  file in a directory mounted from the host. The file keeps a SHA-256 digest of
  each secret, never the secret. On the host, tokens outlive an upgrade; inside
  the container, every redeploy forgets them all. The self-host stack keeps the
  file at `data/agent/tokens.json`.

## Mint, list and revoke a token

In the browser:

1. Open `https://notes.example.com/tokens`. It has no key and no menu entry;
   type the URL.
2. Type a name for the machine or job that will hold it, `laptop` or `nightly`,
   and press **Mint**.
3. Copy the secret. It is shown once and never again: the vault keeps only the
   digest, so you replace a lost secret rather than find it.

The same screen lists every token by name and date. Under a fresh secret it
shows the `claude mcp add` line with the secret and this host filled in; if
Claude Code is the client, that line is the whole of the next section. Each row
has a **Revoke** button, which asks once and takes effect on the next request
the token makes.

With curl, call the three routes the screen calls. They sit under `/api/`, so
they need the login. Behind basic auth, give curl your user name and it asks
for the password:

```sh
curl -u you -X POST -H 'content-type: application/json' \
  -d '{"name": "laptop"}' https://notes.example.com/api/tokens
curl -u you https://notes.example.com/api/tokens
curl -u you -X DELETE https://notes.example.com/api/tokens/laptop
```

Behind Tailscale, drop `-u you`: a machine in the tailnet needs no login.
Behind oauth2-proxy, curl has no session. Open the terminal pane in kasten and
send the same requests to the backend from there, which needs no login:

```sh
curl -X POST -H 'content-type: application/json' \
  -d '{"name": "laptop"}' "$KASTEN_API/api/tokens"
```

A mint answers `201` with the secret, a name already taken `409`, and a revoke
of a name the store does not hold `404`. The shapes are in
[HTTP API](/reference/http-api.md#get-apitokens).

## Claude Code

An `http` server with the token in a header:

```sh
claude mcp add --transport http kasten https://notes.example.com/agent/mcp \
  --header "Authorization: Bearer kasten_xxxxxxxx"
```

Check it with `/mcp` inside Claude Code. The seven tools are `list_notes`,
`read_note`, `search_notes`, `query_graph`, `save_note`, `append_note` and
`dump`, and an eighth, `read_guide`, hands back how the vault is filed. Claude
Code reads a server's instructions at the handshake, so it holds that text
already and the tool tells it to skip the call.

## codex

In `~/.codex/config.toml`, with the secret in the environment rather than in the
file:

```toml
[mcp_servers.kasten]
url = "https://notes.example.com/agent/mcp"
bearer_token_env_var = "KASTEN_TOKEN"
```

Then `export KASTEN_TOKEN=kasten_xxxxxxxx` where codex will see it.

## Claude Desktop

Claude Desktop speaks stdio, not HTTP, so it needs the `mcp-remote` bridge in
front. In its `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kasten": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://notes.example.com/agent/mcp",
        "--header",
        "Authorization: Bearer kasten_xxxxxxxx"
      ]
    }
  }
}
```

The bridge supplies the header, which is the thing Desktop itself cannot send.

## Other MCP clients

Any client that speaks MCP over streamable HTTP and can send a header works the
way Claude Code does: the URL is `https://notes.example.com/agent/mcp`, the
header is `Authorization: Bearer <secret>`, and every request is a `POST`.

Do not expect such a client to sign in through OAuth. kasten sends a code only
to the claude.ai, claude.com and chatgpt.com callbacks
[listed in the Agent API](/reference/agent-api.md#get-and-post-apioauthauthorize),
and it has no endpoint for a client to register itself. A client that offers
a sign-in button fails there; give it a token instead.

## curl

The REST routes are the same seven capabilities and need no MCP client at all.
Every shape is in [the Agent API](/reference/agent-api.md). The paths below are
on the default folders; yours may differ.

```sh
export KASTEN_TOKEN=kasten_xxxxxxxx
export KASTEN_AGENT=https://notes.example.com/agent

curl -s -H "Authorization: Bearer $KASTEN_TOKEN" "$KASTEN_AGENT/notes"
curl -s -H "Authorization: Bearer $KASTEN_TOKEN" "$KASTEN_AGENT/search?q=forking"
curl -s -G -H "Authorization: Bearer $KASTEN_TOKEN" \
  --data-urlencode 'q=?paper supports [[GraphRAG]]' "$KASTEN_AGENT/graph"
curl -s -H "Authorization: Bearer $KASTEN_TOKEN" "$KASTEN_AGENT/notes/00%20Inbox/borges.md"

curl -s -X POST -H "Authorization: Bearer $KASTEN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"text": "A line to file."}' \
  "$KASTEN_AGENT/notes/00%20Inbox/today.md/append"

curl -s -X POST -H "Authorization: Bearer $KASTEN_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"text\": \"answer Jonas\", \"date\": \"$(date +%F)\"}" \
  "$KASTEN_AGENT/dump"
```

The routes describe themselves, so an agent that lands with a token and no
documentation can read the shapes off the schema:

```sh
curl -s -H "Authorization: Bearer $KASTEN_TOKEN" "$KASTEN_AGENT/openapi.json"
```

That document names these seven routes and nothing else. The one at the root
describes the browser's API and is behind the login gate.

An append needs no digest. A whole-note save does: read the note first and
present the `sha` that read returned, not a digest of the text you are sending.
[What a digest is of](/reference/agent-api.md#what-a-digest-is-of-and-why-it-is-never-the-digest-of-what-you-sent)
says why those two differ.

## Claude Code where MCP is off

Some machines run Claude Code with MCP servers turned off by policy. The
`kasten` plugin in this repository gives it the same seven capabilities as a
skill that drives the curl routes above, so no MCP client is involved.

Add this repository as a marketplace and install the plugin, inside Claude Code:

```
/plugin marketplace add pgoell/kasten
/plugin install kasten@kasten
```

Mint a token named for the machine, `work-laptop`, and set both variables in
`~/.claude/settings.json`:

```json
{
  "env": {
    "KASTEN_TOKEN": "kasten_xxxxxxxx",
    "KASTEN_AGENT": "https://notes.example.com/agent"
  }
}
```

`KASTEN_AGENT` ends in `/agent`, with no slash after it. Claude Code hands its
`env` to every command it runs, so this works in whatever shell the machine
has. A shell profile works too, when Claude Code starts from that shell.

The skill loads when a request names kasten, the vault or your notes, or by
hand as `/kasten:vault`. It carries the rules the MCP server's instructions
carry, and reads `reading-this-vault.md` before its first write for the same
reason.

It needs curl 8.3 or newer, which `curl --version` shows. `--variable` and its
`:url` and `:json` functions are what encode a path holding spaces and escape a
note's body, so the machine needs no `jq` and no Python.

The plugin carries no version number. Claude Code reads the commit instead, so
every merge to `main` counts as a new version, and
`/plugin marketplace update kasten` fetches it.

## claude.ai and chatgpt.com

Neither has a field for a header, so neither can be given a token. Both instead
find an authorization server and send you through it, and kasten carries one for
this. What it issues is an ordinary row in the same store, so you revoke the
connector's token at `/tokens` beside every other one.

On top of [Before you start](#before-you-start), these two need:

* A host the internet can reach on port 443. Their servers fetch kasten from
  outside, so the Tailscale gate rules them out. The issuer is
  `https://notes.example.com` with no port, so a stack on another port fails
  the flow.
* A login gate that works in a browser tab, which basic auth and oauth2-proxy
  both do. The consent page sits behind it.

**claude.ai**: Settings, Connectors, Add custom connector. The URL is
`https://notes.example.com/agent/mcp`. Leave the OAuth Client ID and Client
Secret fields empty. The same connector reaches Claude Desktop and the phone,
which is the reason to prefer it to the `mcp-remote` bridge above.

**chatgpt.com**: turn on Developer mode under Settings, Security and login, then
add the server at `https://chatgpt.com/plugins`. Same URL. Developer mode wants
a Plus, Pro, Business, Enterprise or Education account, and works on the web
only.

Both then open a kasten page, `/api/oauth/authorize`, with one button on it. The
login gate asks who you are first if you have no session, so the button is the
whole of the consent. Pressing it hands the product a token named for it,
`claude.ai` or `chatgpt.com`, which is what `/tokens` lists and what `jj log`
records against every note that arrives that way.

The page refuses a press that did not come from itself. A `403` there means the
browser said the request came from another site, which an extension or a
privacy tool that rewrites headers can also cause; press the button on the page
itself, in a plain tab.

Connecting a second time replaces that token rather than adding one. The old one
stops working on the next request.

## When it does not work

| What you see | What it means |
| --- | --- |
| `401` | The token is wrong or revoked, or the header is not `Authorization: Bearer …` |
| `421` on `/agent/mcp` | The request's `Host` is not the one `KASTEN_AGENT_HOST` names: the MCP SDK refuses it as DNS rebinding. Set the variable to the bare hostname clients use |
| `403` on `/agent/mcp` with a valid token | The client sent an `Origin` the SDK does not accept. Only your own host, claude.ai, claude.com and chatgpt.com pass |
| `405` on `/agent/mcp` | Something sent a `GET` or `DELETE`. The endpoint takes `POST` |
| `409` on a save | The note changed since you read it. Read it again and present the new `sha` |
| `413` | The write would leave more than 1MiB on disk |
| A sign-in page or a `401` from the gate on `/agent/*` or `/.well-known/*` | The proxy gates a route it must leave open. See [Reverse-proxy routes](/reference/reverse-proxy-routes.md) |
| A connector fails at once, with no consent page | The issuer does not match. Check that `curl https://notes.example.com/.well-known/oauth-authorization-server` names `https://notes.example.com` exactly |
| `403` after pressing Connect | The consent `POST` looked cross-site. See above |
| `400` after pressing Connect | The client's callback is not one kasten sends codes to. Only claude.ai, claude.com and chatgpt.com are |
| `option --variable: is unknown` from the skill | curl is older than 8.3 |
| Every token gone after an upgrade | `KASTEN_TOKENS_PATH` is not on a host mount. Mount its directory and mint again |
| A mint that fails with a `500` | The token file itself is bind-mounted rather than its directory. Mount the directory |
| A connector that will not save, with no request in the proxy's log | Something in front of the proxy, a CDN or firewall, refused it. Read its logs for the host |
| `Couldn't register` in a connector dialog | The client wanted to register itself. kasten has no registration endpoint, so leave the Client ID field empty |
| A connector that connects and then finds no tools | The token is minted but the tool call was refused. Read `docker compose logs backend` for the `401` or the `403` |

## Related

* [Agent API](/reference/agent-api.md): every route, every shape and the digest rules
* [The agent boundary](/explanation/the-agent-boundary.md): what a token grants and what it never will
* [Security model](/explanation/security-model.md): what the gate covers and what the backend checks itself
* [Configuration](/reference/configuration.md): `KASTEN_TOKENS_PATH` and `KASTEN_AGENT_HOST`
* [Back up and restore](/how-to/back-up-and-restore.md): the token file is one of the three things to keep
