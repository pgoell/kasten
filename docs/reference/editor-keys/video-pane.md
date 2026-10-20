---
type: Reference
title: Editor keys, the video pane
description: The video pane and the note's transcript, with the keys that play the player and the captions it writes.
tags: [editor, keyboard, video, transcript, frontend]
status: stable
---

# Videos in the player

## The video pane

`<leader>gv` opens the video the note links and puts it in a new pane under the
note, with the note still on screen. That arrangement is what the pane is for:
the player keeps its place while the note scrolls under your typing, which a
video drawn into the note itself cannot do. For a clip you want where it is
quoted rather than beside the note, see
[In the note itself](#in-the-note-itself) below.

Under and not beside, which is where this parts company with the reader. A book
is a column of text and reads next to a column of notes; a player is a 16:9 box,
and the width it wants is the width the note wants too, so the two share the
height instead.

The links are read out of the note, and the first YouTube address in it is the
one that plays. Every shape the share button writes is understood, `youtu.be/ID`,
`watch?v=ID`, an embed, a short and a livestream, and the address can sit
anywhere in the note: inside a `[](...)`, in the frontmatter, on a line of its
own. A note linking no video draws one sentence saying so rather than an empty
player.

A note may link as many as you like. `n` and `p` in the player step through
them in the note's order, and the header counts, `2/5`. A click or a tap on the
count goes to the next one, as `n` does. A video linked twice is one video, so
stepping cannot land on the same player twice.

A timestamp in the link is dropped. `?t=90` is one more video to open at the
start, because the position the note remembers is where you actually got to.

### In the note itself

`![](https://youtu.be/iDulhoQ2pro)` draws the player where it sits, the way the
same brackets around a vault path draw a picture. Every address shape the pane
reads is read here too, and anything else in the brackets is a picture or the
source it was written as.

It opens at the position the note remembers, so a clip you got halfway through
in the pane picks up where it stopped. It writes none back: `watching:` moves
for the pane's player alone, and an embed you watched to the end still says
where the pane left it.

The line hands its source back when the cursor reaches it, which is the rule
every rendered construct here follows. On this one it costs more than brackets:
the frame goes with the text, so clicking into that line stops the video. The
pane is the answer to that, and `<leader>v` is what stops and starts it without
the cursor going anywhere near.

### Where you got to

The note remembers it, one entry per video:

```yaml
watching: {iDulhoQ2pro: 77, TQQlZhbC5ps: 118}
```

Written whenever the player stops, and read when it opens, so `<leader>gv`
tomorrow starts where you stopped today. Keyed by the video's own id and not by
where the link sits, so reordering the note moves nothing and two lectures in
one note cannot overwrite each other. A video wound back to the start drops out
of the mapping rather than storing a zero.

Flow style, on one line, because the client writes frontmatter a line at a time.
It is ordinary YAML and the backend reads it as the same mapping.

The position takes one of two routes into the note, and which one it takes turns
on where the cursor is. A note in the focused pane is one you may be typing in,
so the position is edited into the buffer and the autosave carries it out with
everything else; it is not added to the undo history, so `u` never takes a
bookmark back. Any other note is written to the vault directly, by the same
guarded write the reader's `reading:` uses, whose whole rule is that it will not
touch the focused pane's note. Neither route can put an unsaved paragraph on the
floor.

A note nobody has open anywhere takes neither. Close the note, leave the player
running, and the position it reaches is lost.

Pressing the key again goes to the pane already playing rather than opening a
second one, so it is its own way back. `<leader>q` closes the player, and
`<leader>k` returns to the note.

### Playing it without leaving the note

`<leader>v` starts and stops the video from wherever you are typing. That is the
rhythm the pane exists for: a sentence goes by, you stop it, you write it down,
you start it again, and the cursor never leaves the note.

The key works because the player is asked rather than clicked. The frame carries
`enablejsapi=1`, which is what makes it answer a `postMessage`, and the pane
sends it `playVideo` or `pauseVideo` across the origin. Nothing about that moves
the focus.

Which of the two it sends is read off the player rather than counted here. The
pane subscribes once the frame is up and YouTube streams its state back, so a
video you paused with a click is still known to be paused, and the next
`<leader>v` starts it rather than stopping it twice.

Pressed with no player open, the key does nothing at all.

A click into the player still hands the keys to YouTube until you click back
into the note, and the blue border stays on the note while it does. A
cross-origin frame tells the page around it nothing, so kasten does not hear the
click. With `<leader>v` there is much less reason to click at all, and reaching
the pane by key rather than by click puts the cursor on the pane itself, which
is why `<leader>q` works there.

YouTube alone, and by name: the policy the app is served under frames the book
reader's own document and this one host, so a note may link anything and only
the player will play. Another host would be another line in that policy, which
is a standing permission to frame you and is worth adding one at a time.

A video pane is not in the URL, the way a book pane is not: `?note=` names the
note in the focused pane, and a player holds none. Moving the note carries the
player with it, the note being what the pane holds.

### Its transcript in the note

`<leader>cv` fetches the captions of the note's video and writes them into the
note, under a `## Transcript` heading at the end, so what was said can be read
and searched. `c` for the group and `v` for the video; not under `v` itself,
because `<leader>v` plays and pauses, and vim runs a finished sequence without
waiting for a longer one.

```markdown
## Transcript

_Captions of `dQw4w9WgXcQ`, in `en`, written by hand._

[00:00] We're no strangers to love. You know the rules and so do I.

[00:31] A full commitment's what I'm thinking of.
```

The line under the heading names the video and the track. A track written by
a person in English is taken first, then YouTube's generated English, then
whatever track the video has. `generated by YouTube` in that line means the
words came from speech recognition and may be wrong.

The captions are joined into paragraphs. A paragraph ends at the first caption
that finishes a sentence once half a minute has passed, and at a minute whether
or not one has; generated captions carry no punctuation, so theirs run a minute
each. Each opens on the time it starts at, `[mm:ss]`, or `[h:mm:ss]` past the
first hour. Entities YouTube leaves in the text, `&#39;` and the like, are
decoded, and a caption that wrapped on screen is one line of prose here.

Pressing it again replaces the section rather than adding a second one: the
`## Transcript` section runs to the next heading at its level or above, and
all of it goes. The whole write is one change, so one `u` takes it back out.

It reads the first video the note links, even when the pane is showing another.
A note linking no video, a video with no captions, and YouTube refusing the
request each say so in the status bar, and leave the note as it was.
