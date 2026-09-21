---
name: vault
description: Read, search and write notes in the user's kasten vault over its REST API with curl and a bearer token. Use when the user mentions kasten, their vault, notebook or notes, or asks to file, find, read or append something there. Skip it when the kasten MCP tools (list_notes, read_note, search_notes, save_note, append_note) are connected; those do the same job.
---

# kasten vault

kasten serves one personal markdown vault. This skill reaches it with curl and
a bearer token, for a machine where the kasten MCP server cannot be used. The
five routes are the same five capabilities the MCP tools offer.

## Auth

Two environment variables, both required:

- `KASTEN_TOKEN`: the bearer secret, `kasten_…`, minted at `/tokens` in the notebook
- `KASTEN_AGENT`: the base URL ending in `/agent`, `https://kasten.example.com/agent`, no trailing slash

Do not check them upfront. Run the request, and read Errors below if it fails.
Never print, echo or log `$KASTEN_TOKEN`. To check it is set, use
`test -n "$KASTEN_TOKEN"` and nothing that shows the value.

## How every request is built

```sh
curl -sS --fail-with-body -H "Authorization: Bearer $KASTEN_TOKEN" ...
```

`--fail-with-body` exits 22 on any 4xx or 5xx and still prints the JSON body,
so a refusal never passes for an answer.

**Paths go through curl's URL encoder, never by hand.** Note paths hold spaces,
umlauts, `#`, `&` and `?`. Put the path in a curl variable and expand it with
`:url`:

```sh
--variable 'p=00 Inbox/00 Agent/Idea.md' --expand-url "$KASTEN_AGENT/notes/{{p:url}}"
```

`:url` encodes the `/` as `%2F` too. The server decodes it back, so that is
correct.

**Note bodies never go into hand-quoted JSON.** Write the markdown to a file
with the Write tool, load it into a curl variable with `@`, and let `:json`
escape it:

```sh
--variable content@/path/to/body.md --expand-json '{"content": "{{content:json}}"}'
```

`--expand-json` sends the body as `POST` with a JSON content type. Add `-X PUT`
for a save. `{{…}}` inside the file is not expanded again, so a note may hold
braces.

`--variable` and the `:url` and `:json` functions need curl 8.3 or newer.

## The vault

There is no grep, no regex, no glob and no directory tree. There are five
routes.

The vault is an Open Knowledge Format bundle whose notes link to each other
with `[[wikilinks]]`, and it documents its own conventions. **Before the first
write, read `99 Misc/01 Config/reading-this-vault.md`.** It holds the five-step
rule by which a `[[wikilink]]` resolves, which you cannot guess, and what the
block at the top of a note carries.

Four more guides sit in `99 Misc/01 Config/01 Agents/`. Read the one that
matches the note before you write it:

| Guide | What it covers |
| --- | --- |
| `Ontology.md` | the note types and the relations between them |
| `How-To-Index.md` | what an `index.md` or a `log.md` carries |
| `How-To-TODO.md` | the line a todo is written on |
| `How-To-Exam.md` | the note a practice exam is written in |

Filing: a note you were not told where to put goes in `00 Inbox/00 Agent/`. A
path you were given is the path to use. There is no delete, no move and no
rename here, so a note written to the wrong place stays there until the user
moves it in the app.

## Read

### List notes

```sh
curl -sS --fail-with-body -H "Authorization: Bearer $KASTEN_TOKEN" "$KASTEN_AGENT/notes"
```

A JSON array of relative paths, sorted. To list one folder and everything
under it:

```sh
curl -sS --fail-with-body -G -H "Authorization: Bearer $KASTEN_TOKEN" \
  --data-urlencode 'folder=00 Inbox' "$KASTEN_AGENT/notes"
```

A folder that does not exist answers `[]`.

### Search

```sh
curl -sS --fail-with-body -G -H "Authorization: Bearer $KASTEN_TOKEN" \
  --data-urlencode 'q=forking paths' "$KASTEN_AGENT/search"
```

A fixed-string, case-insensitive scan of every line, not a regex, up to 2,000
hits: `[{"path": "…", "line": 3, "text": "…"}]`, `line` 1-based. It walks past
the archive folder; add `-d archive=true` to include it. A blank `q` answers
`[]`.

### Read a note

```sh
curl -sS --fail-with-body -H "Authorization: Bearer $KASTEN_TOKEN" \
  --variable 'p=00 Inbox/00 Agent/Idea.md' --expand-url "$KASTEN_AGENT/notes/{{p:url}}"
```

Answers `{"path", "content", "sha"}`. `content` is the whole file, frontmatter
block included. Keep `sha`: an overwrite needs it back. A note that is not
there is `404`.

## Write

Writes are conditional. Both create the note when it is absent, and the folders
above it on the way. The server writes the frontmatter fields `id`, `created`,
`type` (when missing) and `modified`; never hand-write `id`, `created` or
`modified`.

**The `sha` for your next write is the one the last response returned**, never
a hash of what you sent. The server stamps the frontmatter on the way in, so
the bytes on disk differ from your body.

### Create a note

Only for a path the read answered `404`. No `sha`:

```sh
curl -sS --fail-with-body -X PUT -H "Authorization: Bearer $KASTEN_TOKEN" \
  --variable 'p=00 Inbox/00 Agent/Idea.md' --variable content@/path/to/body.md \
  --expand-url "$KASTEN_AGENT/notes/{{p:url}}" \
  --expand-json '{"content": "{{content:json}}"}'
```

### Overwrite a note

Read it first. Start the body from the `content` the read returned, keep its
frontmatter block, and change the rest. The server restores `id`, `created` and
`type` from the note on disk when the body lacks them, but any other field the
body drops, `tags` for one, stays dropped. Present the read's `sha`:

```sh
curl -sS --fail-with-body -X PUT -H "Authorization: Bearer $KASTEN_TOKEN" \
  --variable 'p=00 Inbox/00 Agent/Idea.md' --variable content@/path/to/body.md \
  --expand-url "$KASTEN_AGENT/notes/{{p:url}}" \
  --expand-json '{"content": "{{content:json}}", "sha": "3b1f…c7"}'
```

### Append

Adds text to the end of a note, one blank line after what was there, and
creates the note when it is absent. Needs no `sha`, because the server reads
and writes under one lock:

```sh
curl -sS --fail-with-body -H "Authorization: Bearer $KASTEN_TOKEN" \
  --variable 'p=00 Inbox/00 Agent/Idea.md' --variable 'text=- [ ] call the plumber' \
  --expand-url "$KASTEN_AGENT/notes/{{p:url}}/append" \
  --expand-json '{"text": "{{text:json}}"}'
```

For text over one line or holding a single quote, write it to a file and use
`--variable text@/path/to/line.md` instead.

## Errors

| What you see | What it means | Do |
| --- | --- | --- |
| `401` `That is not a token this vault knows` | Token unset, wrong or revoked | Ask the user to check `KASTEN_TOKEN`; never print it |
| `404` `No such note` | No readable note at that path | For a read, it is absent. Check the spelling with a search or a list |
| `409` with `current` | The note changed since you read it | Read it again, apply the edit to the new content, save with the new `sha`. Never retry with `current` alone |
| `413` | The write would leave more than 1MiB on disk | Split the note |
| `421` | `KASTEN_AGENT` names a host the server does not answer to | Ask the user for the right URL |
| HTML or a redirect to a sign-in page | `KASTEN_AGENT` does not end in `/agent`, or the proxy in front is misconfigured | Check the URL |
| `option --variable: is unknown` | curl older than 8.3 | Ask the user to update curl |
| curl exit 6, 7 or 28 | Host unreachable, likely a network proxy blocking it | Tell the user; do not retry in a loop |
| curl exit 60 | A proxy re-signs TLS and curl does not trust it | Tell the user. Never pass `-k` or `--insecure` |

The routes describe themselves:

```sh
curl -sS --fail-with-body -H "Authorization: Bearer $KASTEN_TOKEN" "$KASTEN_AGENT/openapi.json"
```

## How to work

- To find a note, search before you list. A list of the whole vault is long.
- Reads need no confirmation. When the user asked for a write, write. When the
  path is your own choice, name it in your reply.
- Make every edit to a note in one save rather than several. Each save is a
  chance to meet a `409`.
