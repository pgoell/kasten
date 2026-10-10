---
type: How-to Guide
title: Install kasten on your phone
description: Put the whole notebook on a phone's home screen, beside or instead of the capture page, and install the two in the order Android allows.
tags: [phone, install, android, ios, capture]
status: stable
---

# Install kasten on your phone

kasten offers a phone two apps from one address. **kasten** is the whole
notebook and opens at `/`. **kasten capture** is the one box at `/capture`, and
the only one of the two that appears in Android's share sheet. Each page names
the app it belongs to, so what a browser installs depends on the page you are on.

## Install it on Android

1. If you want the capture app too and do not have it yet, install it first:
   [Capture from your phone](/how-to/capture-from-your-phone.md#install-it-on-android).
2. Open `https://<your-host>/` in Chrome, signed in.
3. Open Chrome's menu and choose **Add to home screen**, then **Install**.

The icon is the card box, and it opens the notebook without the browser's
address bar.

### Why capture goes first

The notebook's app covers every address on the host, `/capture` among them.
Chrome on Android refuses to install an app whose start page an installed app
already covers, so with the notebook installed, `/capture` no longer offers an
install. The other order works: the capture app covers `/capture` alone, which
leaves `/` free.

If the notebook is already installed and you want the capture app, uninstall
the notebook, install capture, then install the notebook again.

Chrome's menu may also answer **Open app** on `/` when the capture app is
installed, since the menu looks at the host and not at the page. If it does,
there is no other way in from the menu, and the notebook stays a browser tab or
a plain shortcut.

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
* [Reverse-proxy routes](/reference/reverse-proxy-routes.md): why the manifest needs the session behind a login gate
