---
type: Reference
title: Exam format
description: The note a practice exam is written in, every part it can carry, the two places an answer goes, what a sitting scores, and where the result note lands.
resource: frontend/src/lib/exam.ts
tags: [vault, exams, format, frontend]
status: stable
---

# Exam format

A practice exam is one note. The note is the whole exam: the questions, the
options and the answers all live in it, so a vault read by Obsidian, by another
editor or by `cat` carries everything an exam has.

Nothing marks a note as an exam. A note holding a question heading with lettered
options under it is one, and a note holding neither is not, the same bargain a
todo line makes. There is no frontmatter field to set and no folder an exam has
to live in.

`<leader>ge` sits the note in the focused pane as an exam. A sitting writes one
new note beside the exam and never writes to the exam itself.

## The smallest exam that works

```markdown
# Terraform drills

### Question 1

Which cast does Terraform refuse?

- A. string to number
- B. list to set
- C. bool to string

Correct: B

A set drops duplicates, so the conversion does not go back.
```

Two rules: a question heading, and lettered options under it. Everything below
is optional.

## The parts

### The title

The note's `#` heading. It names the exam in the pane and in every result note.
A note with no `#` heading reads as `Practice exam`.

### A question

A heading holding the word `Question` or `Q`, at any level from `##` to
`######`:

```markdown
### Question 1.1
### Q7
### Question 2.3 · Multiple response · select TWO
```

The number is how an answer key at the back names the question back. Left off,
questions are numbered by their order, so answers still key apart.

Anything after a `·`, `|`, `:` or `-` is read for `select TWO`, `choose 3` or
`pick two`, which says how many letters the question wants. One where nothing
says. The rest of that text is ignored, so a format note like
`Multiple choice · select ONE` costs nothing.

### The stem

The prose between the heading and the first option. Any length.

### The options

A bulleted list, one letter each. Ten at most, `A` to `J`.

```markdown
- A. plain
- **B.** bold, which is what the Claude exams in the vault write
- C) either bracket
```

A question with no options is not asked. The pane says how many it left out
rather than dropping them in silence.

### The answer

Under the question:

```markdown
Correct: B
Answer: B, D
```

`Correct` and `Answer` mean the same thing, the separator between letters does
not matter, and the prose under it up to the next question or heading is the
rationale.

Or in a key at the back:

```markdown
## Answer Key

**1.1 — Correct: B**

Effective prompts supply the ingredients the model cannot guess.

**1.2 — Correct: B, D**
```

`Answer Key`, `Answers`, `Solutions`, `Key` or `Rationales` opens the key.
Everything after that heading is the key and never a question, which is what
keeps a key that restates its section headings from growing a second run of
them. The dash may be an em-dash or a hyphen and the bold is optional.

An answer written under its question wins over one in the key, on the grounds
that the key is where a stale copy lives.

### A section

Any other heading between questions. Every question under it belongs to it, and
a result note scores each section on its own.

```markdown
## Domain 1: Prompting and Task Execution (14%)
## Type conversion
## Part 3. Networking
```

A leading `Domain`, `Section`, `Topic`, `Part`, `Chapter`, `Module` or `Area`
comes off, a leading number comes off, and a trailing `(14%)` or `(14.7%)` comes
off. All three above are sections and nothing more.

## What is not read

A question whose answer is not a letter. The vault's `ccar-p` exam writes five
scenario-matching questions answered by a sentence of arrows, and there is no
way to ask one of those here. They stay in the note, they are left out of the
sitting, and the pane's footer says how many.

## Sitting one

| Key | What it does |
| --- | --- |
| `A` to `J` | Pick that option, or unpick it. The oldest pick drops out once the question has as many as it wants |
| `l`, `n`, `Enter` | Next question |
| `h`, `p` | Previous question |
| `r` | Show the answer and the rationale for this question, and hide it again |
| `g` | Finish, score the sitting and write the result note |
| `q` | Close the pane |
| `Enter` after `g` | Open the result note |

The leader still works inside the pane, so `<leader>o` and the rest reach the
other panes mid-sitting.

Answers are held in the browser until `g`, so a reload loses a sitting in
progress. Questions come in the note's order; nothing is shuffled.

## The result note

Sitting `02 Projects/Certs/ccao-f-practice-exam.md` writes

```
02 Projects/Certs/ccao-f-practice-exam results/2026-08-11 1432.md
```

holding a link back to the exam, the score, the score per section, and every
missed question with what was answered, what was right and the rationale. One
note per sitting, so the folder becomes the record of how you got better.

A question the note never answered is left out of every count rather than marked
wrong.

## The agent note

Starting the backend writes `99 Misc/01 Config/01 Agents/How-To-Exam.md` into a
vault holding none: this page said to an agent that is about to write you an
exam. It sits beside `How-To-TODO.md` and comes back the next time the backend
starts if you delete it.

## See also

* [Editor keys](editor-keys.md) - every binding, including `<leader>ge`
* [Todo format](todo-format.md) - the other format the vault holds
* [HTTP API](http-api.md) - the endpoints a sitting reads and writes
