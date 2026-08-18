---
type: How-to Guide
title: Connect an agent
description: Mint a token and point Claude Code, codex, claude.ai, chatgpt.com or curl at the vault from another machine.
tags: [agent, mcp, tokens, claude]
status: stable
---

# Connect an agent

An agent on a machine that is not the VPS reaches the vault through `/agent/`,
with a token and nothing else. A client that can send a header is given one. The
two browser products cannot, so they are sent through an OAuth flow that hands
them the same kind of token. What either grants, and what neither does, is
[The agent boundary](/explanation/the-agent-boundary.md).

## Mint the token

1. Open `/tokens` in the notebook. It has no key and no menu entry; type the URL.
2. Type a name for the machine or job that will hold it, `laptop` or `nightly`,
   and press **Mint**.
3. Copy the secret. It is shown once and is never recoverable: the vault keeps a
   SHA-256 digest, so a lost secret is replaced rather than found.

The same screen has the `claude mcp add` line already filled in with the secret
and the right hostname. If Claude Code is the client, that line is the whole of
the next section.

Revoking is one button on the same screen, and it takes effect on the next
request the token is used for.

## Claude Code

An `http` server with the token in a header:

```sh
claude mcp add --transport http kasten https://kasten.pascalkraus.com/agent/mcp \
  --header "Authorization: Bearer kasten_xxxxxxxx"
```

Check it with `/mcp` inside Claude Code. The five tools are `list_notes`,
`read_note`, `search_notes`, `save_note` and `append_note`, and a sixth,
`read_guide`, hands back how the vault is filed. Claude Code reads a server's
instructions at the handshake, so it holds that text already and the tool tells
it to skip the call.

## codex

In `~/.codex/config.toml`, with the secret in the environment rather than in the
file:

```toml
[mcp_servers.kasten]
url = "https://kasten.pascalkraus.com/agent/mcp"
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
        "https://kasten.pascalkraus.com/agent/mcp",
        "--header",
        "Authorization: Bearer kasten_xxxxxxxx"
      ]
    }
  }
}
```

The bridge is what supplies the header, which is the thing Desktop itself cannot
send.

## curl

The REST routes are the same five capabilities and need no MCP client at all.
Every shape is in [the Agent API](/reference/agent-api.md).

```sh
export KASTEN_TOKEN=kasten_xxxxxxxx
export KASTEN_AGENT=https://kasten.pascalkraus.com/agent

curl -s -H "Authorization: Bearer $KASTEN_TOKEN" "$KASTEN_AGENT/notes"
curl -s -H "Authorization: Bearer $KASTEN_TOKEN" "$KASTEN_AGENT/search?q=forking"
curl -s -H "Authorization: Bearer $KASTEN_TOKEN" "$KASTEN_AGENT/notes/00%20Inbox/borges.md"

curl -s -X POST -H "Authorization: Bearer $KASTEN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"text": "A line to file."}' \
  "$KASTEN_AGENT/notes/00%20Inbox/today.md/append"
```

The routes describe themselves, so an agent that lands with a token and no
documentation can read the shapes off the schema:

```sh
curl -s -H "Authorization: Bearer $KASTEN_TOKEN" "$KASTEN_AGENT/openapi.json"
```

That document names these five routes and nothing else. The one at the root
describes the browser's API and is behind oauth2-proxy.

An append needs no digest. A whole-note save does: read the note first and
present the `sha` that read returned, not a digest of the text you are sending.
[What a digest is of](/reference/agent-api.md#what-a-digest-is-of-and-why-it-is-never-the-digest-of-what-you-sent)
says why those two differ.

## claude.ai and chatgpt.com

Neither has a field for a header, so neither can be given a token. Both instead
discover an authorization server and send you through it, and kasten carries one
for exactly this. What it issues is an ordinary row in the same store, so the
connector's token is revoked at `/tokens` beside every other one.

The Caddy stanza in [Deploy to the VPS](/how-to/deploy-to-the-vps.md) has to be
in place first. Without it the discovery documents answer a sign-in redirect
rather than themselves, and a connector reads that as neither a document nor an
absence.

**claude.ai**: Settings, Connectors, Add custom connector. The URL is
`https://kasten.pascalkraus.com/agent/mcp`. Leave the OAuth Client ID and Client
Secret fields empty. The same connector reaches Claude Desktop and the phone,
which is the reason to prefer it to the `mcp-remote` bridge above.

**chatgpt.com**: turn on Developer mode under Settings, Security and login, then
add the server at `https://chatgpt.com/plugins`. Same URL. Developer mode wants
a Plus, Pro, Business, Enterprise or Education account, and works on the web
only.

Both then open a kasten page with one button on it. You are already signed in
there, because that page is behind oauth2-proxy like the notebook itself, so the
button is the whole of the consent. Pressing it hands the product a token named
for it, `claude.ai` or `chatgpt.com`, which is what `/tokens` lists and what
`jj log` records against every note that arrives that way.

Connecting a second time replaces that token rather than adding one. The old one
stops working on the next request.

Claude Code cannot use this flow. It has no field for a client id and would need
kasten to register clients on demand, which it does not do. Use the header, as
above; it is less machinery either way.

## When it does not work

| What you see | What it means |
| --- | --- |
| `401` | The token is wrong, revoked, or the header is not `Authorization: Bearer …` |
| `421` | The `Host` is not the one `KASTEN_AGENT_HOST` names |
| `405` on `/agent/mcp` | Something sent a `GET` or `DELETE`. The endpoint takes `POST` |
| `409` on a save | The note changed since you read it. Read it again and present the new `sha` |
| `413` | The write would leave more than 1MiB on disk |
| A redirect to a sign-in page | The Caddy block is not in place. See [Deploy to the VPS](/how-to/deploy-to-the-vps.md) |
| A connector that will not save, with no request in Caddy's log | Cloudflare refused it before Caddy saw it. Read the zone's security events for the host |
| `Couldn't register` in a connector dialog | The client wanted to register itself. kasten has no registration endpoint, so leave the Client ID field empty rather than filling it |
| A connector that connects and then finds no tools | The token is minted but the tool call was refused. Read `docker logs kasten-backend-prod` for the `401` or the `403` |

## Related

* [Agent API](/reference/agent-api.md) - every route, every shape and the digest rules
* [The agent boundary](/explanation/the-agent-boundary.md) - what a token grants and what it never will
* [Configuration](/reference/configuration.md) - `KASTEN_TOKENS_PATH` and `KASTEN_AGENT_HOST`
