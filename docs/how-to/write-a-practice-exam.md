---
type: How-to Guide
title: Write a practice exam
description: Put a set of questions in the vault so kasten can ask them one at a time, score the sitting and keep a record of what you got wrong.
resource: docs/reference/exam-format.md
tags: [vault, exams, how-to]
status: stable
---

# Write a practice exam

You have a set of questions, from a study guide, an exam blueprint or your own
notes, and you want kasten to ask them one at a time and tell you how you did.

This shows the shortest path. [Exam format](/reference/exam-format.md) states
every part an exam note can carry.

## 1. Make a note

Anywhere in the vault. `<leader>cf`, then a path:

```
02 Projects/Terraform/associate-drills.md
```

No folder is special and no frontmatter field marks an exam. What makes this an
exam is what you write in it.

## 2. Write the first question

```markdown
# Terraform associate drills

### Question 1

Which cast does Terraform refuse?

- A. string to number
- B. list to set
- C. bool to string

Correct: B

A set drops duplicates, so the conversion does not go back.
```

A `### Question` heading, the question, lettered options, then the answer. The
prose under `Correct:` is the rationale, and `r` shows it during a sitting.

## 3. Sit it

`<leader>ge` turns the focused pane into the exam.

Press `B`. Press `g` to finish. The pane shows the score and the footer says
where the result went.

## 4. Add the rest

Group them under headings and each heading is scored on its own:

```markdown
## Type conversion

### Question 1

...

## State and backends

### Question 2

Which backend supports state locking without extra configuration?

- A. local
- B. s3
- C. consul

Correct: C
```

Ask for more than one letter where the question wants more than one:

```markdown
### Question 3 · select TWO

Which TWO are valid for_each collections?

- A. a list
- B. a set
- C. a map

Answer: B, C
```

## Have an agent write one

The vault carries the format as a note, so an agent in a terminal pane or on
your laptop can read it without being told:

```
Read 99 Misc/01 Config/01 Agents/How-To-Exam.md, then turn my notes in
02 Projects/Terraform/ into a 40 question practice exam at
02 Projects/Terraform/associate-drills.md.
```

## Where the results go

Sitting `02 Projects/Terraform/associate-drills.md` writes

```
02 Projects/Terraform/associate-drills results/2026-08-11 1432.md
```

holding the score, the score per section, and every missed question with the
rationale. One note per sitting, so sitting the same exam next week puts the two
side by side.

## Read an answer key that is already at the back

A set of questions written with its answers collected at the end works
unchanged, as long as the key opens on a heading and names each question by its
number:

```markdown
## Answer Key

**1.1 — Correct: B**

Effective prompts supply the ingredients the model cannot guess.
```

That is how the four Claude certification exams in the vault are written, and
none of them was edited to be read.

## Related

* [Exam format](/reference/exam-format.md) - every part in full
* [Editor keys](/reference/editor-keys.md) - the keys a sitting uses
