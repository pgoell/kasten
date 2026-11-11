---
type: Reference
title: Exercise page
description: How an exercise note reads as a page of its own, the frontmatter it takes that from, the video and the hosts it plays, the muscle map and its groups, the history beside it, and the tabs on a phone.
resource: frontend/src/lib/log/training/exercise/exercise-card.ts
tags: [vault, training, frontend]
status: draft
---

# Exercise page

An exercise note, as the [exercise import](/reference/training/exercise-import.md)
writes it, reads as a page of its own once its `kind` is set. A card sits under
the title: the video on top, then the muscle map, and beside it the history.
The note's body, the cues and `## Meine Notizen`, stays below the card as text
you edit.

## What makes a page

| Field | The page takes |
| --- | --- |
| `kind` | `strength`, `cardio`, `mobility` or `test`, in any case; any other value, or none, and the note shows no card |
| `muscles_primary` | the groups painted in the accent colour |
| `muscles_secondary` | the groups painted in a faint accent; one named as primary too stays primary |
| `video` | the video the card plays |

A list may be in flow style, `[chest, triceps]`, or one `- chest` line per
group under its key. The exercise the history follows is the note's file name,
the name a training line links.

## The video

| `video` holds | The card shows |
| --- | --- |
| a YouTube link, any shape the [video pane](/reference/editor-keys/video-pane.md) reads | YouTube's player from `www.youtube-nocookie.com` |
| an `https://` link to an `.mp4`, `.webm`, `.mov` or `.m4v` file | the browser's own player |
| anything else, or nothing | no video |

The app's content security policy lets the player frame
`www.youtube-nocookie.com` and plays files from `wger.de`, where the imported
notes link their videos. A file on any other host is refused by the browser and
the player stays empty.
[The security model](/explanation/security-model.md#the-two-sites-a-page-may-load-video-from)
says why these two and how to add one.

Typing in the body leaves the video playing; a change to one of the four fields
draws the card again.

## The muscle map

A body from the front and from the back, flat polygons from
[react-body-highlighter](https://github.com/giavinh79/react-body-highlighter)
(MIT). Each group in the
[fixed set](/reference/training/exercise-import.md#muscle-groups) is one or
more of its parts. The head and knees are drawn but belong to no group, and
`calves` paints the soleus on the back as well. A group the set does not hold
paints nothing. Under the figures, the groups are spelled out, `primary: chest
· secondary: triceps, front deltoids`, which is also what a screen reader
hears.

## The history

The card reads a year of training lines, from
[`GET /api/training`](/reference/http-api/log.md#get-apitraining), and the
block notes, from
[`GET /api/training/blocks`](/reference/http-api/log.md#get-apitrainingblocks).

| Part | Shows | For |
| --- | --- | --- |
| Estimated 1RM | the best e1RM of each of the last 26 weeks as a line, its latest value in the heading | `strength` |
| Records | the heaviest set, the most reps at one weight, the most kg in a session | `strength` |
| Last sets | the last five days that hold the exercise: sets as `80 kg · 8 8 7`, cardio as `32 min · 5 km` | every kind |
| In blocks | each block note whose sessions or cardio name the exercise, newest first, `Block 2026-11 Grundlage · session A` | every kind |

A line under two weeks says so; an exercise never logged says `Not logged yet.`

## On a phone

Under 560 px of pane, the video stays on top and three tabs follow: Muscles,
Cues and History. Muscles and History show their part of the card. Cues folds
the card down to the video, so the note's body follows it.
