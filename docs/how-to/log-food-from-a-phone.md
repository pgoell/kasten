---
type: How-to Guide
title: Log food from a phone
description: Scan a food's barcode with the phone camera, log it on today's note, and what to do when the camera is refused, the barcode is typed instead, or the barcode is unknown.
tags: [phone, food, barcode, camera, log]
status: stable
---

# Log food from a phone

You have kasten open on a phone, or installed from
[Install kasten on your phone](/how-to/install-on-your-phone.md), and you want
to log a packaged food by its barcode. [Use kasten on a phone](/how-to/use-kasten-on-a-phone.md)
explains the row of buttons along the bottom edge.

## Scan a barcode and log the food

1. Tap `today`. The daily note opens.
2. Tap `+ 🍽 food` on the log card. Or tap `run`, then `Log food`.
3. Tap `Scan`, beside the search field. The camera opens inside the panel.
4. Hold the barcode in the frame. kasten reads EAN-13, EAN-8, UPC-A and UPC-E
   codes. The camera stops when it has a code.
5. The product opens with its serving form. Pick the grams and the meal.
6. Tap `Log this food`. One food line goes to the end of `## Log`.

To stop the camera without a read, tap `Stop`. It reads `Scan` again once the
camera is off.

The camera stops by itself when the panel closes, when the note closes, and
when you switch to another app or tab. It does not start again on its own:
tap `Scan` to read another code.

## When the camera is refused

kasten says `The camera is not allowed; type the barcode instead`. Allow the
camera for the site, then tap `Scan` again.

* **iOS Safari in a tab:** open Settings > Safari > Camera, and set it to
  Allow or Ask. Then reload the page.
* **An app installed to the home screen on iOS:** the app asks for the camera
  each time it starts. Tap Allow.
* **Android Chrome:** tap the icon beside the address, open Permissions, and
  set Camera to Allow. Chrome remembers the answer for the site.

If the phone has no camera, kasten says `No camera here; type the barcode instead`.

## Type the barcode instead

The camera is not needed. Type the digits of the barcode into the search field,
eight to fourteen of them. The product shows as the one result; tap it.

A scanned UPC-E code is looked up as its twelve-digit UPC-A form, so you do not
convert it yourself.

## An unknown barcode

If Open Food Facts has no product for the code, kasten says `No food with
barcode N on Open Food Facts; search by name instead`, with the code in place
of `N`. Nothing is logged. Type the food's name in the search field to find it.

## Related

* [Food from Open Food Facts](/explanation/food-from-open-food-facts.md): where the barcode goes, and what leaves the server
* [The log format](/reference/log-format.md): the line a logged food leaves in the daily note
