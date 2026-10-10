---
type: How-to Guide
title: Capture from your phone
description: Send a thought into today's dump from a phone, and share links and text into it from other apps.
tags: [capture, phone, dump, daily, share]
status: stable
---

# Capture from your phone

You have a thought away from the desk and want it in today's `## Dump`, the
section the end of the day is planned from. `/capture` is a page for that: a
box, a Send button and today's date. Each send lands as a paragraph at the end
of the dump in today's daily note, which is made if the day has none yet.

## Open the page

Go to `https://<your-host>/capture` in the phone's browser and sign in the
way you do on the desktop. The page keeps the last few sends under the button,
which is how you know they landed. That list lives in the page and goes when you
close it; the dump itself is in the daily note.

## Put it on the home screen

The capture page is part of the kasten app.
[Install kasten on your phone](/how-to/install-on-your-phone.md), then long
press the kasten icon and choose **Capture**.

## Share into it

Once kasten is installed, **kasten** appears in Android's share sheet.

1. In any app, share a page, a link or a piece of text.
2. Pick **kasten**.
3. The capture page opens with what was shared in the box: the title on the first line,
   then the text, then the address. Edit it if you like.
4. Press **Send** to put it in the dump.

When what was shared holds a web address, a second button appears beside Send:
**Clip to inbox**. It reads the page and files it in the inbox as a note, the
same import `<leader>cw` runs at the desk, and puts nothing in the dump. A page
clipped twice opens as one note, not two.

## On an iPhone

iOS has no share target for a web page, so kasten does not appear in the share
sheet, and its home screen icon has no long-press entry. An icon added from
`/capture` is likely to open the notebook, not this page:
[Install kasten on your phone](/how-to/install-on-your-phone.md#on-an-iphone)
says why. To send something from another app, copy it, open `/capture` and paste.

## At the desk

`<leader>cd` opens the same capture as a one-line prompt over whatever you are
doing, described in [Editor keys](/reference/editor-keys.md#capturing-into-todays-dump).

## Related

* [Install kasten on your phone](/how-to/install-on-your-phone.md): the install itself, and the one-time step after an earlier capture app
* [HTTP API](/reference/http-api.md#post-apidump): where in the note each capture lands
* [Agent API](/reference/agent-api.md#post-agentdump): the same capture for an agent, as a tool or a route
