"""Where a piece of text is code, so the links and tags inside it are left alone.

`WIKILINK` lives here, not in `links.py`: that module imports this one, so the pattern
there would be a cycle. A backtick in an alias is read against it.
"""

import re
from bisect import bisect_right

from markdown_it import MarkdownIt

WIKILINK = re.compile(r"\[\[([^\[\]\n]+)\]\]")
"""One `[[link]]`, spelled the way the editor's parser spells it.

A bracket or a line break inside means the `[[` opened nothing. A target of only spaces
is refused where the text is read, not by this pattern.
"""


FENCES = MarkdownIt("commonmark").disable(["inline", "text_join"])
"""The parser that finds fenced code blocks, at any depth of quote or list.

Blocks only: the inline pass would nearly double the time a long note holds the event loop.
"""

BACKTICKS = re.compile(r"`+")
"""One run of backticks, which opens or closes an inline code span."""


def code_spans(
    text: str, *, indented: bool = False, comments: bool = False
) -> list[tuple[int, int]]:
    """Where `text` holds code, as `(start, end)` offsets: fenced blocks and inline spans.

    Indented blocks are not code: four spaces also continue a list item, and `indented`
    reads them for tags. `comments` adds the HTML blocks a `<!--` opens, at any depth.
    In doubt the text is not code. Lines split on LF alone (`splitlines` breaks at U+2028).
    """
    lines = text.split("\n")
    starts = [0]
    for line in lines:
        starts.append(starts[-1] + len(line) + 1)
    starts[-1] = len(text)

    # Every fence opens with three backticks or tildes in a row, so a note with
    # neither has none, and skips the parse that is most of a long note's time.
    fenced = []
    kinds = ("fence", "code_block") if indented else ("fence",)
    if indented or comments or "```" in text or "~~~" in text:
        for token in FENCES.parse(text.replace("\r", " ")):
            if token.map is None:
                continue
            if token.type in kinds or (
                comments
                and token.type == "html_block"
                and token.content.lstrip().startswith("<!--")
            ):
                fenced.append((token.map[0], token.map[1]))

    spans = []
    line = 0
    for first, stop in fenced:
        spans += _inline_spans(lines, starts, line, first)
        spans.append((starts[first], starts[stop]))
        line = stop
    spans += _inline_spans(lines, starts, line, len(lines))
    return spans


def _inline_spans(
    lines: list[str], starts: list[int], first: int, stop: int
) -> list[tuple[int, int]]:
    """The inline code spans of lines `first` to `stop`, as offsets into the whole text."""
    return [
        (starts[index] + start, starts[index] + end)
        for index in range(first, stop)
        for start, end in _inline_code(lines[index])
    ]


def _inline_code(line: str) -> list[tuple[int, int]]:
    """The inline code spans of one line: a backtick run closed by the next run as long.

    One line, since a CommonMark span runs to the end of its paragraph, which needs list and
    table parsing. A run starting inside a `[[link]]` may close a span but never open one, so
    an alias's backtick cannot hide the links after it.
    """
    links = [link.span() for link in WIKILINK.finditer(line)]
    runs = [run.span() for run in BACKTICKS.finditer(line)]
    by_width: dict[int, list[int]] = {}
    for index, (start, stop) in enumerate(runs):
        by_width.setdefault(stop - start, []).append(index)

    spans = []
    index = 0
    while index < len(runs):
        start, stop = runs[index]
        index += 1
        start += _backslashes_before(line, start) % 2
        if start == stop or inside(start, links):
            continue
        same = by_width.get(stop - start, [])
        closer = bisect_right(same, index - 1)
        if closer == len(same):
            continue
        spans.append((start, runs[same[closer]][1]))
        index = same[closer] + 1
    return spans


def _backslashes_before(line: str, position: int) -> int:
    """How many backslashes run up to `position`, an odd count escaping what follows."""
    count = 0
    while count < position and line[position - count - 1] == "\\":
        count += 1
    return count


def inside(position: int, spans: list[tuple[int, int]]) -> bool:
    """Whether `position` falls in one of `spans`, sorted and apart.

    A bisect, not a scan: one scan per link held the event loop for seconds on a long note.
    """
    index = bisect_right(spans, position, key=lambda span: span[0])
    return index > 0 and position < spans[index - 1][1]
