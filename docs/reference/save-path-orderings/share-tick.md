---
type: Reference
title: "Save path orderings: the share tick and the done log"
description: The orders in which a tick or untick through the lists app writes its list and the done log line in a daily note, what a crash or a refusal between the two writes leaves, and the test that holds each.
resource: backend/src/kasten_backend/done_log.py
tags: [saving, backend, tests, share, todos]
status: stable
---

# Save path orderings: the share tick and the done log

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table). Rows keep their numbers on every page. The route is [POST /share/lists/{name}/tick](/reference/http-api/shared-lists.md#post-sharelistsnametick).

The backend holds one lock for the whole vault (`vault_write` in `change.py`), so its writes go out one at a time, whichever note they touch. A tick takes that lock twice in a row and never nests the holds: the list first, then today's daily note. An untick takes it once for the list, then once for each note holding a `- ✅` line naming the item's id. Each hold reads the note and writes it, so a browser save landing between two holds is read, not written over. Both writes name the same writer in the history, `share:<Name>` or `share`.

## Orderings

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| S1 | A tick lands on the list, then the log line goes into today's daily note, made as `<leader>gd` makes it where the vault has none. | One `- ✅ <today> <words> [[<list>]] <id>` line under `## Done`, the line and its place the ones the todo pane writes. The day on the line, the `✅` stamp and the daily note's name are one date. | no | test_share_done_log: `test_726_share_tick_writes_one_done_log_line_in_todays_daily_note`, `test_726_a_missing_daily_note_is_made_as_leader_gd_makes_it`, `test_726_done_line_matches_the_todo_pane_cases`, `test_726_done_log_places_the_line_where_the_todo_pane_does` |
| S2 | The process dies, or the daily write raises (a note over the size bound, a search rg cannot run), after the list landed and before the log line did. | The item stays ticked with its `✅` and `🆔`, and no log line is written: the state a tick left before #726. The tick answers `500` (rg) or `413` (size) though the list saved, and the lists app's retry finds the item done and stops. An untick and a tick write the line. | no | none: the state left is the one every tick left before #726 |
| S3 | A tick of an item whose id a `- ✅` line already names, in any note outside the archive. | No second line, as the pane skips an id logged anywhere. Today's note is checked again under the hold that writes it. | no | test_share_done_log: `test_726_a_tick_of_an_id_logged_elsewhere_writes_no_second_line` |
| S4 | An untick lands on the list, then every note holding a `- ✅` line naming the id loses that line, one hold per note. | Every such line goes, older daily notes too, and every other line stays. A crash midway leaves the notes not yet visited with their line. | no | test_share_done_log: `test_726_untick_drops_the_done_log_line`, `test_726_untick_drops_the_line_from_an_older_daily_note` |
| S5 | A refused tick: a name outside the share folder (`404`), a line that is no item (`200`), a stale sha (`409`), a recurring item (`422`). | The refusal fires before the list is written, and no daily note is written or made. | no | test_share_done_log: `test_726_refused_tick_writes_no_done_log_line` |
| S6 | `KASTEN_SHARE_LOGS_DONE=false`. | The tick writes its list and nothing else. | no | test_share_done_log: `test_726_logs_done_off_leaves_the_daily_note_alone` |
