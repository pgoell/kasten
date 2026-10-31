---
type: Reference
title: Editor keys, the video pane
description: The video pane, its header and chapters, the shield over the player, the video view with the transcript, the takes written from it, the keys that play the player, and the captions it writes.
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
height instead. Where you want them side by side, `<leader>L` from the player
moves it to the right edge, and it plays on through the move: see
[Panes and tabs](/reference/editor-keys/panes-and-tabs.md).

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

It opens at the position the note remembers, and writes its own back when you
pause it, into the same `watching:` entry the pane writes. So a clip you got
halfway through in the pane picks up there in the note, and the other way round.
The note's player writes into its own buffer, as the pane does for the focused
note, and never from a read-only preview.

Scrolled out of view and back, it is the same player, still playing or still
paused. The player lies over the note rather than in it: CodeMirror drops a
line's drawing once it leaves the screen, and a frame dropped with it would stop
and load again on the way back.

The line hands its source back when the cursor reaches it, which is the rule
every rendered construct here follows. The player hides while the source shows
and keeps playing; moving the cursor off brings the same player back. Deleting
the link ends it.

### Where you got to

The note remembers it, one entry per video:

```yaml
watching: {iDulhoQ2pro: 77, TQQlZhbC5ps: 118}
```

Written whenever the player stops, and read when it opens, so `<leader>gv`
tomorrow starts where you stopped today. Keyed by the video's own id and not by
where the link sits, so reordering the note moves nothing and two lectures in
one note cannot overwrite each other. A video wound back to the start, or played
to its end, drops out of the mapping rather than storing a zero, so it opens at
the start next time.

Only the linked video writes its entry. A player that moves on to another video,
such as a suggestion picked on YouTube's end screen, writes nothing while it
plays that one, in the pane or in the note, and closing the pane then writes
nothing either. Back on the linked video, it writes again.

### Speed, captions and volume

Every player, in the pane or in a note, takes the speed, captions and volume you
last used in this browser. They are kept in `localStorage` under `kasten.video.1`,
`{"rate": 1.5, "captions": true, "volume": 60, "muted": false}`, and not in the
vault, so each browser keeps its own. A value kept before the volume was added
reads as before, with the player's own volume. A speed, a volume and a mute are
set on the player once it reports ready; captions open the player with
`cc_load_policy=1`. Captions are read off what the player reports when its
caption track changes. The volume is kept only from the pane's keys and its
`Mute` button, never from what a player reports.

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

A click on the shield moves the focus to the pane before the player reports its
stop, so that stop takes the second route, straight to the vault.

A note nobody has open anywhere takes neither. Close the note, leave the player
running, and the position it reaches is lost.

Pressing the key again goes to the pane already playing rather than opening a
second one, so it is its own way back. `<leader>q` closes the player, and
`<leader>k` returns to the note.

### Playing it without leaving the note

`<leader>v` starts and stops the video from wherever you are typing. That is the
rhythm the pane exists for: a sentence goes by, you stop it, you write it down,
you start it again, and the cursor never leaves the note.

It works from any pane, not only the note's. The player it means is the focused
video pane, if you are in one. Failing that, it is the pane playing the focused
note's video, and failing that, the first video pane in the tab. With no video
pane in the tab, it does nothing.

The key works because the player is asked rather than clicked. The frame carries
`enablejsapi=1`, which is what makes it answer a `postMessage`, and the pane
sends it `playVideo` or `pauseVideo` across the origin. Nothing about that moves
the focus.

Which of the two it sends is read off the player rather than counted here. The
pane subscribes once the frame is up and YouTube streams its state back, so a
video you paused with a click is still known to be paused, and the next
`<leader>v` starts it rather than stopping it twice.

Pressed with no player open, the key does nothing at all.

A click on the player does not reach it. The shield covers the frame and takes
the click, so the keys stay with the pane and `<leader>q` works after a click
there. With `<leader>v` there is much less reason to click at all, and reaching
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

## The header

The header reads, left to right: `VIDEO`, the video's address in mono, then the
count, `2/5`, when the note links more than one video. A click or a tap on the
count goes to the next one and wraps, as `n` does. The count is not there for a
note with one video. Then `Video view`, `Mute`, `Full screen` and `Open on YouTube`.

`Mute` mutes the player, and reads `Unmute` while it is muted; a tap brings back
the volume from before. It is the touch way to the sound, since the shield
covers YouTube's own slider. A phone sets the level with its own volume keys, and
some phone browsers ignore a level the page sets, iOS Safari among them.

`Open on YouTube` opens the watch address at the second the player is at, in a
new tab.

## Title, speaker and chapters

Under the player are the video's title and its speaker.

The title is the one the player reports for the video. Until the player has
reported one, the title is the note's name.

The speaker is the note's `speaker:` field, with link brackets and quotes taken
off it. A note without one shows the channel the player names.

The chapters come from the note's `## Chapters` section, which runs to the next
heading at its level or above. A line is a chapter when it starts with a time
and has a title after it. The time may be `[mm:ss]`, `mm:ss`, `0:00` or `h:mm:ss`. A list marker in front is allowed, and so is a colon,
a dash with spaces, or spaces between the time and the title. So a description
pasted from YouTube works as it is. A line with no title is skipped.

```markdown
## Chapters

- 0:00 Intro
- 2:14 The first problem
[10:05] Wrap-up
```

The chapter the player is in has an accent bar and `aria-current`. A click on a
chapter seeks to it, and the cursor goes back to the pane.

One line under the details says where your place is kept: the note's `watching`
field, written when you pause.

## The shield

A transparent button covers the player. A click or a tap on it plays or pauses
the video, through the player's own API, the way `k` does. The press takes the
focus to the pane, so Space and the leader keep working after it.

While the video is paused, a play circle shows in the middle of the player. After
a short hover, a hint reads `Click to play or pause, or press k`. Touch screens
do not get the hint.

The shield covers YouTube's own controls as well, so the progress bar and the
full-screen button under it are out of reach. The pane has a full-screen button
of its own instead: see [Full screen](#full-screen).

## Full screen

`Full screen` in the header, or `f` over the pane, makes the player box full
screen: the frame with the shield over it. So a click or a tap on the player
still plays or pauses, and `k`, `j`, `l`, `n`, `p`, the arrow keys and `m`
still work, since the focus moves into the box. Full screen draws no `Mute`
button: the player keeps only the way out over it.

Esc leaves full screen, as it does anywhere in a browser. So do `f` again and
the `Exit full screen` button in the top corner of the player, which is there
only while the player is full screen. That button is the way out on a phone,
which has no Esc.

Space still starts the leader in full screen, but the which-key panel does not
show: it sits outside the box, so the browser hides it. A sequence typed blind
leaves full screen first and then runs, so whatever it opens or moves to is on
screen. Esc after Space drops the waiting leader along with full screen.

Where the browser cannot put a box full screen, as Safari on an iPhone cannot,
the button is not drawn and `f` does nothing. A browser that refuses the request
leaves the pane as it was.

Nothing starts the video on its own. The frame is given `autoplay` so that a tap
on the shield can start it, and the address carries no `autoplay=1`.

## The video view

`Video view` in the header switches the pane's layout. The player is the same
frame in both layouts, so it keeps its place when the view changes.

On the left are the player, the title, the speaker and the chapters, then
`Taken from this video`: the takes of this video in the note, each with its time
as a button and its quote, two lines at most. Takes of other videos in the note
are left out.

On the right is the transcript, the `## Transcript` paragraphs. On a narrow pane
the two stack, the player and its column above the transcript. The width of the
pane decides, not the width of the window, so `<leader>L` from a video view under
a note gives the note one side and the stacked view the other.

The transcript marks the paragraph the video is in and scrolls it to a third of
the way down its list. Only the transcript moves, never the page. `Follows the
video` turns that off, and on again. Each paragraph opens with its time as a
button, and a press seeks the video there. A note with no transcript says so,
and says that `Space c v` writes one.

## Take

Select words in the transcript. A `Take` button appears at the selection and
reads `at mm:ss`, the time of the paragraph the selection starts in. A selection
made backwards starts at its other end. On a touch screen the button sits under
the words. A click on it, or `y` in the video view, writes the take.

The take goes into the video's note, under `## Highlights`, in the book's
highlight format. It has no chapter words. Its anchor line is a time link to that
second in the video, then the anchor:

```markdown
## Highlights

> We're no strangers to love.

[00:31](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=31s) ^hl-a3f9c1
```

The quote is escaped the way a book's passage is. The highlight format page has
the whole rule: [Highlight format](/reference/highlight-format.md#a-take-from-a-video).

The toast reads `Taken into the video's note` and shows for five seconds, with
`Undo` and `Put it in a note`. Undo takes the take out of the note. If the note
has changed since the take, Undo writes nothing and the toast says so:
`The video's note changed since, so Undo left it as it is`.

## Keys over the pane

With the leader closed, the pane answers these keys. They are bare letters, the
way `n` and `p` are, because the pane has nothing else to type into:

* `k` plays or pauses.
* `j` and `l` seek ten seconds back and on, from the second the pane holds.
* `y` takes the selected transcript into the note. It works only in the video
  view and only with words selected. With no selection, the key goes to the
  browser.
* `n` and `p` play the note's next and previous video, and wrap at either end.
* `f` puts the player in full screen, and takes it out again. See
  [Full screen](#full-screen).
* `ArrowUp` and `ArrowDown` turn the volume up and down by 5, within the
  player's 0 to 100, as on YouTube. Pressed while muted, they unmute.
* `m` mutes, and unmutes at the volume from before. See
  [Speed, captions and volume](#speed-captions-and-volume).

With two panes, the keys move only the focused pane's player, from the volume
this browser last kept. `n`, `p` and a suggested video the player moves on to
keep the volume.

`k`, `j`, `l`, `f`, the arrow keys and `m` do nothing until a video is in the frame. The key help lists
these under `Over a video`.

## Time buttons in a note

In a note that links a video, a time in the text is a button, off the cursor's
line. These are the times it draws:

* A transcript's `[mm:ss]` or `[h:mm:ss]` at the start of a paragraph.
* A take's time link, `[mm:ss](https://www.youtube.com/watch?v=ID&t=754s)`,
  when its video is one the note links. A take at the first second has no
  `&t=`, so its link stays a link.

A press seeks the player that is playing this note's video. If no player is
open for the note in the tab on screen, the status bar says
`No player is open for this note: Space g v opens it`.

The cursor on the line shows the source, as it does for any link. The button
stands in for the source everywhere else.
