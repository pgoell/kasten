---
type: Reference
title: "Save path orderings: the share tick, the done log and the reminder buttons"
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
| S1 | A tick lands on the list, then the log line goes into today's daily note, made as `<leader>gd` makes it where the vault has none. | One `- ✅ <today> <words> [[<list>]] <id>` line under `## Done`, the line and its place the ones the todo pane writes. The day on the line, the `✅` stamp and the daily note's name are one date: the `day` the lists app sends, its device's date, else the server's (#1300). | no | test_share_done_log: `test_1300_a_tick_stamps_and_logs_the_day_the_lists_app_sends` (red before #1300, which stamped the server's UTC date), `test_726_share_tick_writes_one_done_log_line_in_todays_daily_note`, `test_726_a_missing_daily_note_is_made_as_leader_gd_makes_it`, `test_726_done_line_matches_the_todo_pane_cases`, `test_726_done_log_places_the_line_where_the_todo_pane_does` |
| S2 | The process dies, or the daily write raises (a note over the size bound, a search rg cannot run), after the list landed and before the log line did. | The item stays ticked with its `✅` and `🆔`, and no log line is written: the state a tick left before #726. The tick answers `500` (rg) or `413` (size) though the list saved, and the lists app's retry finds the item done and stops. An untick and a tick write the line. | no | none: the state left is the one every tick left before #726 |
| S3 | A tick of an item whose id a `- ✅` line already names, in any note outside the archive. | No second line, as the pane skips an id logged anywhere. Today's note is checked again under the hold that writes it. | no | test_share_done_log: `test_726_a_tick_of_an_id_logged_elsewhere_writes_no_second_line` |
| S4 | An untick lands on the list, then every note holding a `- ✅` line naming the id loses that line, one hold per note. | A line names the id when the id is its last `kt-` word, or its last word where it has none, as the pane's row 135 reads it. Every such line goes, older daily notes too, and every other line stays: a log line of another todo whose words mention the id, and a log line in a code fence. A crash midway leaves the notes not yet visited with their line. | no | test_share_done_log: `test_726_untick_drops_the_done_log_line`, `test_726_untick_drops_the_line_from_an_older_daily_note`, `test_1301_untick_keeps_a_log_line_of_another_todo_naming_the_id`, `test_1301_untick_keeps_a_fenced_log_line`, `test_1301_untick_drops_its_own_line_with_words_after_the_id`, `test_1301_drop_done_matches_the_todo_pane_cases` (red before #1301, which dropped any line holding the id) |
| S5 | A refused tick: a name outside the share folder (`404`), a line that is no item (`200`), a stale sha (`409`), a recurring item (`422`). | The refusal fires before the list is written, and no daily note is written or made. | no | test_share_done_log: `test_726_refused_tick_writes_no_done_log_line` |
| S6 | `KASTEN_SHARE_LOGS_DONE=false`. | The tick writes its list and nothing else. | no | test_share_done_log: `test_726_logs_done_off_leaves_the_daily_note_alone` |
| S7 | A tick or untick of an item whose `🆔` another todo line carries too, in the list (a pasted copy) or in another note outside the archive, while `KASTEN_SHARE_LOGS_DONE` is on. | It answers `422` with the pane's words, `🆔 <id> is on another todo too: <note> line <n>`, before the list is written, and no log line is written or dropped: the log line could be the other todo's. As the pane's row 127. With the log off nothing goes by id, and the tick goes through. | no | test_share_done_log: `test_1303_tick_refuses_an_id_two_todos_carry_and_writes_nothing` (two cases, red before #1303, which ticked and logged), `test_1301_untick_refuses_an_id_two_todos_carry_and_writes_nothing` (two cases, red before #1301), `test_1303_logs_done_off_ticks_an_id_two_todos_carry` |

## The reminder buttons

**Done** and **Tomorrow** on a pushed reminder go to [POST /api/push/act](/reference/http-api/todos.md#post-apipushact), which ticks through the same code as the share tick (`share.tick_task`) and writes through the agent's conditional save, under the same vault lock. It reads the note, finds the line by the text the push carried, and saves with the digest of what it read; a browser save landing between the read and the write refuses the save, and the act reads again, up to three times. The history names the writer `push`.

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| N1 | Lines were added or taken out above the todo after the push went, so its line number moved. | The act finds the line by its text, ticks it (or moves its `⏰`) and touches no other line. | no | test_act: `test_1682_done_ticks_the_line_found_by_its_text_where_it_moved`, `test_1682_tomorrow_moves_the_alarm_a_day_on_where_the_line_moved` (red on main, which has no route) |
| N2 | The todo's text changed, it was ticked already, the note went, or two lines of the note now read that text. | It answers `409` and writes nothing, no daily note either: it never ticks a line it cannot tell is the pushed one. The service worker then opens the note at its line. | no | test_act: `test_1682_an_act_whose_line_is_gone_or_twinned_writes_nothing` (six cases), `test_1682_an_act_on_a_note_that_is_gone_writes_nothing`; service-worker: `#1682 I2 a button answered %s opens the note: %s` |
| N3 | **Done** on a recurring todo or part, on one whose `🆔` another todo carries, or on one whose `🆔` a `⛔` names. | It answers `422` and writes nothing: the pane writes a next copy or moves dependents there, which a tick here does not. As S7 and the pane's 127 and 129. | no | test_act: `test_1682_done_the_pane_writes_more_for_is_refused_and_writes_nothing` (three cases) |
| N4 | A browser save lands between the act's read and its write. | The save names the digest the act read, so it is refused, and the act reads the newer text and finds the line again, three tries in all, then `409`. The browser's text is never written over. | no | none: the conditional save is the agent's, held by its own tests |
| N5 | **Done** lands, then the `- ✅` line goes into today's daily note. | As S1 and S2: the line first, then the log, so a failure between them leaves the todo ticked with no log line. | no | test_act: `test_1682_done_ticks_the_line_found_by_its_text_where_it_moved` |

