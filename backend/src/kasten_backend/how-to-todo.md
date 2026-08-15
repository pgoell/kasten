---
type: Reference
---

# How to work with todos

For agents working in this vault, whether you run in kasten's own terminal pane
or on a machine outside it.

The vault is a directory of markdown files and it is the source of truth. A todo
is one line of a note, and that line carries every field the todo has. Nothing
about a todo lives anywhere else, so `rg`, an editor and `cat` are enough to
read and change one.

```markdown
- [/] wire up the pane #kasten 📅 2026-08-14 ⏳ 2026-08-12 ⏫ 🔁 every week ➕ 2026-08-09 ⏲ 2h 🆔 kt-3f9a2c
```

A markdown list item, a checkbox, the words, then the fields. The bullet and the
box are required and every field is optional.

## The rule

Edit the markdown directly for everything: writing a new todo, changing its
words, setting a date, adding a tag, indenting one todo under another, moving a
todo to another note.

One exception. **Ticking a todo done goes through the API**, because a
completion is not one character: it stamps the line, writes a line in today's
note, may write the next copy of a recurring todo, and may reopen todos that
were waiting on this one. [Completing a todo](#completing-a-todo) is the whole
list.

Two things are never yours to write: the `---` block at the top of a note, which
kasten keeps in step, and the `.jj` directory beside the notes.

## Reading

From the vault root, with `rg` and `cat`, which is all a read needs:

```sh
rg -n '^\s*- \[[ /xXb-]\] '            # every todo line, with note and line number
rg -n '📅 2026-08-14'                  # everything due that day
rg -n 'kt-3f9a2c'                      # the todo, its done log line, its sessions
cat '01 Periodic/00 Daily/2026-08-10.md'
```

`GET /api/todos` below answers the first of those over HTTP, if you would rather
have JSON.

## Reaching the API

In kasten's terminal pane the base URL is in `$KASTEN_API`. Outside it, use
whatever address serves the backend, `http://127.0.0.1:8000` when you run it
yourself.

```sh
curl -s "$KASTEN_API/api/todos"                     # every candidate todo line
curl -s "$KASTEN_API/api/search?q=kt-3f9a2c"        # every line naming an id
curl -s "$KASTEN_API/api/files/01%20Periodic/00%20Daily/2026-08-10.md"
```

`GET /api/todos` answers with one object per line, `{"path", "line", "text"}`,
and parses nothing: you read the format below yourself. It also returns time log
lines, which are not todos.

Writing a note back:

```sh
curl -s -X PUT "$KASTEN_API/api/files/<path>" \
  -H 'content-type: application/json' \
  -d "$(jq -n --arg content "$(cat note.md)" '{content: $content}')"
```

`PUT` takes the whole note and replaces it, so read the note first and send back
what you got with your change in it. `POST` on the same path starts a note that
is not there yet and takes the same body. A write through either is stamped with
today's date, recorded in the vault's history as its own change, and reaches an
open kasten at once.

If you cannot reach the API at all, do the same writes straight to the files.
You lose the stamp and the history entry, nothing else. Say so when you report
back.

## Completing a todo

Today's date below is the day you are doing this, `YYYY-MM-DD`.

1. Find the line: `GET /api/todos`, or `rg` in the vault.
2. Rewrite it: the box becomes `[x]`, add `✅ <today>`, and add
   `🆔 kt-<six hex>` if the line carries no id. Keep
   [the field order](#the-field-order).
3. If the todo has parts, that is todos indented under it, tick every part that
   is still `[ ]`, `[/]` or `[b]`: box `[x]` and `✅ <today>` on each, no id.
   Leave a part already done or rejected alone.
4. If the line carries `🔁`, leave the finished line where it is and put a fresh
   copy above it, one period on. Move every date it carries by the same number
   of days, and drop the `✅`, the `🆔` and the `⏱` from the copy.
   [Recurrence](#recurrence) says how the period is counted.
5. If a `- HH:MM-` session line in `## Time` names this todo's id with no end
   time on it, close it with the current time, then rewrite the todo's `⏱` as
   the sum of every closed session naming that id across the vault. Find them
   with `GET /api/search?q=<id>`.
6. `PUT` the note.
7. Write the done log line under `## Done` in today's daily note,
   `01 Periodic/00 Daily/<today>.md`:

   ```markdown
   - ✅ 2026-08-10 wire up the pane [[projects/kasten]] kt-3f9a2c
   ```

   The day, the todo's words, a link to the note it lives in, and its id. Leave
   the link off when the todo lives in that daily note already. Make the heading
   if the note has none, and the note itself with `POST` if the vault has none.
   Search the id first: one line per todo, never two.
8. If the todo carries an `🆔`, look for todos blocked by it,
   `GET /api/search?q=<id>` and keep the `⛔` lines. A dependent sitting at `[b]`
   whose every `⛔` now names a closed todo becomes `[ ]`. Touch no other state.
   `PUT` each note you changed.

Un-ticking is the same walk backwards: the box goes back to `[ ]`, the `✅` comes
off, the done log line is deleted wherever it sits, and dependents go back to
`[b]`. Parts stay done.

## The fields

| Field | Written | Value |
| --- | --- | --- |
| due | `📅 2026-08-14` | a date |
| scheduled | `⏳ 2026-08-12` | a date |
| start | `🛫 2026-08-11` | a date |
| priority | `🔺` `⏫` `🔼` `🔽` `⏬` | the glyph alone, no value |
| recurrence | `🔁 every week` | a rule, see below |
| created | `➕ 2026-08-09` | a date |
| done | `✅ 2026-08-10` | a date |
| cancelled | `❌ 2026-08-10` | a date |
| estimate | `⏲ 2h` | a duration |
| worked | `⏱ 1h20m` | a duration, written by kasten off the time log |
| id | `🆔 kt-3f9a2c` | `kt-` and six hex characters |
| blocked by | `⛔ kt-8b1e04` | another todo's id |
| tags | `#health` | a word, left where you typed it |

**A date** is `YYYY-MM-DD` and nothing else. `📅 next tuesday` is not a date, so
the whole of it stays in the words where you can see it.

**A duration** is `2h`, `45m` or `1h20m`. `90`, `1h30` and `two hours` are not.

**The five priorities** read highest, high, medium, low and lowest, in the order
of the table. A todo carries at most one.

**An id** is unique in the vault. Six hex characters after `kt-`, from a real
random source, because the id is what the done log, the time log and every `⛔`
name.

**`⛔` may appear more than once** and each one names an id. Every other field
appears once. A todo opens only when every `⛔` on it names a closed todo, and a
`⛔` naming an id no note holds changes nothing.

Every field except the two clocks is what the obsidian-tasks plugin already
reads, so this vault opened in Obsidian shows working tasks.

## The five states

| Box | State |
| --- | --- |
| `[ ]` | open |
| `[/]` | doing |
| `[x]` | done |
| `[b]` | blocked |
| `[-]` | rejected |

`[X]` reads as done too, because other editors write it that way. Write `[x]`.
Open means neither done nor rejected, so a blocked todo is open work. Entering
rejected stamps `❌ <today>`, and leaving it drops that stamp.

## The field order

The words first, then the fields:

```
📅 ⏳ 🛫 priority 🔁 ➕ ✅ ❌ ⏲ ⏱ 🆔 ⛔
```

kasten rebuilds a todo line rather than patching it, so a line whose fields sit
in another order is rewritten the first time anything touches it. Write this
order and your line comes back byte for byte. Tags are the exception: they stay
in the words where they were typed.

## Recurrence

```
every day | every week | every month | every year
every <n> days | every <n> weeks | every <n> months | every <n> years
```

and any of them may end `when done`. A rule this does not cover stays in the
words and writes nothing.

The next copy is counted off the due date, or the scheduled date, or the start
date, whichever the todo has first. `when done` counts off the day it was
ticked. A month rule counts calendar months and clamps to the last day of a
month too short for it: the thirty-first of January one month on is the
twenty-eighth of February. A recurring todo carrying no date at all writes no
copy.

## Two things that look like todos

`1. [ ] ordered` is an ordered list item and `- [[borges]]` is a bullet holding
a link. Neither is a todo. Neither is the done log line, which is `- ✅` and
deliberately not a checkbox, so it cannot come back as a todo of its own.

## Subtasks

A todo indented under another is a part of it. The indent is the whole rule: a
todo belongs to the nearest todo above it carrying a smaller indent, and prose
between two todos ends nothing. Indent with spaces, two per level.

```markdown
- [/] safari packing 📅 2026-08-14
  - [x] passport ✅ 2026-08-09
  - [ ] esim
    - [ ] pick a plan
```

kasten counts the parts and shows `1/3` after the parent's words. Do not write
that count yourself; it is drawn, not stored.

A part carrying no `📅`, `⏳`, `🛫` or priority of its own is read as having the
one the todo above it carries, however many steps up that is. So do not copy a
parent's date onto its parts: write it once, and write a date on a part only
where that part is due on a different day from the whole. `🆔`, `➕`, `✅`, `❌`,
`⛔`, `🔁`, `⏲` and `⏱` are never taken from a parent, each saying something
about one line.
