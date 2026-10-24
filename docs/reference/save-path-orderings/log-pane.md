---
type: Reference
title: "Save path orderings: the log pane's sheet and quick buttons"
description: The orders in which a food logged from the log pane's food sheet, or a tap on one of its quick buttons, can meet a refused write, a day moved, the pane closed or the pane drawn again, and what must hold in each.
resource: frontend/src/components/log-pane.tsx
tags: [saving, frontend, tests, log]
status: stable
---

# Save path orderings: the log pane's sheet and quick buttons

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table). Rows keep their numbers on every page. The log pane's other writes are rows L11 to L14 in [the log card's page](/reference/save-path-orderings/log-card.md), and the format of the lines is [Log format](/reference/log-format.md).

## Orderings

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| L21 | A food logged from the log pane's sheet (`f` or `+ Food`), on today or another day, with the write refused, the day moved while the sheet is open, or the pane closed with it open. | The line goes through `addLine` for the day the sheet was opened on, so L11 and L12 hold for it. The sheet closes only once the write lands; a refused write keeps it open with its query, so the line can be tried again. Moving the day, closing the pane or any close of the sheet writes nothing, stops the camera and gives the pane the keys back. | no (the query and serving are lost, not the note) | log-pane-today: `#804 I1 a refused food log keeps the sheet open and a logged one closes it, written to the day shown`, `#804 I1 Esc in the sheet closes it, gives the pane the focus and j moves the cursor at once`, `#804 I2 the pane unmounted with the sheet open leaves no sheet behind`, `#804 A14 a quick tap, an amount and a food pick write their lines byte for byte` (#804) |
| L22 | A tap on one of the log pane's quick buttons (the card's buttons), with or without an amount typed, by touch or by a key on the focused button. | One `addLine` for the day shown with the kind's line, as L11 writes it; the amount field empties once it lands, and a refused amount writes nothing and says why. The button keeps the focus after the pane draws again, so the pane's keys still work. | no | log-pane-today: `#804 A3 the add buttons are the card's quick buttons and + Food, and a tap writes the kind's line on the day shown`, `#804 I1 a quick button pressed by keyboard keeps the focus and the pane keys still work`, `#804 I8 a failed day read shows its message and the add buttons still write` (#804) |
