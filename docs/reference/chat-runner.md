---
type: Reference
title: Chat runner
description: The process in the shell container the chat pane talks to. Its five routes, the events it streams, the check every post must pass, the options it starts Claude Code with, and where its files live.
resource: shell/chat/runner.mjs
tags: [chat, agent, shell, sse, api]
status: stable
---

# Chat runner

A node process in the shell container, listening on port `7682`. It holds one
Claude Agent SDK session with `/vault` as its working directory and serves it
over HTTP. The proxy routes `/chat/*` to it behind the login gate:
[Reverse-proxy routes](/reference/reverse-proxy-routes.md).

## Routes

| Request | Body | Answer | Does |
| --- | --- | --- | --- |
| `GET /chat/events` | | `200`, `text/event-stream` | Sends one `reset` holding every logged event, then each new one as it happens |
| `POST /chat/send` | `{"text": "..."}` | `204`, or `400` for empty text | Starts a session if there is none, and queues the text as a user turn |
| `POST /chat/answer` | `{"id": "ask1", "answers": {...}}` | `204`, `409` if that question is not open | Answers an open question |
| `POST /chat/stop` | `{}` | `204`, `500` if the SDK refused the interrupt | Interrupts the turn now running and closes every open question as not answered. A message queued behind that turn still runs |
| `POST /chat/new` | `{}` | `204` | Ends the session and empties the log |

Any other path or method answers `404`. A body that is not a JSON object
answers `400`. A request the runner fails on answers `500` and the runner
goes on.

`answers` maps each question's text to the chosen label. Several labels, or a
label and typed text, are joined with `", "`.

A message sent during a run is queued and runs after it.

## The check on every post

A `POST` is refused with `403` unless both hold:

* `Content-Type` starts with `application/json`.
* `Origin` is present and its host equals the request's `Host`.

So the proxy must pass `Host` through unchanged. Caddy does. The runner sends
no CORS headers and answers `OPTIONS` with `404`, so a page on another site
cannot preflight its way past the first rule.

## Events

Each is one `data:` line of JSON on the stream.

| `type` | Fields | Means |
| --- | --- | --- |
| `reset` | `log` | Forget everything and take `log`, a list of the events below, as the run so far. First on every connection, and sent with an empty `log` on `new` |
| `user` | `text` | A message you sent |
| `delta` | `text` | A piece of the text block now being written. Live only, never logged |
| `text` | `text` | A whole text block. Replaces the deltas before it |
| `tool` | `id`, `name`, `input` | A tool call began |
| `tool_result` | `id`, `text`, `error` | That call ended |
| `ask` | `id`, `questions` | The run waits on a question. `questions` is the `AskUserQuestion` input: 1 to 4 questions, each with `question`, `header`, `multiSelect` and 2 to 4 `options` of `label` and `description` |
| `answered` | `id`, `answers` | The question closed. No `answers` means it was stopped |
| `done` | `error` | A turn ended. `error` is set when it ended badly |
| `error` | `text` | The session itself ended. Its open questions close as not answered, and the next `send` starts another |

A subagent's own text and tool calls are not sent. Its `Agent` call and that
call's result are.

The stream is sent with `Cache-Control: no-store, no-transform`, the second
asking a proxy to leave it uncompressed.

Because a `delta` is not logged, a page that connects in the middle of a text
block sees that block only once it is whole.

## What the session runs with

| SDK option | Value |
| --- | --- |
| `cwd` | `/vault` |
| `systemPrompt` | the `claude_code` preset |
| `permissionMode` | `bypassPermissions`, with `allowDangerouslySkipPermissions` |
| `includePartialMessages` | `true` |
| `pathToClaudeCodeExecutable` | the `claude` on the container's `PATH` |
| `settingSources` | not set, so user and project settings load, and with them the skills in `/vault/.claude/skills` |
| `env` | not set, so Claude Code inherits the container's environment and login |

`canUseTool` answers `AskUserQuestion` with what the pane sends back and
refuses everything else that reaches it.
[Security model](/explanation/security-model.md#what-the-chat-pane-can-reach)
says what does reach it.

## Files

| Path | What |
| --- | --- |
| `shell/chat/runner.mjs` | The server and the mapping from SDK messages to events |
| `shell/chat/main.mjs` | Starts it with the real SDK on `0.0.0.0:7682` |
| `shell/chat/stub.mjs` | Starts it with a scripted session, for work on the pane. Not in the image |
| `shell/chat/runner.test.mjs` | Its tests, `mise run shell:test` |
| `/opt/kasten-chat/` in the image | `runner.mjs` and `main.mjs` |
| `~/.kasten-chat/` in the home volume | The same two files, copied on every start, beside the SDK the entrypoint installs |

`KASTEN_AGENT_SDK_VERSION` in `shell/Dockerfile` pins the SDK. The entrypoint
installs that version when the volume holds another or none, with
`npm install --omit=optional`, and starts the runner again five seconds after
it stops. With no `claude` on `PATH` it starts no runner.

## Signing in and billing

The runner has no credential of its own. Claude Code reads the login in
`~/.claude` in the home volume, the one `claude` in a terminal pane wrote, and
a run is billed to that subscription. `CLAUDE_CODE_OAUTH_TOKEN` from
`claude setup-token`, set on the container, does the same without the
interactive login.

Never set `ANTHROPIC_API_KEY` on the shell container. Claude Code prefers it to
the subscription, and every run would be billed to the API account.

## Related

* [Run a skill from the chat pane](/how-to/run-a-skill-from-the-chat-pane.md)
* [The chat pane](/explanation/the-chat-pane.md): why these choices
* [Mise tasks](/reference/mise-tasks.md#testing): `shell:test` and `chat:stub`
