"""A field's HTML read into markdown, a line at a time, with code spans and placeholders kept.

The parser keeps the formatting a card holds and drops every other tag. `anki_html`
tidies the output and reads the placeholders this module's `KEPT` finds.
"""

import re
from html.parser import HTMLParser

KEPT = re.compile("([0-9]+)")
"""The mark `plain` holds a cloze mark's place with, as `_HELD` does a link's."""
_SPACE = ""
"""A space the whitespace pass in `markdown` leaves alone: a list's indent and `<pre>`'s own."""
_BLOCK = frozenset(
    {"br", "div", "p", "li", "ul", "ol", "pre", "blockquote", "tr", "hr"}
    | {f"h{level}" for level in range(1, 7)}
)
"""The tags a line ends at, either side of them: a browser starts a new line for each."""
_BOLD = frozenset({"b", "strong", "u"})
"""Underline among them, since markdown has no underline and bold is the nearest stress."""
_ITALIC = frozenset({"i", "em"})
_RUBY = frozenset({"rp", "ruby", "rt"})
"""Ruby and its parts, which a card keeps as HTML but for the parentheses."""


def _ticks(code: str) -> str:
    """`code` as inline code, its fence one backtick longer than any run inside it."""
    longest = max((len(run) for run in re.findall("`+", code)), default=0)
    pad = " " if code.startswith("`") or code.endswith("`") else ""
    return f"{'`' * (longest + 1)}{pad}{code}{pad}{'`' * (longest + 1)}"


def ticked(line: str) -> str:
    """`line` as inline code, a span either side of each cloze mark `plain` holds.

    A mark stays out of the code, since kasten reads no mark inside a code span (#346).
    The spaces at either end of a piece stay outside its span.
    """
    parts = KEPT.split(line)
    if len(parts) == 1:
        return _ticks(line) if line.strip() else line
    for at in range(0, len(parts), 2):
        piece = parts[at]
        core = piece.strip(f" {_SPACE}")
        if core:
            start = piece.index(core)
            parts[at] = f"{piece[:start]}{_ticks(core)}{piece[start + len(core) :]}"
    for at in range(1, len(parts), 2):
        parts[at] = f"{parts[at]}"
    return "".join(parts)


def markdown(text: str) -> tuple[list[str], set[int]]:
    """`text` as the lines a card line holds, with the cloze marks that sat in code.

    The lines come back tidied and without blanks. The set is the marks `plain`
    holds that sat in code, which it writes in their code form.
    """
    parser = _Markdown()
    parser.feed(text)
    parser.close()
    # `split()` counts the non-breaking space `&nbsp;` as whitespace, which is
    # what turns it into an ordinary space.
    lines = [" ".join(line.split()).replace(_SPACE, " ") for line in parser.text().split("\n")]
    return [line for line in lines if line], parser.coded


class _Markdown(HTMLParser):
    """A field's HTML as markdown, a line break apart, and not yet tidied.

    Keeps bold, italic, links, inline code, lists and ruby, and drops every other tag. A
    `<pre>` is inline code a line at a time, not a fence, since both readers skip cards in a fence.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.depth = {"**": 0, "*": 0}
        self.opened: dict[str, int] = {}
        """Where each open emphasis started in `out`, so its close can wrap what came after."""
        self.lists: list[int | None] = []
        """The open lists, innermost last: the next number of an `<ol>`, None for a `<ul>`."""
        self.links: list[tuple[int, str | None]] = []
        self.code: list[int] = []
        self.coded: set[int] = set()
        """The cloze marks `plain` holds that sat in code, which it writes in their code form."""
        self.pre: int | None = None
        self.skip = 0
        self.ruby = 0

    def text(self) -> str:
        return "".join(self.out)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _BLOCK:
            self.out.append("\n")
        marker = "**" if tag in _BOLD else "*" if tag in _ITALIC else None
        if marker is not None:
            self._open_mark(marker)
        elif tag in ("ul", "ol"):
            self.lists.append(1 if tag == "ol" else None)
        elif tag == "li":
            self._item()
        elif tag == "a":
            self.links.append((len(self.out), dict(attrs).get("href")))
        elif tag == "code" and self.pre is None:
            self.code.append(len(self.out))
        elif tag == "pre" and self.pre is None:
            self.pre = len(self.out)
        elif tag in _RUBY:
            self._open_ruby(tag)

    def handle_endtag(self, tag: str) -> None:
        marker = "**" if tag in _BOLD else "*" if tag in _ITALIC else None
        if marker is not None and self.depth[marker] > 0:
            self._close_mark(marker)
        elif tag in ("ul", "ol") and self.lists:
            self.lists.pop()
        elif tag == "a" and self.links:
            self._close_link()
        elif tag == "code" and self.code:
            self._close_code()
        elif tag == "pre" and self.pre is not None:
            self._close_pre(self.pre)
        elif tag in _RUBY:
            self._close_ruby(tag)
        if tag in _BLOCK:
            self.out.append("\n")

    def _open_mark(self, marker: str) -> None:
        self.depth[marker] += 1
        # Once, so `<b><u>x</u></b>` is not `****x****`.
        if self.depth[marker] == 1:
            self.opened[marker] = len(self.out)

    def _close_mark(self, marker: str) -> None:
        self.depth[marker] -= 1
        if self.depth[marker] == 0:
            self._wrap(self.opened.pop(marker), marker)

    def _open_ruby(self, tag: str) -> None:
        if tag == "rp":
            # The parentheses a browser without ruby shows, which kasten draws.
            self.skip += 1
        elif tag == "ruby":
            self.ruby += 1
            self.out.append("<ruby>")
        elif self.ruby:
            self.out.append("<rt>")

    def _close_ruby(self, tag: str) -> None:
        if tag == "rp" and self.skip:
            self.skip -= 1
        elif tag == "rt" and self.ruby:
            self.out.append("</rt>")
        elif tag == "ruby" and self.ruby:
            self.ruby -= 1
            self.out.append("</ruby>")

    def _item(self) -> None:
        number = self.lists[-1] if self.lists else None
        if number is not None:
            self.lists[-1] = number + 1
        indent = _SPACE * 2 * max(len(self.lists) - 1, 0)
        self.out.append(f"{indent}{'- ' if number is None else f'{number}. '}")

    def _close_link(self) -> None:
        at, href = self.links.pop()
        # A link holds no line break, so a break in its text is a space.
        inner = " ".join("".join(self.out[at:]).split("\n"))
        if href and inner.strip():
            # Parens and spaces would end the link early, as in `_LINK_SAFE`.
            address = href.replace(" ", "%20").replace("(", "%28").replace(")", "%29")
            self.out[at:] = [f"[{inner.strip()}]({address})"]

    def _close_code(self) -> None:
        at = self.code.pop()
        inner = "".join(self.out[at:])
        self.coded.update(map(int, KEPT.findall(inner)))
        lines = inner.split("\n")
        self.out[at:] = ["\n".join(ticked(line) if line.strip() else line for line in lines)]

    def _close_pre(self, at: int) -> None:
        inner = "".join(self.out[at:]).replace(" ", _SPACE).replace("\t", _SPACE)
        self.coded.update(map(int, KEPT.findall(inner)))
        lines = [line for line in inner.split("\n") if line.replace(_SPACE, "").strip()]
        self.out[at:] = ["\n", *(f"{ticked(line)}\n" for line in lines)]
        self.pre = None

    def handle_data(self, data: str) -> None:
        if self.skip:
            return
        if self.pre is None:
            data = re.sub(r"\s+", " ", data)
        # A code span is drawn verbatim, so nothing in it is escaped (#343).
        if self.pre is None and not self.code:
            # The backslash first, in one pass, so a lone one Anki shows is no escape (#342),
            # and the ones written here are not doubled.
            data = re.sub(r"[\\*_`\[]", r"\\\g<0>", data)
            data = re.sub("={2,}", lambda run: "\\=" * len(run[0]), data)
            # Anywhere, since `suspended()` in `card-line.ts` reads the token
            # after any space and would park a card that only names it.
            data = data.replace("!suspended", "\\!suspended")
        self.out.append(data)

    def _wrap(self, at: int, marker: str) -> None:
        """Everything since `at` in `marker`, line by line, the spaces at either end left outside.

        `** f **` is no bold to markdown, and an emphasis does not run over a
        line break.
        """
        lines: list[str] = []
        for line in "".join(self.out[at:]).split("\n"):
            core = line.strip()
            start = len(line) - len(line.lstrip())
            end = start + len(core)
            lines.append(f"{line[:start]}{marker}{core}{marker}{line[end:]}" if core else line)
        self.out[at:] = ["\n".join(lines)]
