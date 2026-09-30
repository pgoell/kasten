---
type: How-to Guide
title: Capture from your phone
description: Put the capture page on a phone's home screen and share links and text into today's dump from other apps.
tags: [capture, phone, dump, daily, share]
status: stable
---

# Capture from your phone

You have a thought away from the desk and want it in today's `## Dump`, the
section the end of the day is planned from. `/capture` is a page for that: a
box, a Send button and today's date. Each send lands as a paragraph at the end
of the dump in today's daily note, which is made if the day has none yet.

## Open the page

Go to `https://kasten.pgoell.com/capture` in the phone's browser and sign in the
way you do on the desktop. The page keeps the last few sends under the button,
which is how you know they landed. That list lives in the page and goes when you
close it; the dump itself is in the daily note.

## Install it on Android

1. Open `/capture` in Chrome, signed in.
2. Open Chrome's menu and choose **Add to home screen**, then **Install**.

The icon opens the page on its own, without the browser's address bar. Install
from `/capture` itself, the page the manifest names as the app.

If Chrome offers only a shortcut rather than an install, the manifest did not
load. The site is behind oauth2-proxy, and the page asks for the manifest with
its cookies for that reason; a session that has run out gets the sign-in page
instead. Reload `/capture`, sign in again, and try once more.

## Share into it

Once it is installed, **kasten capture** appears in Android's share sheet.

1. In any app, share a page, a link or a piece of text.
2. Pick **kasten capture**.
3. The page opens with what was shared in the box: the title on the first line,
   then the text, then the address. Edit it if you like.
4. Press **Send** to put it in the dump.

When what was shared holds a web address, a second button appears beside Send:
**Clip to inbox**. It reads the page and files it in `00 Inbox` as a note, the
same import `<leader>cw` runs at the desk, and puts nothing in the dump. A page
clipped twice opens as one note, not two.

## On an iPhone

iOS has no share target for a web page, so kasten does not appear in the share
sheet. You can still put the page on the home screen: open `/capture` in Safari,
tap the share button and choose **Add to Home Screen**. To send something from
another app, copy it, open the icon and paste.

## At the desk

`<leader>cd` opens the same capture as a one-line prompt over whatever you are
doing, described in [Editor keys](/reference/editor-keys.md#capturing-into-todays-dump).

## Related

* [HTTP API](/reference/http-api.md#post-apidump) - where in the note each capture lands
* [Agent API](/reference/agent-api.md#post-agentdump) - the same capture for an agent, as a tool or a route
