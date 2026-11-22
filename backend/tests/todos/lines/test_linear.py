"""The todo patterns code scanning flagged read in linear time and match as before."""

import itertools
import re
import time
from typing import TYPE_CHECKING

from kasten_backend.todos.lines import fields
from kasten_backend.todos.lines.read import LINE

if TYPE_CHECKING:
    from collections.abc import Callable

OLD_LINE = re.compile(
    r"([ \t]*)- \[[ /xXbwr-]\](?:[ \t]([^\r\n\N{LINE SEPARATOR}\N{PARAGRAPH SEPARATOR}]*))?"
)
OLD_BLOCK_ID = re.compile(r"(?:^|(?<![ \t])[ \t]+)\^[A-Za-z0-9_-]+$")
LINES = [
    "- [ ] buy milk",
    "  - [x] gather numbers ✅ 2026-11-01",
    "\t- [/] draw the chart ^abc",
    "- [b] ship it ⛔ kt-000009 #private",
    "- [ ]",
    "- [ ]\tword",
    "- [ ]word",
    "-  [ ] two spaces",
    "* [ ] star",
    "text - [ ] mid line",
    "- [ ] a\u2028b",
    "\t\t",
]


def took(read: Callable[[str], object], text: str) -> float:
    start = time.perf_counter()
    read(text)
    return time.perf_counter() - start


def test_a_todo_line_reads_in_linear_time_however_it_is_run() -> None:
    # Code scanning #37 and #39: `search` tried `[ \t]*` from every tab, 6 s for 40,000.
    assert took(LINE.search, "\t" * 40_000) < 0.5
    assert took(LINE.fullmatch, "- [ ]" + "\t" * 40_000 + "\r") < 0.5


def test_a_todo_line_matches_as_before() -> None:
    for line in LINES:
        for read, old in ((LINE.match, OLD_LINE.match), (LINE.fullmatch, OLD_LINE.fullmatch)):
            found, before = read(line), old(line)
            assert (found and found.groups()) == (before and before.groups()), line


def test_a_block_id_is_read_as_the_old_pattern_read_it() -> None:
    alphabet = " \t^a!-\n\N{NO-BREAK SPACE}"
    for size in range(7):
        for letters in itertools.product(alphabet, repeat=size):
            text = "".join(letters)
            old = OLD_BLOCK_ID.search(text)
            span = fields.block_id(text)
            assert (span and (span.start, span.stop)) == (old and old.span()), repr(text)
            assert fields.without_block_id(text) == OLD_BLOCK_ID.sub("", text), repr(text)


def test_a_block_id_reads_in_linear_time() -> None:
    # Code scanning #38. The old lookbehind was linear too; this holds the new code to it.
    for text in ("a" + "\t" * 100_000 + "^b", "^" * 100_000, " ^a" * 50_000 + "!"):
        assert took(fields.without_block_id, text) < 0.5
