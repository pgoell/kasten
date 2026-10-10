---
type: How-to Guide
title: Install kasten on your phone
description: Put the whole notebook on a phone's home screen, and what Android does when the capture page is installed beside it.
tags: [phone, install, android, ios, capture]
status: stable
---

# Install kasten on your phone

kasten offers a phone two apps from one address. **kasten** is the whole
notebook and opens at `/`. **kasten capture** is the one box at `/capture`, and
the only one of the two that appears in Android's share sheet. Each page names
the app it belongs to, so what a browser installs depends on the page you are on.

## Install it on Android

1. Open `https://<your-host>/` in Chrome, signed in.
2. Open Chrome's menu and choose **Add to home screen**, then **Install**.

The icon is the card box, and it opens the notebook without the browser's
address bar.

### Both apps on one phone

The two apps get in each other's way at install time, because the notebook's
app covers every address on the host, `/capture` among them. What follows is
read from Chrome's source and has not been tried on a phone.

* **With the notebook installed**, Chrome offers no install on `/capture`: it
  refuses an app whose start page an installed app already covers.
* **With the capture app installed**, Chrome's menu on `/` says **Open app**
  where **Install** was, because the menu looks at the host and not at the
  page. Chrome's own install prompt, the one it raises by itself at the foot of
  a page, is still allowed on `/`, since the capture app covers `/capture`
  alone. kasten has no install button of its own to raise it with.

So the order with a chance of both is capture first, by
[its own steps](/how-to/capture-from-your-phone.md#install-it-on-android), then
the notebook through Chrome's prompt when it appears. If the notebook is
already installed and you want the capture app, uninstall the notebook first.
If you want one app, the notebook holds `/capture` too, but only the capture
app is in the share sheet.

### With both installed

* The share sheet shows **kasten capture** as before. The notebook has no share
  target and does not appear there.
* A link to `/capture` tapped in another app can open in either app, or in
  Chrome: both apps claim that address, and Android or Chrome picks. A link to
  any other address on the host can only reach the notebook.
* `/capture` opened inside the notebook stays inside the notebook. Leaving
  `/capture` inside the capture app shows Chrome's address bar over the page,
  the sign that the page is outside that app.

## On an iPhone

Open `https://<your-host>/` in Safari, tap the share button and choose **Add to
Home Screen**. The icon is named **kasten**. The capture page installs the same
way from `/capture`, as **dump**, and the order does not matter.

## Related

* [Capture from your phone](/how-to/capture-from-your-phone.md): the capture app and its share target
