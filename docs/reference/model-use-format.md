---
type: Reference
title: Model use format
description: How the collector counts Claude Code's tokens and cost per day, model and project from its session files, the monthly notes it writes, the config note that holds the prices and the project folders, and what it never touches.
resource: backend/src/kasten_backend/model_use.py
tags: [vault, backend, format, review]
status: stable
---

# Model use format

The tokens Claude Code used, and what they cost at list prices, are lines in
one note per month. The collector reads Claude Code's own session files and
writes the lines; the year review reads them back. No API is asked and no
account is needed: every number comes off the computer the collector runs on.

```markdown
- 2026-10-26 claude-opus-5-5 kasten: in 1204, out 48210, cache write 512800, cache read 30120400, cost 11.8823 usd
- 2026-10-26 claude-haiku-5-5 kasten: in 310, out 9120, cache write 88000, cache read 1200300, cost 0.0347 usd
```

## Where the numbers live

1. A month is the note `<config>/Model use/YYYY-MM.md`, in the config folder
   ([`KASTEN_CONFIG_PATH`](/reference/configuration.md#the-vaults-folders)), so
   `99 Misc/01 Config/Model use/2026-10.md` on the default layout.
2. The collector writes the note whole: the frontmatter, a heading
   `# Model use YYYY-MM`, one sentence that says the collector writes it, then
   one line per day, model and project, in that order.
3. The frontmatter carries `generator: kasten-model-use` beside `id`,
   `created`, `type: Reference` and `modified`. That field is how the collector
   knows the note is its own. A note at the path without it is someone else's:
   the collector leaves it as it is and names it in its output.
4. A line the collector did not write, in a note of its own, stays: it is kept,
   in its order, after the usage lines.

## The line

`- YYYY-MM-DD <model> <project>: in N, out N, cache write N, cache read N, cost X usd`

* The day is the local day, on the collector's computer, of the message's
  `timestamp` (which the session file holds in UTC).
* The model is `message.model` as the session file holds it, such as
  `claude-opus-5-5`.
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
`subagents/agent-*.jsonl` file.

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
   source alone; a line of a day outside it is never changed. A day in the
   range with no messages loses its lines.
5. A run that would write the bytes a note already holds writes nothing, so a
   second run over the same files leaves every note as it was. A write goes to
   a hidden file in the same folder and is then renamed over the note, so a
   broken run leaves the old note.

## The price of a message

A message's price is its four counts times the rate of its row, per million
tokens. A cache write is priced by how long it keeps: `ephemeral_5m_input_tokens`
at the 5-minute rate and `ephemeral_1h_input_tokens` at the 1-hour rate, from
the usage's `cache_creation`. A record without that part prices its
`cache_creation_input_tokens` at the 5-minute rate.

The row is found by the model's id: the row named the same, or the longest
row whose name and a `-` start the id, so `claude-haiku-4-5` prices
`claude-haiku-4-5-20251001`. Two kinds of row stand beside a model's own:

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
gave them on 2026-10-26, and no projects, so every folder counts under its last
name. To change a price or map a folder, copy it to `<config>/model-use.md` and
edit it there. A price that changes is a new line you write; the
collector prices a run's days at the rows of that run, so a range written
again takes the new rates.

## The year review

`GET /api/model-use?from&to` answers the usage lines of the days from `from` to
`to` in the collector's notes; see [the HTTP API](/reference/http-api/notes.md#get-apimodel-use). The year review
draws tokens and cost per month and a table per project from them; with no line
in the year it says so and draws no number.
