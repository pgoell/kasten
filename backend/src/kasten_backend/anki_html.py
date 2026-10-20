"""One Anki field as the markdown a card line holds, with the cloze marks and code spans it keeps.

`plain` is the entry: it reads a field's HTML through `anki_markdown`, then
tidies the lines so each one reads back as the text it was. The cloze marks
and code spans it reads on the way are here too, since the note writer and the
re-import read the same marks in a card's text.
"""

import html
import re
from typing import TYPE_CHECKING

from kasten_backend.anki_markdown import _KEPT, _SPACE, _Markdown, _ticked

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

_CLOZE = re.compile(r"\{\{c\d+::((?:(?!\{\{c\d+::).)*?)(?:::(?:(?!\{\{c\d+::).)*?)?\}\}", re.DOTALL)
"""One cloze deletion holding no other, with the hint the author may have written after it.

The hint is part of the match and not of the group, so the highlight a note of
another type gets drops it: Anki shows marks there as typed, and a mark kept
would make kasten ask a card Anki never did. Holding no opener, it is the
innermost mark, so an empty `{{c2::}}` inside `{{c1::a {{c2::}}}}` cannot end
the outer one at its `}}` (#333); a lone brace it takes, as `_MARK` does not.
Across lines too, or a mark over two would keep its `::` in a Basic field.
"""
_OPEN = re.compile(r"\{\{c\d+::")
"""A cloze mark's opener, which `plain` closes when the field never does."""
_MARK = re.compile(
    r"\{\{c([0-9]+)::((?:(?=((`+)(?!`)[^{}]*?(?<!`)\4(?!`)|`+|[^{}`]))\3)+?)"
    r"(?:::((?:(?=((`+)(?!`)[^{}]*?(?<!`)\7(?!`)|`+|[^{}`]))\6)*?))?\}\}"
)
"""A cloze mark kasten reads: `MARK` in `card-line.ts`, character for character.

Groups 1, 2 and 5 are the number, the answer and the hint. Each item is taken
whole through a lookahead, which `re` never backtracks into, so a line of code
spans after an opener never closed does not take twice as long per span. Narrower
than `_CLOZE`, taking no brace and no empty text, so a MathJax
`{{c1::\\(x^{2}\\)}}` is a mark to Anki and not to kasten. A code span in the answer or hint is read
whole, so a `::` inside it is no hint (#346); a lone backtick is text. `[0-9]`
because Python's `\\d` takes digits JavaScript's does not. A nested mark,
`{{c1::a {{c2::b}}}}`, is read innermost first, each inner mark held by a
placeholder the outer one's text takes, as `_marks` does. A match opening
inside a code span is no mark, which `_read` sees to.
"""
_SPANS = re.compile(r"\\.|(`+)(?!`).*?(?<!`)\1(?!`)|`+", re.DOTALL)
"""An escape pair, a code span, or a backtick run that closes none, leftmost first.

`ESCAPES` in `card-line.ts` less its `&#58;`: a code span runs to the next run
of its own length, as CommonMark reads one, an unclosed run is text, and `` \\` ``
opens nothing.
"""
_COLON = re.compile(rf"{_SPANS.pattern}|&#58;", re.DOTALL)
"""`_SPANS` and the text `&#58;`, which `_Markdown` escapes outside code once it is whole."""
_HELD = re.compile("\ue000(\\d+)\ue001")
"""The mark `plain` holds a link's place with: private-use characters no field holds."""
_CODE = re.compile(r"<(script|style)\b.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
_BREAK = re.compile(r"<\s*(?:br\s*/?|/\s*(?:div|p))\s*>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]*>")
_RUBY_TAG = re.compile(r"<(/?)(ruby|rt)\b[^>]*>", re.IGNORECASE)
"""A ruby or rt tag, attributes and all, which a cloze mark keeps bare as a field does."""
_SOUND = re.compile(r"\[sound:([^\]]*)\]")
_IMAGE = re.compile(
    r"""<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>""", re.IGNORECASE
)
"""An `<img>` and its `src`, quoted either way or not at all."""
_HEADING = re.compile(r"#{1,6}[ \t]")
"""`HEADING` in `srs.ts`."""
_ONLY_TAGS = re.compile(r"(?:#[^\W\d][\w/-]*[ \t]*)+")
"""`ONLY_TAGS` in `deck-tag.ts`, `[^\\W\\d]` and `\\w` standing in for the `\\p{L}` `re` lacks."""


def plain(field: str, links: Mapping[str, str] | None = None, *, cloze: bool = False) -> str:
    """One Anki field as markdown, a line for each line the field shows (#234).

    `_Markdown` gives the formatting a card can hold. No line is blank, since
    `srs.ts` ends a `?` card at a blank line, and a line any reader would take
    for part of the format, a heading, a lone `?`, a line of tags, the parking
    token, a schedule comment, carries a backslash so it reads as the text it
    was. An image or a sound whose name `links` maps becomes `![](link)`, and
    any other is dropped.

    A cloze mark stays as it is with its hint where `cloze` says the field is a
    cloze note's text and kasten reads the mark, and is otherwise a
    `==highlight==`: a mark kasten does not read would leave its `::` to split
    the line as a card. Whether kasten reads it is decided on the text as it
    shows, so an entity brace such as `&#123;` breaks a mark as a typed one
    does. Inside another mark, one kasten does not read is its text alone. A
    cloze note's text is one line whatever it holds,
    since `srs.ts` reads the line over a `?` as the cloze and a line above it
    holding a mark as another.
    """
    held: list[str] = []

    def hold(match: re.Match[str]) -> str:
        link = (links or {}).get(_name(match))
        if link is None:
            return ""
        held.append(f"![]({link})")
        # A mark rather than the link, which the passes below would unescape
        # and could split; it goes back in at the end.
        return f"{len(held) - 1}\ue001"

    text = _SOUND.sub(hold, field)
    text = _IMAGE.sub(hold, text)
    # Before the parse, which would leave a script's code behind as prose.
    text = _CODE.sub("", text)
    kept: list[str] = []
    # Each kept mark's form where it sat in code, by the same place.
    coded: list[str] = []
    # The raw text of each kept mark kasten does not read, by its place in `kept`.
    bare: dict[int, str] = {}

    def inside(mark: re.Match[str]) -> str:
        # An inner mark kasten reads stays held, and holds no brace; one it
        # does not is the text Anki shows, since a highlight's `====` would be
        # part of the outer answer and its brace would leave no mark.
        return bare.get(int(mark[1]), mark[0])

    def verbatim(text: str) -> str:
        # The import's marker and a schedule comment keep their backslash in
        # code too, as `_escaped` gives it: `srs.ts` reads a schedule in a code
        # span as anywhere else on the line (#351).
        shown = _shown(_KEPT.sub(inside, text))
        return _ticked(shown.replace("<!--SR:", "<!--SR\\:").replace("<!--anki:", "<!--anki\\:"))

    def keep(match: re.Match[str]) -> str:
        # Out of the parse and flat, so `{{c2::<b>France</b>}}` asks `France`,
        # which is what a typed answer is held against. Ruby stays, and
        # `srs.ts` takes the reading off before comparing. Flat before the
        # test, so `&#123;` is the brace it shows and breaks the mark as one
        # typed does (#333); held inner marks are put back after.
        flat = _flat(_KEPT.sub(inside, match[0]))
        answer = _flat(_KEPT.sub(inside, match[1]))
        hint = match[0][match.end(1) - match.start() : -2]
        if cloze and ("::" in answer or (hint and answer.endswith(":"))):
            # Anki divides answer from hint only at a `::` typed in the field,
            # so a decoded `&#58;&#58;` is answer to it and would be a hint to
            # kasten (#335). Encoded before held inner marks go back, whose own
            # `::` stays. A schedule comment and the import's marker lose
            # `_flat`'s backslash first: their `&#58;` already keeps a reader
            # from taking them, and `\&#58;` would show as the text `&#58;`
            # (#351, #356).
            answer = (
                answer.replace("<!--SR\\:", "<!--SR:")
                .replace("<!--anki\\:", "<!--anki:")
                .replace(":", "&#58;")
            )
            opener = match[0][: match.start(1) - match.start()]
            flat = f"{opener}{answer}{_flat(_KEPT.sub(inside, hint))}}}}}"
        # The form the mark takes where it sat in code: its text in code of
        # its own and verbatim, so no `&#58;` either, since `_MARK` reads a
        # code span whole and a `::` in it is no hint (#346).
        opener = match[0][: match.start(1) - match.start()]
        shown = verbatim(match[1])
        code = f"{opener}{shown}{hint and '::' + verbatim(hint[2:])}}}}}"
        if cloze and _MARK.fullmatch(code) is not None:
            coded.append(_KEPT.sub(lambda mark: coded[int(mark[1])], code))
        else:
            coded.append(f"=={_KEPT.sub(lambda mark: coded[int(mark[1])], shown)}==")
        if cloze and _MARK.fullmatch(flat) is not None:
            kept.append(_KEPT.sub(lambda mark: kept[int(mark[1])], flat))
        else:
            bare[len(kept)] = _KEPT.sub(inside, match[1])
            kept.append(f"=={_KEPT.sub(lambda mark: kept[int(mark[1])], answer)}==")
        return f"{len(kept) - 1}\ue003"

    # Innermost first, so an outer mark holding a whole inner one is read as
    # Anki reads nesting since 2.1.56 (#254). Each pass shrinks the text.
    count = 1
    while count:
        text, count = _CLOZE.subn(keep, text)
        # An opener never closed leaves its `::` to divide a line that is no
        # cloze, and drop a card with no back, so it closes at the field's end.
        if not count and _OPEN.search(text) and not (cloze and any(map(_MARK.search, kept))):
            text, count = text + "}}", 1

    parser = _Markdown()
    parser.feed(text)
    parser.close()
    # `split()` counts the non-breaking space `&nbsp;` as whitespace, which is
    # what turns it into an ordinary space.
    lines = [" ".join(line.split()).replace(_SPACE, " ") for line in parser.text().split("\n")]
    lines = [line for line in lines if line]
    if cloze:
        lines = [" ".join(lines)]
    text = "\n".join(_escaped(_COLON.sub(_colon, line)) for line in lines)
    forms = [coded[at] if at in parser.coded else mark for at, mark in enumerate(kept)]
    text = _KEPT.sub(lambda mark: forms[int(mark[1])], text)
    return _HELD.sub(lambda mark: held[int(mark[1])], text)


def _colon(found: re.Match[str]) -> str:
    """A `_COLON` match as written: the text `&#58;` escaped, the rest as it stands.

    Anki shows a field's `&amp;#58;` as the text `&#58;`, which a card shows as
    a colon (#335) unless the backslash says it is text (#340). Over the parsed
    line rather than each run of text, so one a tag splits is whole (#348),
    and past code spans, which a reader leaves alone (#343). The import's own
    `&#58;` is held in a mark until after.
    """
    return "\\&#58;" if found[0] == "&#58;" else found[0]


def _marks(text: str, keep: Callable[[re.Match[str]], str]) -> str:
    """`text` with every `_MARK` replaced by what `keep` makes of it, innermost first.

    A replacement holds no brace, so an outer mark whose text held a whole
    inner one now matches, as Anki reads nesting since 2.1.56 (#254). A lone
    brace still stops it. Each pass shrinks the text, so the loop ends.
    """
    count = 1
    while count:
        # Read again each pass, since a replacement can end or open a span.
        spans = _code(text)
        count = 0

        def take(match: re.Match[str], spans: list[tuple[int, int]] = spans) -> str:
            nonlocal count
            if _in_code(match.start(), spans):
                return match[0]
            count += 1
            return keep(match)

        text = _MARK.sub(take, text)
    return text


def _read(text: str) -> bool:
    """Whether `text` holds a mark kasten reads: a `_MARK` opening outside every code span."""
    spans = _code(text)
    return any(not _in_code(match.start(), spans) for match in _MARK.finditer(text))


def _code(text: str) -> list[tuple[int, int]]:
    """Where each code span of `text` starts and ends, as `_SPANS` reads them."""
    return [found.span() for found in _SPANS.finditer(text) if found[1]]


def _in_code(at: int, spans: list[tuple[int, int]]) -> bool:
    return any(start <= at < end for start, end in spans)


def _shown(text: str) -> str:
    """`_flat` with none of its escapes: how a cloze mark's text is written in code, verbatim."""
    # Ruby's tags held out bare, with private-use marks, so the strip passes them by.
    text = _RUBY_TAG.sub(lambda tag: f"{tag[1]}{tag[2].lower()}\ue012", text)
    text = html.unescape(_TAG.sub("", _BREAK.sub(" ", text)))
    return " ".join(text.replace("\ue011", "<").replace("\ue012", ">").split())


def _flat(text: str) -> str:
    """`text` as one line, every tag but ruby's stripped: how a cloze mark is written.

    A backslash is doubled, as `_Markdown` doubles it outside code, before any
    written here. The token is escaped here as `_Markdown` escapes it in the
    rest of the field, since `suspended()` in `card-line.ts` reads it inside a
    mark too, and so are the import's marker and a schedule comment, as
    `_escaped` escapes them, since `readSchedule` in `srs.ts` reads a comment
    in an answer as the card's own (#351). So is the text `&#58;`, as `_colon`
    escapes it, before `plain` writes its own colons so.
    """
    # Ruby's tags held out bare, with private-use marks, so the strip passes them by.
    text = _RUBY_TAG.sub(lambda tag: f"{tag[1]}{tag[2].lower()}\ue012", text)
    text = html.unescape(_TAG.sub("", _BREAK.sub(" ", text))).replace("\\", "\\\\")
    text = text.replace("\ue011", "<").replace("\ue012", ">")
    text = " ".join(text.split()).replace("!suspended", "\\!suspended")
    text = text.replace("<!--SR:", "<!--SR\\:").replace("<!--anki:", "<!--anki\\:")
    return text.replace("&#58;", "\\&#58;")


def _escaped(line: str) -> str:
    """`line` with a backslash where a reader would take it for the format rather than text.

    Each is a line `srs.ts` ends a `?` card on or reads as a divider, as
    `_ends_card` lists them. The schedule comment takes its backslash inside,
    since `SR` in `card-line.ts` matches anywhere on a line and a backslash
    before the `<` would leave one whole. The import's marker does the same,
    or a re-import would take the text for a card it wrote.
    """
    if (
        line == "?"
        or line.startswith("!suspended")
        or _HEADING.match(line) is not None
        or _ONLY_TAGS.fullmatch(line) is not None
    ):
        line = f"\\{line}"
    return line.replace("<!--SR:", "<!--SR\\:").replace("<!--anki:", "<!--anki\\:")


def _names(*texts: str) -> list[str]:
    """Every media name the `<img>` and `[sound:]` in `texts` give, the way `plain` reads them."""
    return [
        _name(match)
        for text in texts
        for pattern in (_SOUND, _IMAGE)
        for match in pattern.finditer(text)
    ]


def _name(match: re.Match[str]) -> str:
    """The name a `_SOUND` or `_IMAGE` match gives, unescaped since the field is HTML."""
    return html.unescape(next(group for group in match.groups() if group is not None))
