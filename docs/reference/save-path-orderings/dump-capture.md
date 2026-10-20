---
type: Reference
title: "Save path orderings: the dump capture"
description: The orders in which a capture into a daily note's ## Dump can meet a heading inside a fence, a heading with trailing spaces or a tab, a fence with a heading-shaped line in the dump, or a note that ends inside a fence nobody closed, what must hold in each, whether getting it wrong loses typed text, and the test that holds it.
resource: backend/src/kasten_backend/periodic.py
tags: [saving, backend, tests, dump]
status: stable
---

# Save path orderings: the dump capture

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table). Rows keep their numbers on every page. The route that writes a capture is [POST /api/dump](/reference/http-api/capture.md#post-apidump).

## Orderings

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| D1 | A capture into a note whose `## Dump` sits inside a fence or the frontmatter, or carries trailing spaces or a tab, or whose dump holds a fence with a heading-shaped line in it. | The heading is found by the readers' rule (`log.py`'s `_log_lines`, and the frontend finder of #748): the line reads exactly `## Dump` once trailing whitespace goes, outside any fenced code block (backtick or tilde) and below the frontmatter. The capture goes at the end of that dump, which ends at the next `#` or `##` heading outside a fence. A heading-shaped line in a fence inside the dump does not end it, and a `###` is part of the dump. With no such heading a `## Dump` is made at the end of the note, unless the note ends inside a fence nobody closed that holds `## Dump` (row D2). | no | test_dump: `test_a_dump_inside_a_fence_is_not_the_section`, `test_a_dump_inside_a_tilde_fence_is_not_the_section`, `test_a_heading_in_a_fence_inside_the_dump_does_not_end_it`, `test_a_dump_in_the_frontmatter_is_not_the_section`, `test_finds_a_dump_with_trailing_spaces_and_a_tab`, `test_makes_a_dump_at_the_end_when_the_only_one_is_fenced`, `test_a_four_backtick_inline_span_leaves_a_closed_fence_closed` (#749) |
| D2 | Two captures into a note that ends inside a fence nobody closed, holding `## Dump`. | Both go under that heading. No second `## Dump` is made. | no | test_dump: `test_two_captures_under_a_dump_in_an_unclosed_fence_leave_one_heading`, `test_a_backtick_line_that_opens_no_fence_leaves_one_dump` (#749) |
