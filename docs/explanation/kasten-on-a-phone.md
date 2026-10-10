---
type: Explanation
title: kasten on a phone
description: Why vim is off under a finger, why a split draws one pane, why a tap raises no keyboard, why the toolbar stays above the keyboard, why a todo takes two taps and has no Undo, why kasten installs as one app, and what no real phone has confirmed.
tags: [design, phone, touch, vim, keyboard, frontend]
status: stable
---

# kasten on a phone

kasten was built for a keyboard: every command is a key, and the frame assumes
a wide screen. A phone has neither. What follows are the choices made to close
that gap, each with the option it was picked over.
[Editor keys](/reference/editor-keys.md#touch) states what is there, and
[Use kasten on a phone](/how-to/use-kasten-on-a-phone.md) is the recipe.

## Two questions, not one

Nothing in the app asks "is this a phone?". It asks whether the window is
narrow and whether the primary pointer is a finger, and each feature reads the
one it depends on. The two come apart too often to merge. A desktop window
dragged thin wants the small layout and still has its keyboard and mouse. A
tablet is wide and has neither. A rule written for "phones" would be wrong for
both.

So the layout follows the width, and the controls follow the pointer. A thin
desktop window gets the drawer and the single pane and keeps vim and its small
rows. A tablet gets big rows, a plain editor and the terminal's key row, and
keeps the tree beside the note. The toolbar needs both, as it stands in for
the leader key where there is no key and no room.

## Vim is off under a finger

An on-screen keyboard has no Escape, so there is no way out of insert mode. And
normal mode takes the first tap of every edit: a finger lands in the text to
type there, and the keys it then presses run as commands. Vim under a finger is
a trap, so the editor starts without it.

The test is the primary pointer and nothing else. A keyboard is not a pointer,
so an iPad in a keyboard case still answers coarse and starts without vim,
though it has an Escape key. That is the wrong guess for that device, and the
app has no dependable way to make a better one: a browser does not say whether
a keyboard is attached. The answer is the toggle. A choice made by hand is stored and from
then on wins over the pointer, so the iPad's owner turns vim on one time.

The toggle is a row of the command palette and has no leader key. A leader
sequence is a vim mapping, and one that turned vim off could not turn it back
on.

What the editor shows without a mode to go by is in
[Live preview and the vim mode](/explanation/live-preview.md#the-mode-decides-not-the-cursor).

## A split draws one pane

Two panes side by side on a phone are two columns of under 200px, and neither
shows a note. Splits are not only made by hand, either: the book, the video,
the graph around a note and the person card each open in a pane beside the
note. So a narrow window draws the focused pane alone.

The layout itself is left as it is. The window draws through the same path
`<leader>z` uses for a zoom, and the tree of splits is kept, so the panes are
back side by side when the window widens, as when a phone is turned on its
side.

It is not called a zoom, though. A zoom is a mode somebody turned on, and the
footer says so. Nobody asked for this one, so the footer counts instead:
`pane 1/2` tells you there is a pane you cannot see, which `zoom` would not.

This follows the width alone. A thin desktop window has the same two useless
columns.

## A tap raises no keyboard

At a desk, the app hands an editor the focus whenever a pane is moved to or a
note is opened, and that is right: whoever pressed the key goes on typing. On a
phone the focus is what raises the on-screen keyboard, and the keyboard takes
half the screen. A tap that opened a note from the finder asked to read it. A
tap on the text is the one that asks to type.

So the question is put to the last input, not to the device. After a key, the
editor takes the focus as before. After a touch, it does not. A tablet with a
keyboard attached answers both ways within a minute, and gets the right result
each time.

A page that has just loaded has had no input at all, and there the pointer
answers: a coarse pointer counts as a touch. An editor focused on load would
otherwise be the opener every panel hands the focus back to when it closes,
keyboard and all.

The rule holds in a narrow window only, and the reason is where the focus rests
otherwise. On a phone the tree is a drawer that shuts as the note opens, so the
focus falls to the page and a stray key does nothing. On a wide touch screen
the tree stays open beside the note, with the focus on the row just tapped. The
next keys typed would be the tree's, and `d` there deletes the row. Giving the
editor the focus is the safer of the two, and a wide screen has room for a
keyboard.

A terminal is left out of the rule: a shell is for typing.

## The toolbar stays above the keyboard

The toolbar could hide while something is being typed into, and give its 44px
back to the note. It stays. The palette lists a
note's inserts and edits only when it opens over that note's editor, which is
while the keyboard is up. A toolbar hidden then would be gone at the one moment
`run` has the most to offer, and with vim off there is no other way to the
palette from a note but typing `/`.

For the same reason a tap on a toolbar button does not take the focus. The
palette finds the editor it opens over by asking what holds the focus. A button
that took the focus would open a palette with no note behind it, and the
keyboard would fold away under the finger.

Keeping the toolbar in sight takes work on iOS. Chrome on Android shrinks the page
when the keyboard opens, which the viewport meta asks for, and everything moves
up with it. Safari covers the page and tells only `window.visualViewport`. So
the frame of the page measures what is covered and pads it away, and the panes,
the footer and the toolbar all end at the top of the keyboard. One reader does
this for the whole frame. A second one inside a pane would measure after the
first had made room, and find nothing covered.

Inputs are 16px under a finger because Safari zooms the page when a smaller
input takes the focus, and stays zoomed. The editor's own text is smaller, so
the frame also pads under a zoomed page: a zoom read as "no keyboard" would
turn the padding off until a pinch.

## A write asks first

A finger is less exact than a mouse, and a tap on a todo's state symbol writes
to the vault. So the button asks: the first tap shows the state the todo would
move to, and the second one writes. The same holds for whatever else a stray
tap could not take back: the exam's `finish` and `close`, the image pane's
`delete`, and a hollow ring in the graph, where a tap would make a note.

The keys ask nothing, anywhere. Nobody presses `x` by brushing past it.

A state picked from the `⋯` strip under a todo is set on one tap. Opening the
strip and then choosing `done` by name is already two deliberate moves.

### Why not an Undo

An earlier round did it the other way: the tap wrote at once, and an `Undo`
appeared after it. It was removed. To put a todo back, the Undo had to write to
the line the cycle had just written, and it could not confirm which line that
was. The vault decides what a cycle writes, and the browser cannot know it
ahead: a recurring todo, for one, gains a copy above it when it is ticked. So
the Undo guessed, and an Undo that guesses wrong writes to the wrong line. The
guards built round the guess (a read to confirm, a chain of writes, a check of
the text) cost the keys a fast second press.

A question before the write needs to know nothing about what the write will do.

## A panel closes on the release

A tap outside a panel closes it, and it closes when the finger lifts, not when
it lands. A panel gone on the press leaves the rest of the tap to whatever lay
under it, and a todo's state button is one such thing. Both ends of the press
have to be outside as well, so a selection dragged out of the input and let go
over the page closes nothing.

A prompt that holds typed text ignores the tap. The gutter beside a prompt is
19px on a phone, and a stray tap there would throw the draft away.

## One app, not two

kasten installs as one app. Its manifest names `/` as `id`, `start_url` and
`scope`, and the capture page at `/capture` is a shortcut and a share target
inside it. [Install kasten on your phone](/how-to/install-on-your-phone.md) has
the steps.

Before that, the capture page was an app of its own, and the first plan was to
keep it and add a second app for the notebook beside it. Two things ruled that
out.

Nested scopes block each other on Android. The notebook's scope is `/`, and
`/capture` lies inside it. With the notebook installed, Chrome refuses to
install an app that starts at `/capture`, as an installed app already handles
that address. With the capture app installed, Chrome's menu on `/` offers to
open it where it should offer to install the notebook. And a link to `/capture`
from another app matches both, with no rule that the narrower scope wins.

The second reason is that one `index.html` serves every route. The capture
page's manifest could only have been linked by script after the page loaded,
and an installed app's update check reads the manifest when the page stops
loading. A check that ran first would have seen the notebook's manifest, with
another `id`, and dropped the update.

The cost falls on anyone who installed the capture app before: a browser tells
apps apart by `id`, the `id` changed, and the old app never becomes the new
one.

## What no real phone has confirmed

All of this was built and checked in Chrome's device emulation, at 390x844 with
touch. No part of it has run on a phone. Emulation shows no on-screen keyboard
and sends no real finger, so these are reasoned from the code and from unit
tests with a stubbed viewport, and not seen:

* That the frame ends at the top of a real keyboard, on iOS Safari and on
  Android Chrome, and that Safari panning the page under the keyboard does not
  push the top of a panel off screen. The padding under a zoomed page is in the
  same state.
* That a tap on `pane`, a tree row or a finder row raises no keyboard, and
  that a tap on a terminal does.
* That Safari leaves the page unzoomed on the focus of a 16px input.
* That a finger closes a panel as a mouse click does. The check used clicks.
* In a book: that a tap inside the page ends in a click, that `Take` holds a
  selection the tap collapses, and that a long-press selection shows `Take` at
  all. A right-to-left book was never opened.
* That an exam pane takes the keys back after a tap, on a touch device with a
  keyboard.
* What a tablet answers for the pointer with a trackpad or a mouse attached,
  and so whether it then starts with vim.
* Firefox and Safari, on any device.
* The install. That Chrome refuses nested scopes as described is read from
  Chromium's source, not tried. Unseen too: that an old capture app stays as it
  is, that the share sheet entry and the long-press shortcut appear, and which
  page an iPhone's home screen icon opens.
