---
type: Reference
title: "Save path orderings: the log pane's sheet and quick buttons"
description: The orders in which a food logged from the log pane's food sheet, or a tap on one of its quick buttons, can meet a refused write, a day moved, the pane closed or the pane drawn again, and what must hold in each.
resource: [frontend/src/components/log/log-pane.tsx, frontend/src/components/log/use-log-food-sheet.ts]
tags: [saving, frontend, tests, log]
status: stable
---

# Save path orderings: the log pane's sheet and quick buttons

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table). Rows keep their numbers on every page. The log pane's other writes are rows L11 to L14 in [the log card's page](/reference/save-path-orderings/log-card.md), and the format of the lines is [Log format](/reference/food/log-format.md).

## Orderings

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| L21 | A food logged from the log pane's sheet (`f` or `+ Food`), on today or another day, with the write refused, the day moved while the sheet is open, or the pane closed with it open. | The line goes through `addLine` for the day the sheet was opened on, so L11 and L12 hold for it. The sheet closes only once the write lands; a refused write keeps it open with its query, so the line can be tried again. Moving the day, closing the pane or any close of the sheet writes nothing, stops the camera and gives the pane the keys back. | no (the query and serving are lost, not the note) | e2e `day/log/today.spec.ts`: `#804 on the day after, a refused food log keeps the sheet open and a logged one closes it into that day's note`, `#804 Escape in the food field gives the pane the focus and j moves the cursor at once`, `#804 the pane closed with the food sheet open leaves no sheet behind`, `#804 a quick tap, an amount and a food pick write their lines byte for byte, and the log reads them back` (#804) |
| L22 | A tap on one of the log pane's quick buttons (the card's buttons), with or without an amount typed, by touch or by a key on the focused button. | One `addLine` for the day shown with the kind's line, as L11 writes it; the amount field empties once it lands, and a refused amount writes nothing and says why. The button keeps the focus after the pane draws again, so the pane's keys still work. | no | e2e `day/log/today.spec.ts`: `#804 each kind, kcal and macro row shows its total, goal in words and meter, and the quick buttons carry theirs`, `#804 a quick button pressed by Enter keeps the focus and the pane keys still work`, `#804 a failed day read shows its message in the Today column and the quick buttons still write` (#804) |
