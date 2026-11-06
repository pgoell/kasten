"""Where a piece of text is code, so the links and tags inside it are left alone.

`WIKILINK` lives here, not in `links.py`: that module imports this one, so the pattern
there would be a cycle. A backtick in an alias is read against it.
"""

import re
import sys
from bisect import bisect_right
from typing import TYPE_CHECKING

from markdown_it import MarkdownIt
from markdown_it.common.html_re import HTML_OPEN_CLOSE_TAG_STR
from markdown_it.rules_block import StateBlock, list_block

if TYPE_CHECKING:
    from markdown_it.token import Token

WIKILINK = re.compile(r"\[\[([^\[\]\n]+)\]\]")
"""One `[[link]]`, spelled the way the editor's parser spells it.

A bracket or a line break inside means the `[[` opened nothing. A target of only spaces
is refused where the text is read, not by this pattern.
"""


BLOCK_NAMES = (
    "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details"
    "|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head"
    "|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup"
    "|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul"
)
"""The names that open an HTML block of kind 6, as the editor's parser and `tag-rule.ts` list them.

An older spec's list: `source` but no `search`, where markdown-it's own list swaps them (#1472).
"""

_HTML_KINDS = [
    (
        re.compile(r"^<(?:script|pre|style)(?=\s|>|$)", re.I),
        re.compile(r"</(?:script|pre|style)>", re.I),
    ),
    (re.compile(r"^<!--"), re.compile(r"-->")),
    (re.compile(r"^<\?"), re.compile(r"\?>")),
    (re.compile(r"^<![A-Z]"), re.compile(r">")),
    (re.compile(r"^<!\[CDATA\["), re.compile(r"\]\]>")),
    (re.compile(rf"^</?(?:{BLOCK_NAMES})(?=\s|/?>|$)", re.I), re.compile(r"^$")),
]
"""Each HTML block kind that may break a paragraph, its opening and its end, by the editor's names.

No `textarea` in kind 1, as in the editor; kind 7, a lone tag, is `_LONE_TAG`.
"""

_LONE_TAG = re.compile(HTML_OPEN_CLOSE_TAG_STR + r"\s*$")


def _html_block(state: StateBlock, first: int, end: int, silent: bool) -> bool:
    """markdown-it's HTML block rule with `_HTML_KINDS` in place of its own lists."""
    start = state.bMarks[first] + state.tShift[first]
    line = state.src[start : state.eMarks[first]]
    if state.is_code_block(first) or not line.startswith("<"):
        return False
    kind = next((kind for kind in _HTML_KINDS if kind[0].search(line)), None)
    if kind is None and not _LONE_TAG.search(line):
        return False
    if silent:
        return kind is not None
    closer = kind[1] if kind else re.compile(r"^$")
    following = first + 1
    if not closer.search(line):
        while following < end and state.sCount[following] >= state.blkIndent:
            line = state.src[
                state.bMarks[following] + state.tShift[following] : state.eMarks[following]
            ]
            if closer.search(line):
                following += 1 if line else 0
                break
            following += 1
    state.line = following
    token = state.push("html_block", "", 0)
    token.map = [first, following]
    token.content = state.getLines(first, following, state.blkIndent, True)
    return True


_ITEM = re.compile(r"(?:([-*+])|([0-9]{1,9})([.)]))(?=[ \t]|$)(?:[ \t]+(\S))?")


def _list(state: StateBlock, first: int, end: int, silent: bool) -> bool:
    """markdown-it's list rule, where a lazy line goes on with its paragraph as in the editor.

    With `lists` in the env, the kinds of the lists open, an empty item or one past 1 cuts a
    lazy line only to go on with a list of its kind (#1544).
    """
    start = state.bMarks[first] + state.tShift[first]
    item = _ITEM.match(state.src, start, state.eMarks[first])
    lists = state.env.get("lists")
    if lists is None or item is None or state.is_code_block(first):
        return list_block(state, first, end, silent)
    kind = "bullet" if item[1] else "ordered"
    if silent and state.parentType in ("paragraph", "blockquote"):
        # The editor cuts at a literal `1` only, and goes on with any list of the same kind.
        cuts = item[4] is not None and (item[1] is not None or item[2] == "1")
        if not cuts and kind not in lists:
            if state.parentType != "blockquote":
                return False
            # A list open inside the quote is parsed only after its lines are taken (#1597).
            state.env["lazy"].append((first, kind))
            return first in state.env["cut"]
        if not cuts:
            # As a list's own item, which markdown-it asks for under its parent type only.
            parent, state.parentType = state.parentType, "list"
            try:
                return list_block(state, first, end, silent)
            finally:
                state.parentType = parent
    if silent:
        return list_block(state, first, end, silent)
    lists.append(kind)
    # The editor goes on with an empty item over blank lines, where markdown-it ends it (#1595).
    # Only `list_block`'s own asks are answered so; the state lasts one parse.
    setattr(  # noqa: B010
        state,
        "isEmpty",
        lambda line: (
            sys._getframe(1).f_code is not list_block.__code__ and StateBlock.isEmpty(state, line)
        ),
    )
    try:
        return list_block(state, first, end, silent)
    finally:
        lists.pop()


FENCES = MarkdownIt("commonmark").disable(["inline", "text_join"])
"""The parser that finds fenced code blocks, at any depth of quote or list.

Blocks only: the inline pass would nearly double the time a long note holds the event loop.
"""
FENCES.block.ruler.at("html_block", _html_block, {"alt": ["paragraph", "reference", "blockquote"]})
FENCES.block.ruler.at("list", _list, {"alt": ["paragraph", "reference", "blockquote"]})

BACKTICKS = re.compile(r"`+")
"""One run of backticks, which opens or closes an inline code span."""


def code_spans(text: str, *, indented: bool = False, html: bool = False) -> list[tuple[int, int]]:
    """Where `text` holds code, as `(start, end)` offsets: fenced blocks and inline spans.

    Indented blocks are not code: four spaces also continue a list item, and `indented`
    reads them for tags. `html` adds the HTML blocks, comments among them, at any depth.
    In doubt the text is not code. Lines split on LF alone (`splitlines` breaks at U+2028).
    """
    return blocks(text, indented=indented, html=html)[0]


def blocks(
    text: str, *, indented: bool = False, html: bool = False
) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    """`code_spans`, and where each paragraph or heading's text runs, as offsets (#1544).

    The second list is what an inline comment may span, so it is filled only by a parse.
    """
    lines = text.split("\n")
    starts = [0]
    for line in lines:
        starts.append(starts[-1] + len(line) + 1)
    starts[-1] = len(text)

    # Every fence opens with three backticks or tildes in a row, so a note with
    # neither has none, and skips the parse that is most of a long note's time.
    fenced = []
    inline = []
    kinds = ("fence", "code_block") if indented else ("fence",)
    if indented or html or "```" in text or "~~~" in text:
        tokens = _parse(text.replace("\r", " "), lists=indented)
        for token in tokens:
            if token.map is None:
                continue
            if token.type in kinds or (html and token.type == "html_block"):
                fenced.append((token.map[0], token.map[1]))
            elif token.type == "inline":
                inline.append((starts[token.map[0]], starts[token.map[1]]))

    spans = []
    line = 0
    for first, stop in fenced:
        spans += _inline_spans(lines, starts, line, first)
        spans.append((starts[first], starts[stop]))
        line = stop
    spans += _inline_spans(lines, starts, line, len(lines))
    return spans, inline


def _parse(text: str, *, lists: bool) -> list[Token]:
    """`FENCES`'s tokens, with `lists` the list rule of the editor that `_list` reads.

    A lazy item cuts a quote where a list of its kind is open inside it, which only a first
    parse shows, so a note with such a line is parsed twice (#1597).
    """
    if not lists:
        return FENCES.parse(text)
    cut: set[int] = set()
    # A cut moves the quotes after it, so it is parsed again until the cuts hold, a few times.
    for _ in range(4):
        env: dict = {"lists": [], "lazy": [], "cut": cut}
        tokens = FENCES.parse(text, env)
        if not env["lazy"]:
            break
        # How many lists of each kind hold each line, as running sums.
        held = {kind: [0] * (text.count("\n") + 2) for kind in ("bullet", "ordered")}
        for token in tokens:
            if token.type in ("bullet_list_open", "ordered_list_open") and token.map:
                counts = held[token.type.split("_")[0]]
                counts[token.map[0]] += 1
                counts[token.map[1]] -= 1
        for counts in held.values():
            for index in range(1, len(counts)):
                counts[index] += counts[index - 1]
        # A list holding the line above holds the paragraph the lazy line goes on with.
        found = {line for line, kind in env["lazy"] if held[kind][line - 1] > 0}
        if found == cut:
            break
        cut = found
    return tokens


def fence_open(text: str, opener: int) -> bool:
    """Whether a fence opens on line `opener` of `text` and has no closer, by markdown-it (#1480).

    False for an inline span that starts the line (#1554). In a list item a closer counts from
    the item's content. The token keeps no flag for it: a closed one spans a line more than it
    holds.
    """
    for token in FENCES.parse(text.replace("\r", " ")):
        if token.type == "fence" and token.map is not None and token.map[0] == opener:
            content = token.content
            held = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
            return token.map[1] - opener - 1 <= held
    return False


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
