"""One Anki field as the markdown a card line holds, with the cloze marks and code spans it keeps.

`plain` reads a field's HTML through `anki_markdown`, then tidies the lines so each one
reads back as the text it was. The note writer and the re-import read the same marks.
"""

import html
import re
from typing import TYPE_CHECKING

from kasten_backend.anki_markdown import KEPT, markdown, ticked

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

_CLOZE = re.compile(r"\{\{c\d+::((?:(?!\{\{c\d+::).)*?)(?:::(?:(?!\{\{c\d+::).)*?)?\}\}", re.DOTALL)
"""One cloze deletion holding no other, with the hint the author may have written after it.

Innermost, so an empty `{{c2::}}` in `{{c1::a {{c2::}}}}` cannot end the outer mark (#333).
The hint is in the match but not the group, which is why a highlight drops it.
It matches across lines too.
"""
_OPEN = re.compile(r"\{\{c\d+::")
"""A cloze mark's opener, which `plain` closes when the field never does."""
_MARK = re.compile(
    r"\{\{c([0-9]+)::((?:(?=((`+)(?!`)[^{}]*?(?<!`)\4(?!`)|`+|[^{}`]))\3)+?)"
    r"(?:::((?:(?=((`+)(?!`)[^{}]*?(?<!`)\7(?!`)|`+|[^{}`]))\6)*?))?\}\}"
)
"""A cloze mark kasten reads: `MARK` in `card-line.ts`, character for character.

Each item is a lookahead, so an unclosed opener does not backtrack. Narrower than `_CLOZE`:
a MathJax `{{c1::\\(x^{2}\\)}}` is a mark to Anki, not to kasten. A code span is read whole (#346).
"""
_SPANS = re.compile(r"\\.|(`+)(?!`).*?(?<!`)\1(?!`)|`+", re.DOTALL)
"""An escape pair, a code span, or a backtick run that closes none, leftmost first.

`ESCAPES` in `card-line.ts` less its `&#58;`. A code span closes at a run of its own
length, as CommonMark reads one, and `\\`` opens nothing.
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

    No line is blank, since `srs.ts` ends a `?` card at one. A line a reader would take
    for format carries a backslash, so it reads as the text it was. A cloze mark stays
    where `cloze` says kasten reads it, and is a `==highlight==` otherwise.
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
        # An inner mark kasten reads stays held. One it does not is the text Anki shows, so
        # a highlight's `====` stays inside the outer answer.
        return bare.get(int(mark[1]), mark[0])

    def keep(match: re.Match[str]) -> str:
        # Flat and out of the parse, so `{{c2::<b>France</b>}}` asks `France`. Ruby stays, and
        # `srs.ts` takes its reading off first. Flat before the test, so `&#123;` breaks a mark
        # as it would when typed (#333).
        flat = _flat(KEPT.sub(inside, match[0]))
        answer = _flat(KEPT.sub(inside, match[1]))
        hint = match[0][match.end(1) - match.start() : -2]
        if cloze and ("::" in answer or (hint and answer.endswith(":"))):
            # Anki splits answer from hint only at a typed `::`, so a decoded `&#58;&#58;`
            # would be a hint to kasten (#335). Schedule comments drop `_flat`'s
            # backslash (#351, #356).
            answer = (
                answer.replace("<!--SR\\:", "<!--SR:")
                .replace("<!--anki\\:", "<!--anki:")
                .replace(":", "&#58;")
            )
            opener = match[0][: match.start(1) - match.start()]
            flat = f"{opener}{answer}{_flat(KEPT.sub(inside, hint))}}}}}"
        # The form the mark takes in code: its text verbatim, no `&#58;`, since `_MARK` reads a
        # code span whole and a `::` in it is no hint (#346).
        opener = match[0][: match.start(1) - match.start()]
        shown = _verbatim(KEPT.sub(inside, match[1]))
        code = f"{opener}{shown}{hint and '::' + _verbatim(KEPT.sub(inside, hint[2:]))}}}}}"
        _settle(coded, code, shown, cloze=cloze)
        if not _settle(kept, flat, answer, cloze=cloze):
            bare[len(kept) - 1] = KEPT.sub(inside, match[1])
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

    lines, in_code = markdown(text)
    if cloze:
        lines = [" ".join(lines)]
    text = "\n".join(_escaped(_COLON.sub(_colon, line)) for line in lines)
    forms = [coded[at] if at in in_code else mark for at, mark in enumerate(kept)]
    text = KEPT.sub(lambda mark: forms[int(mark[1])], text)
    return _HELD.sub(lambda mark: held[int(mark[1])], text)


def _verbatim(text: str) -> str:
    """`text` as a code span, the form `plain` gives a kept mark that sat in code."""
    # The import's marker and a schedule comment keep their backslash in code too, as
    # `_escaped` gives it, so `srs.ts` reads a schedule in code as anywhere else (#351).
    shown = _shown(text)
    return ticked(shown.replace("<!--SR:", "<!--SR\\:").replace("<!--anki:", "<!--anki\\:"))


def _settle(marks: list[str], mark: str, text: str, *, cloze: bool) -> bool:
    """Add a cloze mark to `marks` as `mark` if kasten reads it, else as a highlight of `text`.

    Either way the inner marks it holds go back in. True for the mark kept as a cloze.
    """

    def put(inner: re.Match[str]) -> str:
        return marks[int(inner[1])]

    if cloze and _MARK.fullmatch(mark) is not None:
        marks.append(KEPT.sub(put, mark))
        return True
    marks.append(f"=={KEPT.sub(put, text)}==")
    return False


def _colon(found: re.Match[str]) -> str:
    """A `_COLON` match as written: the text `&#58;` escaped, the rest as it stands.

    Anki shows `&amp;#58;` as the text `&#58;`, which a card shows as a colon (#335) unless
    escaped (#340). Applied to the parsed line, so a tag cannot split it (#348).
    """
    return "\\&#58;" if found[0] == "&#58;" else found[0]


def marks(text: str, keep: Callable[[re.Match[str]], str]) -> str:
    """`text` with every `_MARK` replaced by what `keep` makes of it, innermost first.

    A replacement holds no brace, so an outer mark around a whole inner one now matches (#254).
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


def reads_mark(text: str) -> bool:
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

    Escapes what `_Markdown` escapes elsewhere in the field, and the import's marker, the
    schedule comments and the text `&#58;`, which `suspended()` in `card-line.ts` and
    `readSchedule` in `srs.ts` would otherwise read as the card's own (#351).
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

    The lines `ends_card` lists. A schedule comment takes its backslash inside (`SR` in
    `card-line.ts` matches anywhere), and so does the import's marker, so a re-import does
    not take the text for a card it wrote.
    """
    if (
        line == "?"
        or line.startswith("!suspended")
        or _HEADING.match(line) is not None
        or _ONLY_TAGS.fullmatch(line) is not None
    ):
        line = f"\\{line}"
    return line.replace("<!--SR:", "<!--SR\\:").replace("<!--anki:", "<!--anki\\:")


def ends_card(line: str) -> bool:
    """Whether `srs.ts` `breaks()` would end a `?` card on `line`, so it cannot be a side of one.

    A side's lines are stripped, so blank means empty. A back's schedule line is checked
    apart, since it stops no front.
    """
    return (
        not line
        or line.startswith("!suspended")
        or _HEADING.match(line) is not None
        or _ONLY_TAGS.fullmatch(line) is not None
    )


def undivided(line: str) -> str:
    """`line` with each `::` outside a code span written `:&#58;`, so `divide` finds no divider.

    The `::` `divide` in `card-line.ts` would split at, leftmost first and past
    code spans alone, and `colons` shows the `&#58;` as the colon it was.
    """
    spans = _code(line)
    return re.sub(
        "::", lambda found: found[0] if _in_code(found.start(), spans) else ":&#58;", line
    )


def media_names(*texts: str) -> list[str]:
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
