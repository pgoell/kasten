---
type: How-to Guide
title: Install kasten on your phone
description: Put kasten on a phone's home screen, reach the capture page from its icon, and replace the capture app an earlier release installed.
tags: [phone, install, android, ios, capture]
status: stable
---

# Install kasten on your phone

kasten installs as one app. Its icon opens the notebook at `/`. The capture
page at `/capture` is part of the same app: a long press on the icon offers it,
and Android's share sheet opens it.

## If you installed the capture app before

Releases up to 0.36.0 installed the capture page as an app of its own, named
**kasten capture**, with a **k** on its icon. That app does not turn into the
new one. A browser tells installed apps apart by the `id` in the manifest, the
`id` changed from `/capture` to `/`, and the old app ignores a manifest that
carries another `id`. So, one time:

1. Uninstall **kasten capture**: long press its icon and choose **Uninstall**.
2. Install kasten by the steps below.

What changes for you:

* The share sheet entry reads **kasten**, not **kasten capture**.
* There is no separate icon for the dump. A long press on the kasten icon
  offers **Capture**.
* The icon is the card box, and it opens the notebook, not the capture page.

## Install it on Android

1. Open `https://<your-host>/` in Chrome, signed in. Any page of kasten will do.
2. Open Chrome's menu and choose **Add to home screen**, then **Install**.

The icon opens the notebook on its own, without the browser's address bar.

If Chrome offers only a shortcut rather than an install, the manifest did not
load. The site is behind a login gate, and the page asks for the manifest with
its credentials for that reason; behind oauth2-proxy, a session that has run out
gets the sign-in page instead. Reload, sign in again, and try once more.

## Open the capture page from the icon

Long press the kasten icon and choose **Capture**. Drag that entry onto the
home screen if you want an icon that opens the capture page directly.

## On an iPhone

Open `https://<your-host>/` in Safari, tap the share button and choose **Add to
Home Screen**. The icon is named **kasten**. iOS offers no long-press entry and
no share target.

Expect the icon to open the notebook whichever page you added it from: the
manifest names `/` as the start page, and Safari is reported to follow that
over the page on screen. This has not been tried on an iPhone, and Apple
documents neither answer. If you want the capture page, open the icon and go to
`/capture`, or keep `/capture` as a Safari bookmark.

## Related

* [Capture from your phone](/how-to/capture-from-your-phone.md): the capture page, and sharing into it from other apps
