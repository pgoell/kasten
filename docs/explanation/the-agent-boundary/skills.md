---
type: Explanation
title: Skills read past the boundary
description: Why a token reads the Claude Code skills in the vault's skills folder and never writes them, why that folder is the one hidden path it reaches, what a skill file may be, and what a leaked token now reads of them.
tags: [agent, tokens, security, skills]
status: stable
---

# Skills read past the boundary

The chat pane runs the skills in `.claude/skills` in the vault, and an outside
agent that follows the same conventions has to read them too. That is what
`list_skills` and `read_skill` are for. This page is why they only read.

## Read, never write

The chat pane starts Claude Code with `bypassPermissions`, so a skill's
instructions run without a question. A written skill would be code that the
trusted shell runs with every permission. A token that could write one would
reach the shell through the skills folder. A token that only reads reaches
nothing it did not already reach.

`read_note`, `list_notes`, `save_note` and `append_note` still refuse every
`.claude` path. The vault-wide rule for dotfiles is unchanged.

## One hidden prefix, never caller-chosen

The skills folder is the one hidden path a token reaches, and only as the
prefix in `KASTEN_SKILLS_PATH`. A caller names a path inside the folder, such
as `triage-inbox/kasten.sh`, and never the prefix itself. The path resolves
with the folder as its base, so `..` cannot climb to `.claude/settings.json`,
the jj repo or `.trash`. A skills folder that is itself a link, even to a
folder inside the vault, lists none and reads none.

## What a skill file may be

A file counts only with one of seven suffixes: `.md`, `.sh`, `.py`, `.json`,
`.yaml`, `.yml` or `.txt`. It must be UTF-8 with no NUL, and at most 256 KiB.
A hidden file inside a skill stays hidden, `.env` for one, and is never listed.
A link, to a file or a folder, that leads out of the skills folder is refused,
the same check a note gets.

## A refusal reads as absent

A refused path answers like a missing one: `404` on REST, and the tool error
"No such skill file" over MCP. A probe learns nothing about what exists, as with
`read_note`.

## What a leaked token reads

Every token holder reads the text of every skill file. Whatever a skill says
reaches them, so a skill should hold nothing that must stay in the box. That is
a question for whoever writes the skill, and the token cannot change it.
