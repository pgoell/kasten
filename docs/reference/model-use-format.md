---
type: Reference
title: Model use format
description: How the collector counts the tokens and cost per day, model and project of Claude Code, codex and grok from their session files, the monthly notes it writes, the config note that holds the prices and the project folders, and what it never touches.
resource: backend/src/kasten_backend/model_use.py
tags: [vault, backend, format, review]
status: stable
---

# Model use format

The tokens Claude Code, codex and grok used, and what they cost at list prices, are
lines in one note per month. The collector reads the session files of all three
tools and writes the lines; the year review reads them back. No API is asked
and no account is needed: every number comes off the computer the collector
runs on.

```markdown
- 2026-10-26 claude-opus-5-5 kasten: in 1204, out 48210, cache write 512800, cache read 30120400, cost 11.8823 usd
- 2026-10-26 claude-haiku-5-5 kasten: in 310, out 9120, cache write 88000, cache read 1200300, cost 0.0347 usd
- 2026-10-26 codex/gpt-6-astra kasten: in 9822, out 213, cache write 0, cache read 12032, cost 0.1209 usd
- 2026-10-26 grok/grok-4.7 kasten: in 41820, out 1930, cache write 0, cache read 96400, cost 0.1434 usd
```

The last two lines are codex and grok lines. Each names its tool before its
model. The first two are Claude Code lines, which name no tool.

## Where the numbers live

1. A month is the note `<config>/Model use/YYYY-MM.md`, in the config folder
   ([`KASTEN_CONFIG_PATH`](/reference/configuration.md#the-vaults-folders)), so
   `99 Misc/01 Config/Model use/2026-10.md` on the default layout.
2. The collector writes the note whole: the frontmatter, a heading
   `# Model use YYYY-MM`, one sentence that says the collector writes it, then
   one line per day, tool, model and project, in that order. Frontmatter fields the
   collector did not set stay where they were.
3. The frontmatter carries `generator: kasten-model-use` beside `id`,
   `created`, `type: Reference` and `modified`. That field is how the collector
   knows the note is its own. A note at the path without it is someone else's:
   the collector leaves it as it is and names it in its output.
4. A line the collector did not write, in a note of its own, stays: it is kept,
   in its order, after the usage lines.

## The line

`- YYYY-MM-DD [<tool>/]<model> <project>: in N, out N, cache write N, cache read N, cost X usd`

* The day is the local day, on the collector's computer, of the message's
  `timestamp` (which the session file holds in UTC).
* The tool is `codex` on a codex line and `grok` on a grok line, written before the model and a `/`.
  A Claude Code line has no tool part. A line with no `tool/` reads as Claude
  Code, so every older note reads the same.
* The model is `message.model` as the session file holds it, such as
  `claude-opus-5-5`. On a codex line it is the model the session names, such as
  `gpt-6-astra`. On a grok line it is the model's key in `usage.modelUsage`, such
  as `grok-4.7`.
* The project is the rest up to the colon; it may hold spaces.
* `in`, `out`, `cache write` and `cache read` are whole token counts:
  `input_tokens`, `output_tokens`, `cache_creation_input_tokens` and
  `cache_read_input_tokens` summed over the day's messages.
* `cost` is in US dollars to four decimals, the sum of each message's own
  price. A line whose messages found no price says `cost unknown`; a line where
  some did ends `, unpriced N` with the tokens left out of the cost.

A line that does not read this way is no usage line: the year review passes it
over, and the collector keeps it as a line it did not write.

## What the collector counts

`python -m kasten_backend.model_use <source> <vault> [--from YYYY-MM-DD] [--to YYYY-MM-DD]`,
or `mise run model-use -- <source> <vault>` (absolute paths, since the task
runs in `backend/`), reads every `*.jsonl` under
`<source>`, at any depth, so `~/.claude/projects` with each subagent's
`subagents/agent-*.jsonl` file, `~/.codex/sessions`, or `~/.grok/sessions`.

The shape of a file says which tool wrote it. A `*.jsonl` whose first record
is `session_meta` is a codex session file, read by
[its rules](#codexs-session-files). A `*.jsonl` whose first record is a JSON-RPC
notification, an object with a `method` and a `params` object, is a grok session
file, read by [its rules](#groks-session-files). Any other is read as Claude
Code's. A folder that holds several kinds counts all of them, and no flag is
needed.

Points 1 to 3 cover Claude Code's files.

1. A record counts when its `type` is `assistant` and its `message` carries an
   `id`, a `model` and a `usage`. `<synthetic>` is no model, and a line that is
   no JSON is passed over.
2. Each message counts once, by `message.id`. Claude Code writes one record per
   block of an answer, each with the answer's usage, and a resumed session
   copies the earlier records into its new file. The record with the most
   output tokens counts: an early record of an answer can carry the output
   counted so far, as 108 of 661 message ids in one sample of real files did.
3. The project is the record's `cwd` through the
   [projects table](#the-config-note): the longest folder that is the `cwd` or
   holds it. A `cwd` no row names counts under its last folder name, so
   `/home/pascal/Code/blattwerk` is `blattwerk`. A colon in the name is dropped.
4. `--from` and `--to` name the days the run writes, both ends in, yesterday
   and today when left out. A line of a day in the range is written from the
   source alone, and it replaces that day's lines of the same tool. A run over
   codex or grok files rewrites that day's lines of that tool and keeps the lines
   of the other tools. A line of a day outside the range is never changed.
   A day in the range with no counted message in the source keeps its lines as
   they are, so a source that lost a day's files does not empty that day's note.
5. A run that would write the bytes a note already holds writes nothing, so a
   second run over the same files leaves every note as it was. A write goes to
   a hidden file in the same folder and is then renamed over the note, so a
   broken run leaves the old note.
6. A source that does not exist, or holds no `*.jsonl` at any depth, is refused:
   the run prints why, exits with status 2 and writes nothing.
7. A session file last written before the first day of the range is not read.
   Claude Code appends to its files, so such a file holds no message of the
   range, and a run over a long history does not read every file again.

## Codex's session files

A codex call is an `event_msg` record of payload type `token_count` that carries
`info.last_token_usage`. Each such record is one model call, and each call
counts once.

* `in` is `input_tokens` less `cached_input_tokens`. `cache read` is
  `cached_input_tokens`. `cache write` is `cache_write_input_tokens`, which is 0
  in every file seen. `out` is `output_tokens`, and it already holds the
  reasoning tokens.
* `token_usage_record` records, which newer codex writes, name the same calls.
  The collector does not read them.
* A `token_count` with `info: null` is passed over. So is one that repeats the
  file's previous total. A call copied into another file, with the same
  timestamp and total, counts once.
* The model and the cwd come from the latest `turn_context` before the event.
  A turn with no cwd takes the cwd of `session_meta`. An event before any model
  is passed over.
* The day is the local day of the event's timestamp, as for Claude Code. The
  project follows point 3 above.

## grok's session files

A grok turn is a record whose `params.update.sessionUpdate` is `turn_completed`.
Its `usage.modelUsage` holds the turn's counts per model, and each model gives
one message. Each turn counts once.

* `in` is `inputTokens` less `cachedReadTokens` and `cacheCreationTokens`, since
  grok counts both inside `inputTokens`. `cache read` is `cachedReadTokens`.
  `cache write` is `cacheCreationTokens`. `out` is `outputTokens`, and it already
  holds the reasoning tokens.
* A turn counts once by its `prompt_id` and model. The same turn in two files
  counts once, and of two with the same id the one with more output is kept.
* The model is the model's key in `modelUsage`. The day is the local day of the
  record's top-level `timestamp`, which is in seconds since 1970.
* The project comes from the session's folder. grok keeps a session at
  `~/.grok/sessions/<folder>/<session>/updates.jsonl`, where `<folder>` is the
  working folder, percent-encoded: `%2Fhome%2Fme%2FCode%2Fkasten` is
  `/home/me/Code/kasten`. The project follows point 3 above.
* grok logs a turn's counts summed over its model calls, and the number of calls
  in `modelCalls`. xAI bills a request whose prompt reaches 200,000 tokens at the
  higher rate, so a turn takes its `over 199999` row when its `inputTokens`
  divided by its calls is above 199999. That is an approximation. Claude Code and
  codex messages are one call each, so nothing changes for them.
* A line that is no JSON is passed over, and so is a `turn_completed` with no
  usage, `modelUsage`, `prompt_id` or timestamp, and a model entry that is not an
  object. grok's other files, `chat_history.jsonl`, `events.jsonl`,
  `rewind_points.jsonl` and `prompt_history.jsonl`, count nothing.

## The price of a message

A message's price is its four counts times the rate of its row, per million
tokens. A cache write is priced by how long it keeps: `ephemeral_5m_input_tokens`
at the 5-minute rate and `ephemeral_1h_input_tokens` at the 1-hour rate, from
the usage's `cache_creation`. A record without that part prices its
`cache_creation_input_tokens` at the 5-minute rate.

A codex call is priced the same way, from the rows of its model. OpenAI charges
no cache write, so both cache write rates of an OpenAI row equal its input
rate. The `over N` row applies as above: `gpt-6-astra over 272000` prices a
call whose prompt is above 272000 tokens, which is OpenAI's long context.

A grok model's counts are priced the same way, from its own rows. xAI lists no
cache write rate, so a grok row charges a cache write at its input rate. xAI's
long context starts at a prompt of 200,000 tokens, so its `over` rows read
`over 199999`. grok's CLI bills `grok-4.7-build`, which xAI lists no price for,
so its lines say `cost unknown` until a `grok-4.7-build` row is added to the
config note.

The row is found by the model's id: the row named the same, or the row whose
name is followed by a `-` and an eight-digit date, so `claude-haiku-4-5` prices
`claude-haiku-4-5-20251001`. Any other suffix names a model of its own:
`claude-opus-5-6` has no row until a line names it, so it is unpriced until
then, even though `claude-opus-5` is in the table. Two kinds of row stand beside
a model's own:

* `<model> fast` prices a message whose usage says `"speed": "fast"`.
* `<model> over N` prices a message whose prompt (input, cache write and cache
  read) is above N tokens. Haiku 5.5 has one at 100,000.

A message with no row it can take has no price. Its tokens still count, and its
line says so.

## The config note

The prices and the project folders are in `<config>/model-use.md`, so
`99 Misc/01 Config/model-use.md` on the default layout.

```markdown
## Prices
- claude-opus-5-5: input 4, output 20, cache write 5m 5, cache write 1h 8, cache read 0.2
- claude-opus-5-5 fast: input 8, output 40, cache write 5m 10, cache write 1h 16, cache read 0.4
- claude-haiku-5-5 over 100000: input 0.5, output 2.5, cache write 5m 0.625, cache write 1h 1, cache read 0.05
- gpt-6-astra: input 10, output 50, cache write 5m 10, cache write 1h 10, cache read 1

## Projects
- /home/pascal/Code/kasten: kasten
- /home/pascal/Code/.worktrees/kasten: kasten
```

* Only `- ` lines at the start of a line under `## Prices` or `## Projects` are
  read. Every other line is free text, so the note says where its prices came
  from and when.
* A price line names a model, an optional ` fast` and an optional ` over N`,
  then all five rates in US dollars per million tokens, in this order. A rate
  is a number from 0, with a point.
* A project line is a folder, absolute, a `:` and a space, then the name.
* A line that breaks these rules is broken: the collector names it as
  `Skipped line N of model-use.md: <text>` and reads the rest.

With no config note in the vault, the collector reads the one it ships with,
`backend/src/kasten_backend/model-use.md`, and says so. It never writes the
config note. That table holds Anthropic's list prices as
[the pricing page](https://platform.claude.com/docs/en/about-claude/pricing)
gave them on 2026-10-26. It also holds OpenAI's list prices for gpt models, at
the standard tier, as [the pricing page](https://developers.openai.com/api/docs/pricing)
gave them on 2026-10-26. It also holds xAI's list prices for grok models, as
[the models page](https://docs.x.ai/docs/models) gave them on 2026-10-26. It holds
no projects, so every folder counts under its
last name. To change a price or map a folder, copy it to `<config>/model-use.md` and
edit it there. A price that changes is a new line you write; the
collector prices a run's days at the rows of that run, so a range written
again takes the new rates.

## The year review

`GET /api/model-use?from&to` answers the usage lines of the days from `from` to
`to` in the collector's notes; see [the HTTP API](/reference/http-api/notes.md#get-apimodel-use). The year review
draws tokens and cost per month and a table per project from them; with no line
in the year it says so and draws no number.

Codex's and grok's lines count into the same months and project rows as Claude
Code's. The API has no tool field, so it answers a codex or grok line with its
`model` as the model without the `codex/` or `grok/` part, such as `gpt-6-astra`
or `grok-4.7`.
