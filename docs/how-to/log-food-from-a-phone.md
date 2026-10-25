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
2. Tap `+ Food` on the log card. The food sheet rises from the foot of the screen. Or tap `run`, then `Log food`.
3. Tap `Scan`, beside the search field. The camera opens inside the sheet.
4. Hold the barcode in the frame. kasten reads EAN-13, EAN-8, UPC-A and UPC-E
   codes. The camera stops when it has a code, and the phone buzzes once where
   the browser can (Android Chrome; iOS Safari does not).
5. The product opens at the serving step. Tap a chip (`100 g`, `150 g`, `1 serving` or `250 g`) or type the grams, then pick the meal. The preview shows the kcal and the kcal left today.
6. Tap `Log this food`, pinned at the foot of the sheet above the keyboard. One food line goes to the end of `## Log`, and the sheet closes.

To stop the camera without a read, tap `Stop`. It reads `Scan` again once the
camera is off.

The camera stops by itself when the sheet closes, when the note closes, and
when you switch to another app or tab. It does not start again on its own:
tap `Scan` to read another code.

In a dark room, tap `Torch` beside `Scan` to light the barcode, and tap it again
to turn the light off. The button shows only where the camera has a torch
(Android Chrome; iOS Safari has none). The torch goes off with the camera.

## Find a food by name

Type two letters or more in the search field. The results come in three sections, in this order: `Mine` (your own foods), `Recent` (foods the last 30 days logged) and `Open Food Facts`. The first two need no search. Tap a food to open the serving step, then tap `Log this food`.

## Log kcal without a food

1. Tap `+ Food`.
2. Type the kcal in the quick add field, and tap `Add`.

The line `- 🍽 <meal>: 🔥 250 kcal` goes to the end of `## Log`, under the meal of the hour: breakfast from 5 to 10, lunch from 11 to 14, dinner from 17 to 21, and a snack at other hours. Tap the meal picker to change it. Zero, a negative number, text and a number of ten digits or more write nothing, and the sheet says why.

## Copy yesterday's meal

An empty meal on the card offers `Copy yesterday's <meal> (<n> lines)` when yesterday's note has lines for that meal. Tap it. Each of yesterday's lines for that meal goes into today's note as yesterday holds it. Yesterday's note does not change. The copy is one change, so `u` (vim on), undo (vim off) or the card's `Undo` takes every copied line back at once.

## Log your weight

Type the weight in kg into the amount field, and tap `⚖ Weight` on the card. The line `- ⚖ 82.4 kg` goes to the end of `## Log`, and the field empties. With the field empty, tapping `⚖ Weight` asks for the number: type it and press Enter. The button shows the day's weight, or the latest one from the 30 days before when the day has none. `Undo` takes the line back.

## Close the sheet

Press `Escape`, drag the grabber at the top of the sheet down, or, on a desktop, click the dimmed scrim beside the panel. Nothing is logged. The camera stops, and the editor takes the focus back.

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
barcode N on Open Food Facts; search by name or add it as your own`, with the
code in place of `N`. Nothing is logged. Type the food's name in the search
field to find it, or tap `Add food` to save it with that barcode: see
[Add a food of your own](/how-to/add-a-food-of-your-own.md). A barcode you saved
as your own opens without asking Open Food Facts.

## Related

* [Add a food of your own](/how-to/add-a-food-of-your-own.md): save a food Open Food Facts lacks
* [Food from Open Food Facts](/explanation/food-from-open-food-facts.md): where the barcode goes, and what leaves the server
* [The log format](/reference/log-format.md): the line a logged food leaves in the daily note
