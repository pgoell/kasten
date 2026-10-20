---
type: Reference
title: "Save path orderings: the dump capture"
description: The orders in which a capture into a daily note's ## Dump can meet a heading inside a fence, a heading with trailing spaces or a tab, a fence with a heading-shaped line in the dump, a note that ends inside a fence nobody closed, or a capture that opens a fence it does not close: what must hold in each, whether getting it wrong loses typed text, and the test that holds it.
resource: backend/src/kasten_backend/periodic.py
tags: [saving, backend, tests, dump]
status: stable
---

# Save path orderings: the dump capture

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table). Rows keep their numbers on every page. The route that writes a capture is [POST /api/dump](/reference/http-api/capture.md#post-apidump).

## Orderings

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| D1 | A capture into a note whose `## Dump` sits inside a fence or the frontmatter, or carries trailing spaces or a tab, or whose dump holds a fence with a heading-shaped line in it. | The heading is found by the readers' rule (`log.py`'s `_log_lines`, and the frontend finder of #748): the line reads exactly `## Dump` once trailing whitespace goes, outside any fenced code block (backtick or tilde) and below the frontmatter. The capture goes at the end of that dump, which ends at the next `#` or `##` heading outside a fence. A heading-shaped line in a fence inside the dump does not end it, and a `###` is part of the dump. With no such heading a `## Dump` is made at the end of the note, after a closing line if the note ends inside a fence nobody closed (rows D2 and D4). | no | test_dump: `test_a_dump_inside_a_fence_is_not_the_section`, `test_a_dump_inside_a_tilde_fence_is_not_the_section`, `test_a_heading_in_a_fence_inside_the_dump_does_not_end_it`, `test_a_dump_in_the_frontmatter_is_not_the_section`, `test_finds_a_dump_with_trailing_spaces_and_a_tab`, `test_makes_a_dump_at_the_end_when_the_only_one_is_fenced`, `test_a_four_backtick_inline_span_leaves_a_closed_fence_closed` (#749) |
| D2 | A note whose only `## Dump` sits in a fence nobody closed, so the fence runs to the note's end. | The heading in the fence is not used, since readers never see it. The fence gets a closing line after the note's last line, and a live `## Dump` is made at the end. A second capture goes under that same heading, so there is one closer and one heading. | no | test_dump: `test_a_dump_only_in_an_unclosed_fence_gets_the_fence_closed_and_one_live_dump` (#752), `test_a_backtick_line_that_opens_no_fence_leaves_one_dump` (#749) |
| D3 | A capture that opens a fence it does not close: a fence opener (three or more backticks, or tildes) with no closing line after it. | A closing line with the opener's marker goes after the capture. The captured text is kept byte for byte. The sections after the dump still read, `## Log` included. A capture with a closed fence gets no closer. | no. Without the closer it hides the sections after it. | test_dump: `test_a_capture_that_opens_a_fence_is_closed_and_the_log_still_reads`, `test_a_capture_keeps_its_text_and_gets_a_closer_as_long_as_its_opener`, `test_a_tilde_capture_is_closed_by_tildes`, `test_a_capture_with_a_closed_fence_is_written_as_it_came` (#752) |
| D4 | A capture into a dump that ends inside a fence nobody closed. | A closing line with the opener's marker goes after the note's last line first, and the capture goes after it. Nothing in the note is removed or moved, and blank lines inside the fence stay in it. An open fence in a later section stays as it is. Two captures leave one closer. | no | test_dump: `test_a_capture_into_a_dump_ending_in_an_unclosed_fence_lands_after_it`, `test_two_captures_into_a_dump_ending_in_an_unclosed_fence_leave_one_closer`, `test_blank_lines_at_the_end_of_an_unclosed_fence_stay_inside_it`, `test_an_open_fence_after_the_dump_is_left_alone` (#752) |
