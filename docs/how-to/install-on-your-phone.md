---
type: How-to Guide
title: Install kasten on your phone
description: Put kasten on a phone's home screen, reach the capture page from its icon, replace the capture app an earlier release installed, get todo reminders pushed to it, and set a timer that rings on it.
tags: [phone, install, android, ios, capture, push]
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


## Get reminders on this device

A todo with `⏰ 2026-11-12 09:00` sends a push to each subscribed device at that
time, even with kasten closed. The server needs `KASTEN_PUSH_PRIVATE_KEY`
([Configuration: push reminders](/reference/configuration/push-reminders.md));
without it `/settings` says push is not set up.

1. On Android, open kasten in Chrome. On an iPhone, open it from its home screen
   icon: iOS 16.4 and later send web push only to an app added there.
2. Open `/settings` and press **Send reminders to this device**, then allow
   notifications.
3. Add `⏰` and a time a minute or two ahead to a todo, and wait for the push.
   A tap opens the todo's note.

Each device subscribes on its own, and `/settings` lists them all. **Remove**
takes one off; on the device in your hand it also turns off the browser's
subscription.

## Set a timer

A timer rings on every device that gets reminders, so subscribe first, as
above.

1. Tap `timers` in the toolbar, or open an empty pane, which shows Today.
2. Under **Timers**, type a name such as `Washer` and a duration such as
   `1h 25m`, `1:25` or `85`, and press **Start**.
3. Wait: the row counts down, and when it ends each device gets a push with the
   name. A tap opens kasten.

The timer then shows as a button under the form, and a tap starts it again. To
cancel one, press **Stop** beside it.

## Related

* [Capture from your phone](/how-to/capture-from-your-phone.md): the capture page, and sharing into it from other apps
