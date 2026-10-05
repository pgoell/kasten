---
name: vault
description: Read, search and write notes in the user's kasten vault over its REST API with curl and a bearer token. Use when the user mentions kasten, their vault, notebook or notes, or asks to file, find, read or append something there, to dump a thought for later, or to put a PDF, epub or image from this machine into the vault. Skip it when the kasten MCP tools (list_notes, read_note, search_notes, query_graph, save_note, append_note, dump, save_file) are connected, except to upload a local file, which no MCP tool can carry.
---

# kasten vault

kasten serves one personal markdown vault. This skill reaches it with curl and
a bearer token, for a machine where the kasten MCP server cannot be used. The
routes are the same eight capabilities the MCP tools offer, and one more way in
for a file: its bytes, straight off this machine's disk.

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

There is no grep, no regex, no glob and no directory tree.

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

The folder names on this page, `00 Inbox`, `01 Periodic` and
`99 Misc/01 Config`, are kasten's defaults. A vault can be set up with its own,
and this page cannot know them. When the reading guide is not at the path above,
list the notes and find `reading-this-vault.md`: the folder holding it is the
config folder, and every guide beside it names that vault's own folders. Find the
inbox the same way, from a folder named like one, and ask the user when nothing
fits rather than making a `00 Inbox` they do not use.

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

### Query the graph

The notes and the links between them, `name:: [[target]]` relations included.
A filter narrows the notes; a pattern with `?variables` asks a question and
answers in rows. Every note that depends on one:

```sh
curl -sS --fail-with-body -G -H "Authorization: Bearer $KASTEN_TOKEN" \
  --data-urlencode 'q=?note depends-on [[GraphRAG]]' "$KASTEN_AGENT/graph"
```

Every note within two links of one, narrowed to concepts:

```sh
curl -sS --fail-with-body -G -H "Authorization: Bearer $KASTEN_TOKEN" \
  --data-urlencode 'around=GraphRAG' -d depth=2 \
  --data-urlencode 'q=type:Concept' "$KASTEN_AGENT/graph"
```

Answers `{"nodes", "edges", "columns", "rows", "truncated"}`. A node is
`{"path", "name", "type", "tags", "missing"}`, `missing` true for a note a link
names and nobody wrote. An edge is `{"source", "target", "relation", "line"}`,
`relation` null for a plain link. A pattern fills `rows`, one
`{"?note": "path"}` per match, and `truncated` is true when more matched than
came back. `depth` is 0 to 5, default 1. It walks past the archive folder; add
`-d archive=true` to include it. A blank `q` with no `around` lists every note,
so name a note, a type or a relation.

Filters: `type:Concept`, `tag:#ai`, `-tag:#draft`, `rel:depends-on`,
`is:orphan`, `path:"00 Inbox"`, or bare words matching a name. A pattern is
clauses split by `;`, each `subject relation object` or `subject filter`:
`?paper supports [[GraphRAG]]; ?paper type:Source`. The relation may be a
name, a `?variable`, `*` for any typed relation or `links` for any link.

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

### Dump a thought

Adds a paragraph to the `## Dump` section of the user's daily note for `date`,
the section they read at the end of the day to plan the next. Use it when the
user asks you to dump, jot or remember something and names no note, rather than
filing it in `00 Inbox/00 Agent/`. `date` is the user's local date,
`YYYY-MM-DD`, and has no default: the server may keep another timezone. The
note and the section are made when missing. Needs no `sha`:

```sh
curl -sS --fail-with-body -H "Authorization: Bearer $KASTEN_TOKEN" \
  --variable 'text=answer Jonas about the flat' --variable "d=$(date +%F)" \
  --expand-json '{"text": "{{text:json}}", "date": "{{d:json}}"}' \
  "$KASTEN_AGENT/dump"
```

`date +%F` is this machine's date. When the user is somewhere else, pass theirs.

### File a PDF, epub or image

Puts a file from this machine into the vault, raw bytes as the body. The path
ends in `.pdf`, `.epub`, `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp`, and the
file must be that format. Up to 100MiB. Never overwrites, and there is no
delete, so choose the path before you send.

A paper or a book belongs beside its note: the note's path with the suffix
swapped, `20 Literature/DDIA.md` and `20 Literature/DDIA.pdf`. The app opens
the file in a reader next to that note. Write the note too when there is none.

```sh
curl -sS --fail-with-body -H "Authorization: Bearer $KASTEN_TOKEN" \
  --data-binary @/path/to/ddia.pdf \
  --variable 'p=20 Literature/DDIA.pdf' --expand-url "$KASTEN_AGENT/files/{{p:url}}"
```

Answers `201` with `{"path": "…"}`. A file with a public URL can be fetched by
the server instead, with no download here:

```sh
curl -sS --fail-with-body -H "Authorization: Bearer $KASTEN_TOKEN" \
  --variable 'p=papers/Edge.pdf' --variable 'u=https://arxiv.org/pdf/2404.16130' \
  --expand-url "$KASTEN_AGENT/files/{{p:url}}/fetch" \
  --expand-json '{"url": "{{u:json}}"}'
```

## Errors

| What you see | What it means | Do |
| --- | --- | --- |
| `401` `That is not a token this vault knows` | Token unset, wrong or revoked | Ask the user to check `KASTEN_TOKEN`; never print it |
| `404` `No such note` | No readable note at that path | For a read, it is absent. Check the spelling with a search or a list |
| `409` with `current` | The note changed since you read it | Read it again, apply the edit to the new content, save with the new `sha`. Never retry with `current` alone |
| `400` with a sentence | The graph query could not be read, matches too much, or `around` names no note | Read the sentence, fix the query |
| `413` | A note write over 1MiB, or a file over 100MiB | Split the note; a file that big does not go in |
| `409` `Something is already there` | A file upload's path is taken | Pick another path; never overwrite |
| `400` `That file is not what its name says` | The bytes are not the suffix's format, often a login page saved as `.pdf` | Check the file or the URL |
| `400` `The vault will not take that path` | The path climbs out, is hidden, or has a suffix the vault does not take | Fix the path |
| `502` on a fetch | The URL did not resolve, answered an error, or broke off | Tell the user; check the URL |
| `422` `Nothing to capture` | A dump with no words in it | Send the thought itself |
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
- To learn what links to or depends on a note, query the graph rather than
  reading every note that names it.
- Reads need no confirmation. When the user asked for a write, write. When the
  path is your own choice, name it in your reply.
- Make every edit to a note in one save rather than several. Each save is a
  chance to meet a `409`.
