---
type: Reference
title: "Save path orderings: the log card's weight kind"
description: The orders in which a weight written from the Log card's Weight button, a press that asks for the number, a refused amount, a palette Log weight, a second weigh-in and its Undo, and the read of the 30 days before the note can meet the note's buffer, what must hold in each, and whether getting it wrong loses a typed line.
resource: frontend/src/lib/log-card-weight.ts
tags: [editor, saving, autosave, frontend, tests, log]
status: stable
---

# Save path orderings: the log card's weight kind

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table). Rows keep their numbers on every page. The rows before these are in [the log card](/reference/save-path-orderings/log-card.md). The format of the lines is [Log format](/reference/log-format.md).

## Orderings

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| L21 | A weight written from the card's `⚖ Weight` button, with a number in the amount field. | One transaction at the end of `## Log`, as L1 writes a drink, isolated in the history. The amount field is emptied. The card's Undo, `u` (vim on) or undo (vim off) takes the line back. | no | log-card-weight: `#805 A4 the Weight button writes the typed number as a weight line, and Undo takes it back`, `#805 I3 with vim on, u takes back a weight line written after an ask`, `#805 I3 with vim off, undo takes a weight line written after an ask back` (#805) |
| L22 | `⚖ Weight` with the amount field empty, or Enter in the field while the card asks. | Nothing is written. The card asks for the number: the why line says `Type the weight in kg`, the amount field takes the focus, and its placeholder says `weight in kg`. Enter while the card asks writes the line, as pressing the button does. | no | log-card-weight: `#805 A5 with an empty amount the Weight button asks for the number`, `#805 A5 Enter in the amount field while asking writes the weight line` (#805) |
| L23 | A typed amount that is no weight, such as `abc`, `0` or `82.4 lb`, with or without a question on the card. | Nothing is written. The why line says why, and the amount field keeps its text. A question on the card is taken back, and the next write or edit of the note takes it back too. A comma decimal such as `82,4` and a typed unit such as `82.4 kg` write. | no | log-card-weight: `#805 I1 an amount that is no weight says why, writes nothing and keeps the text`, `#805 I1 a comma decimal and a typed unit both write the weight line`, `#805 I3 the question's words and placeholder clear on the next press, and a refused amount keeps its text` (#805) |
| L24 | The palette's `Log weight`, over a daily note's card or anywhere else. | Over a card it asks on the card, as L22, and writes nothing. Anywhere else it opens today's note and writes nothing, and the user asks there. | no | palette-weight: `#805 I4 Log weight over a daily note's card asks on the card and writes no line`, `#805 I4 Log weight away from a card opens today's note and writes no line` (#805) |
| L25 | A second weigh-in on the same day, then the card's Undo. | The day's value is its last line, so the card shows the later value, and after Undo the earlier one again. | no | log-card-weight: `#805 I2 a second weigh-in shows the later value, and Undo shows the earlier one again` (#805) |
| L26 | The read of the 30 days before the note's day, which the card makes where the config has a kind that keeps its last value, when the day has no value of its own. | One read per view and day. A failed read is no earlier value, and the console warns. A config with no such kind asks for nothing more than yesterday. | no | log-card-weight: `#805 A6 with no weigh-in today the Weight button shows the latest one before the day, with its date`, `#805 A6 with no weigh-in in the 30 days the Weight button says so, and the read is asked once per view and day`, `#805 A6 a failed read of the 30 days is no earlier value and warns`, `#805 A6 the 30-day read is asked only where a config has a kind that keeps its last value` (#805) |
