---
type: Reference
---

# How to write a practice exam

For agents writing a practice exam into this vault, whether you run in kasten's
own terminal pane or on a machine outside it.

The vault is a directory of markdown files and it is the source of truth. An
exam is one note, and the note is the whole exam: the questions, the options and
the answers all live in it. Nothing about an exam lives anywhere else, so `rg`,
an editor and `cat` are enough to read or change one.

`<leader>ge` sits the note in the focused pane as an exam. A sitting writes one
new note beside the exam and never touches the exam itself.

## The smallest exam that works

Two rules. A question heading, and lettered options under it.

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

That is a working exam. Everything below is optional.

## The parts

**The title** is the note's `#` heading. It names the exam in the pane and in
every result note.

**A question** opens on a heading holding the word `Question` or `Q`, at any
level from `##` to `######`:

```markdown
### Question 1.1
### Q7
### Question 2.3 · Multiple response · select TWO
```

The number is how an answer key at the back names the question back. Leave it
off and questions are numbered by their order.

Anything after a `·`, `|`, `:` or `-` is read for `select TWO`, `choose 3` or
`pick two`. It says how many letters the question wants. One where nothing says.

**The stem** is the prose between the heading and the first option. Any length.

**The options** are a bulleted list, one letter each:

```markdown
- A. plain
- **B.** bold, which is what this vault's Claude exams write
- C) either bracket
```

Ten at most, `A` to `J`. A question with no options is not asked, and the pane
says how many it left out.

**The answer** goes under the question:

```markdown
Correct: B
Answer: B, D
```

`Correct` and `Answer` are the same word here, the separator between letters
does not matter, and the prose under it up to the next question is the
rationale. `<leader>r` shows both during a sitting.

Or it goes in a key at the back, which is how the four Claude exams in this
vault are written:

```markdown
## Answer Key

**1.1 — Correct: B**

Effective prompts supply the ingredients the model cannot guess.

**1.2 — Correct: B, D**
```

The heading opens the key: `Answer Key`, `Answers`, `Solutions`, `Key` or
`Rationales`. Every heading after it is part of the key and never a question. An
answer written under the question wins over one in the key, so the key is where
a stale copy lives.

**A section** is any other heading between questions. Every question under it
belongs to it, and the result note scores each section on its own:

```markdown
## Domain 1: Prompting and Task Execution (14%)
## Type conversion
## Part 3. Networking
```

A leading `Domain`, `Section`, `Topic`, `Part`, `Chapter`, `Module` or `Area`
comes off, a leading number comes off, and a trailing `(14%)` comes off, so
those three all read as sections and nothing more.

## Scenario matching

A question with no lettered options, but a row of scenarios and one option set
under them, is asked a row at a time:

```markdown
### Question 1.11 · Scenario matching

For each scenario, identify the most appropriate architectural pattern.

- Summarising each inbound support email into a CRM note. → ______
- A monthly compliance report generated through the same five steps every time. → ______
- Investigating a production incident where the path depends on each log query. → ______

Options: single augmented LLM call · fixed workflow · autonomous agent
```

A row is one line. The arrow may be `→` or `->`, and the `Options:` line separates its options with
`·`, `|` or `;`, ten at most. Each row becomes its own question over that set,
lettered in the order the line writes them and numbered under the question,
`1.11.1` to `1.11.3` above, carrying the instruction over the rows with it.

The answer names each row by its position:

```markdown
1.11 — 1 → single augmented LLM call; 2 → fixed workflow; 3 → autonomous agent
```

Under the question as `Answer: 1 → …` or in the key at the back as above. The
text has to name one of the options; case, spacing and a closing full stop do
not count. Write one option as the answer to two rows where that is the truth,
because every row is scored on its own.

## What is not read

A question heading with neither lettered options nor a row of scenarios under
it. It stays in the note, it is left out of the sitting, and the pane says how
many.

## Where a sitting goes

Taking `02 Projects/Certs/ccao-f-practice-exam.md` writes

```
02 Projects/Certs/ccao-f-practice-exam results/2026-08-11 1432.md
```

holding the score, the score per section, and every missed question with what
was answered, what was right, and the rationale. One note per sitting, so the
folder is a record of how you got better. The exam note is never written to.

## Writing one

Write the markdown. There is no API for making an exam, no frontmatter to add
and no folder it has to live in: a note anywhere in the vault that holds a
question heading and lettered options is an exam, and one that does not is not.

Two things are never yours to write: the `---` block at the top of a note, which
kasten keeps in step, and the `.jj` directory beside the notes.

## Reading one

From the vault root:

```sh
rg -n '^#+ (Question|Q)\b'          # every question in the vault, with its note
rg -ln '^#+ (Question|Q)[ .]'       # every note that is an exam
rg -n 'Correct:|Answer:'            # every answer
```
