---
type: Reference
title: States, blockers and parts
description: The seven states, the cycle that walks a line through them, the keys that set one, the parts a todo carries under it, the dependencies that hold one back, and the waiting state that names who it waits on.
resource: frontend/src/lib/todo.ts
tags: [vault, todos, format, frontend]
status: stable
---

# States, blockers and parts

## The seven states

| Box | State | Drawn |
| --- | --- | --- |
| `[ ]` | open | ☐ |
| `[/]` | doing | ◐ |
| `[r]` | review | ◎ |
| `[x]` | done | ☑ |
| `[b]` | blocked | ⊘ |
| `[w]` | waiting | ◷ |
| `[-]` | rejected | ☒ |

`[X]` reads as done as well, because another editor writes it that way. kasten
always writes `[x]`. `[R]` is no todo: only the `x` has a capital that counts.

Seven rather than the plugin's two, because blocked, waiting and rejected are
things that happen to work and a todo that is neither open nor done has to be
able to say which. Review is the same kind of thing: the work is done and only
the owner's check is left, which neither doing nor done can say. `[/]` and
`[-]` are what most Obsidian themes already style; `[r]`, `[b]` and `[w]` have
no convention behind them and read as what they are. Obsidian shows a box it
does not know as a task that is not done.

Blocked and waiting are two different holds. A blocked todo waits on another
todo, which its `⛔` names. A waiting todo waits on somebody, for an approval or
an answer, and [its `👤`](#waiting-on-somebody) says who and since when.

Review is the agent's state. An agent sets `[r]` when its work on a todo is
done and the owner has to check it, and it never ticks the todo `[x]` itself.
The owner's tick is the approval.

Open means neither done nor rejected, which is what
[the todo pane and the todo overlay](/reference/editor-keys/todos.md#todos) both show.
A blocked todo is open work, and so are a waiting one and one in review.

## The cycle

`<leader>x` in the editor, and `x` in the todo pane, walk one line one step:

| From | To | Stamps |
| --- | --- | --- |
| a plain line | `[ ]` | `➕` today, unless the line already carries one |
| `[ ]` | `[/]` | nothing |
| `[/]` | `[x]` | `✅` today, and `🆔` unless the line already carries one |
| `[r]` | `[x]` | `✅` today, and `🆔` unless the line already carries one |
| `[x]` | a plain line | strips the `✅` it wrote |
| `[b]` | `[/]` | nothing |
| `[w]` | `[/]` | strips the `👤` |
| `[-]` | a plain line | strips the `❌` it wrote |

The walk is the work: not started, started, finished, and out of the list again.
Review, blocked, waiting and rejected are things that happen to work rather
than steps in it, so none is on the walk and each has
[a key of its own](#setting-a-state). That is also what puts done last. A list
of open work loses a row the moment it is done, so a walk with two closed
states in it could never reach the second: from the todo pane the old order
made blocked and rejected unreachable, because the row left the list at done
and took the rest of the walk with it.

The walk picks a blocked line up where the work left off, at doing, rather than
at the start of it. A todo somebody blocked is one somebody had begun. It picks
a waiting line up at the same place, the answer having come.

A review line goes the other way, one press to done with its `✅` and its id. An
agent puts a todo in review and no person walks into it, so no step of the walk
lands there. Out of it, the owner's check is the one thing left and the press
is that check. A blocked or a waiting todo still has work in it, so it goes
back to doing; a todo in review has none.

The first step reads the fields already on the line, so a todo written out by
hand arrives carrying them. It takes the line's bullet off where it had one, the
box standing in for it.

Either step out drops the bullet, the box and the stamp its own state wrote, and
keeps every other field, so three more presses give the todo back with its
dates. It patches the line the way every other step does, so the tag stays
where it was typed:

```markdown
- [-] call the dentist 📅 2026-08-14 ⏫ ➕ 2026-08-09 ❌ 2026-08-10 #health
```

becomes

```markdown
call the dentist 📅 2026-08-14 ⏫ ➕ 2026-08-09 #health
```

An id is stamped when something first needs to name the todo: on entering done,
on starting a timer, whose session line has to name it, and on `<leader>i`,
which is how you name a todo that is still open so a `⛔` can point at it. A
todo nothing refers to never gets one, and a second
`<leader>i` leaves the id the first one wrote. `kt-` prefixes it so a grep for
the id cannot hit a word of prose, and the six characters after it are hex from
the browser's own random source, because an id goes to disk and has to be unique
across machines.

Ticking a parent takes its parts with it, and ticking a recurring todo writes
the next copy. [Subtasks](#subtasks) and [Recurrence](/reference/todo-format/time-and-repeats.md#recurrence) below say
what those two presses write.

## Setting a state

Seven keys put a line straight into one state from wherever it was: `O`, `P`,
`V`, `X`, `B`, `W` and `R` in the todo pane and on the board, and `<leader>so`,
`<leader>sp`, `<leader>sv`, `<leader>sx`, `<leader>sb`, `<leader>sw` and
`<leader>sr` in the editor. By touch the row's `⋯` strip names them, `review`
among them. `p` is in progress, `d` being spent on the done list, and `v` is
verify, `r` being spent on rejected.

A state is worth the same whichever key wrote it. Entering done stamps `✅`
today and an `🆔` where the line carries none, entering rejected stamps `❌`
today, and leaving either drops the stamp it wrote, exactly as the walk does.
Entering waiting stamps `👤` today, and leaving it drops the `👤` whole.
A key aimed at the state a line is already in changes nothing. A plain line
becomes a todo in that state, carrying the `➕` the walk would have stamped.

Everything a press drags with it comes too: a parent set to done takes its open
parts, a recurring todo set to done writes its next copy, and a todo carrying an
`🆔` set into or out of done moves what waits on it.

## Subtasks

A todo indented under another is a part of it:

```markdown
- [/] safari packing 📅 2026-08-14
  - [x] passport ✅ 2026-08-09
  - [ ] esim
    - [ ] pick a plan
```

The indent is the whole rule. A todo belongs to the nearest todo above it
carrying a smaller indent, and nothing ends a block: prose between two todos
leaves the nesting alone, which is what markdown itself does and what lets the
pane, which never sees that prose, read the same tree the editor reads.

A part takes what the todo above it carries and does not spell for itself: the
due date, the scheduled date, the start date, the priority and
[the client mark](/reference/todo-format/tags-projects-and-views.md#client-work). `esim` above is
due 2026-08-14, and so is `pick a plan`, each field coming off the nearest todo
above it that carries one. A part that spells its own wins, and that is the
whole of the override: `- [ ] esim 📅 2026-08-12` is due on the twelfth whatever
its parent says.

Nothing else comes down. `🆔` names one line, `➕`, `✅` and `❌` stamp what
happened to it, `⏲` and `⏱` measure it, `⛔` waits on something and `🔁` copies
it: passing any of those down would say of five lines what was written of one.

This is read rather than written. The line still says only what somebody typed
on it, so moving a parent's date moves every part with it, and what the vault
holds is what you would write by hand. The pane is where it shows: an undated
part sits in its parent's group, drawn under it, with that date on the row, and
a part whose parent has a `🛫` in the future waits with it. The editor draws the
note, so a part's line shows the date it carries and no other.

A parent shows `1/3` after its words, in the editor and on its row in the pane.
The count is every descendant rather than the direct children, so a part with
parts of its own counts each of them, and a part that is done or rejected counts
as closed. A todo with no parts shows nothing.

Ticking a parent done ticks every part that is still open, stamping today's
`✅` on each and leaving a part that was already done or rejected where it is.
Blocked, waiting and review count as open, so a `[b]`, a `[w]` or an `[r]` part
goes done with the rest, the `[w]` one losing its `👤`. One
`- ✅` line is written for the press, naming the parent, because six lines for
one press is noise, and no part gets an id, nothing naming one. It is one
buffer edit, so one `u` puts every line back.

Ticking the last part leaves the parent alone, and un-ticking a parent leaves
its parts done. Both directions are the spec's own asymmetry: finishing the
whole thing finishes the parts, while a parent usually has work of its own that
no part names.

The indent is typed by hand in a note, and written for you from the todo pane:
[`s`](/reference/editor-keys/todo-pane.md#the-todo-pane) puts what you type in as a part
of the row under the cursor, two spaces further in than that row's own line and
after the parts it already has. It is the add prompt's shorthand either way, so
`s` and `a` write the same kind of line into different places.

## Dependencies

`⛔` names another todo's id, and says this todo waits on that one:

```markdown
- [/] ship the release 🆔 kt-c0ffee
- [b] write the docs ⛔ kt-c0ffee
```

[`b` in the todo pane](/reference/editor-keys/todo-pane.md#the-todo-pane) writes the
pair: you pick the blocker from the list, kasten stamps a `🆔` on it where it
has none, and the todo under the cursor gets the `⛔`. An open todo becomes
`[b]` in the same write, unless the blocker is already closed. The blocker's
note is written first, so a write that fails halfway leaves an id nothing
names and never a `⛔` naming nothing.

Closing or reopening the blocker rewrites every dependent naming it, in
whichever note each one lives in, so the line says the truth without anything
having to work it out at read time. The write runs from the blocker's side
only: a `⛔` typed by hand takes effect the next time its blocker moves.

`⛔` on a line hands kasten the choice between `[ ]` and `[b]` there, and
nothing else. `[/]`, `[x]` and `[-]` are never touched, so a state you set by
hand cannot be destroyed by a blocker changing. A `[b]` carrying no `⛔` means
waiting on something outside the vault and is left alone entirely. Cycling a
dependent from `[b]` to `[ ]` by hand is undone the next time the blocker moves,
which is the intended behaviour: the way to unblock something is to close what
blocks it, or to delete the `⛔`.

Deleting the last `⛔` from a `[b]` line with the pane's `i` opens the line in
the same write, since no blocker is left whose press could open it. The same
deletion typed in the editor leaves the `[b]`, which `<leader>so` clears.

A line may carry several `⛔`, and it opens only when every one of them is
closed. A `⛔` naming an id no note holds changes nothing: an unresolvable
blocker reads as open, so nothing is opened on a guess and nothing is destroyed
by a blocker that has been deleted.

One level per write. If A blocks B and B blocks C, closing A opens B, and C is
opened by the write that closes B rather than by the same pass.

## Waiting on somebody

`[w]` says a todo waits on a person, and `👤` says who and since when:

```markdown
- [w] decision record for the queue #adr 👤 2026-08-03 [[Ada Lovelace]] 📅 2026-08-14
```

The date comes first and is the day the wait began. The name comes after it and
runs to the next field, the next tag or the end of the line. It is free text,
so `the tax office` is a name. A `[[link]]` to
[a person's note](/explanation/people-in-the-vault.md) is the better one: the
link is on the line, so the todo shows on that person's card. Either half may
be missing. A `👤` with nothing after it is not a field and stays in the words.

`W` in the todo pane and `<leader>sw` in the editor set the state and stamp
`👤` with today. A date the line already carries is kept, so setting the state
twice does not restart the wait. kasten cannot know the name, so you type it,
straight after the date. Both places put the cursor there on a waiting line
that names nobody: `i` in the pane opens the line with the cursor after the
date, and `<leader>sw` leaves it on the date's last digit, where `a` appends.
On a line already waiting, `<leader>sw` changes nothing and leaves the cursor
where it was.
From the pane that is `W`, `i`, a space and the name, Enter.

The `👤` is written straight after the words, ahead of every other field, so
that [Obsidian still reads the rest of the line](/reference/todo-format/the-line.md#the-fields).

Leaving the state drops the `👤` whole, the name with the date, whichever key
leaves and wherever it goes. The field says who the todo waits on, and it no
longer waits. `x` on a waiting line goes to doing, as it does on a blocked one.

A `👤` on a line that is not `[w]` is read, carried and written back by every
key, and means nothing until the line is set to waiting. Then its name is kept
and the date is stamped.

`⛔` and `[w]` do not meet. kasten moves a line carrying `⛔` between `[ ]` and
`[b]` only, so a waiting line that also names a blocker stays waiting when the
blocker closes.

The todo pane keeps a waiting row in the group its due date names, drawn muted
as a blocked row is, with the days waited and the name on the row: `👤 7d Ada
Lovelace`. [The todo pane](/reference/editor-keys/todo-pane.md#the-todo-pane) says the
rest.
