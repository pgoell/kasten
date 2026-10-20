"""Where a piece of text is code, so the links and tags inside it are left alone.

Hides which fences and which backtick runs make code, and the one-line reading
of an inline span that keeps a stray backtick from hiding the links after it.
`WIKILINK` lives here because a backtick inside a link's alias is read against
the link pattern, and `links.py` imports this module, so the pattern cannot sit
in `links.py` without a cycle.
"""

import re
from bisect import bisect_right

from markdown_it import MarkdownIt

WIKILINK = re.compile(r"\[\[([^\[\]\n]+)\]\]")
"""One `[[link]]`, spelled the way the editor's parser spells it.

A bracket or a line break inside means the `[[` opened nothing: a link names one
note, and it names it on one line. A target of only spaces is refused below,
where the text is in hand, rather than by a longer pattern here.
"""


FENCES = MarkdownIt("commonmark").disable(["inline", "text_join"])
"""The parser that finds fenced code blocks, at any depth of blockquote or list.

Blocks only: the fences are all `code_spans` asks of it, and the inline pass
would near double the time a long note holds the event loop for.
"""

BACKTICKS = re.compile(r"`+")
"""One run of backticks, which opens or closes an inline code span."""


def code_spans(text: str, *, indented: bool = False) -> list[tuple[int, int]]:
    """Where `text` holds code, as `(start, end)` offsets: fenced blocks and inline spans.

    A `[[x]]` in code is an example of the syntax and not a link, so a move
    leaves it as written, the way Obsidian does. The fences are the ones a
    CommonMark parser finds, markdown-it's, so a fence inside a blockquote or
    under a nested list item is code too, and one nobody closed ends with the
    blockquote or list item holding it, or else with the note. A fence's span
    is its whole lines, the `> ` in front of them included.

    An indented block is not read as code, though the parser finds those too.
    Four spaces is also how a list item continues, and reading them as code
    would hide links nobody asked to hide. `indented` reads them all the same,
    for the tags: the editor draws no tag in one, and the parser already tells
    a continued list item from code.

    Where the reading is in doubt the text is not code: a link wrongly taken
    for code is left pointing at nothing, and one wrongly taken for a link is
    only rewritten, as every move did before this read code at all.

    Lines are split on the line feed alone, not `splitlines`, which also breaks
    at a form feed or U+2028 and would open a fence in the middle of a line.
    The parser breaks at a lone carriage return as well, so each one is handed
    to it as a space: the parser's line numbers are then this split's, and the
    offsets stay where they were.
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
    if indented or "```" in text or "~~~" in text:
        for token in FENCES.parse(text.replace("\r", " ")):
            if token.type in kinds and token.map is not None:
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
    """The inline code spans of one line: a run of backticks closed by the next run as long.

    One line, where CommonMark lets a span run on to the end of its paragraph:
    telling where a paragraph ends means parsing lists, headings and tables, and
    a stray backtick in one list item must not hide the links of the next.

    A backslash escapes the first backtick of a run that opens, and the rest of
    the run opens as a shorter one; inside code a backslash is only a backslash,
    so a closer is taken as written.

    A run that starts inside a `[[link]]` may close a span and never opens one,
    so a backtick in an alias cannot pair with one later on the line and hide
    the links between. It still closes: blanking the link instead would move a
    span's real end past it, and hide the links after.

    Paired by a walk over the runs rather than by a pattern, which would scan to
    the end of the line from every unclosed run.
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

    A search rather than a scan of every span, which on a long note full of code
    held the event loop for seconds: one scan per link.
    """
    index = bisect_right(spans, position, key=lambda span: span[0])
    return index > 0 and position < spans[index - 1][1]
