"""What closes a page of HTML cut off mid-write, so the scripts appended after it run (#886).

justhtml, a WHATWG parser foreign content and all, judges each close (#1577). A probe script goes
after the page and the close: where its text lands (a tag, a comment, raw text) picks the next
close to try, and once it parses as a script the svg and math elements around it get end tags.
"""

import bisect
import re

from justhtml import Comment, Element, JustHTML, Node, Text

_PROBE_TEXT = "kasten-closer-probe-1577"
_PROBE = f"<script>{_PROBE_TEXT}</script>"
_ROUNDS = 4

_RAW = frozenset(
    ("script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript")
)
"""Elements whose text runs to their own end tag."""

_TAG = ((">", False), ('">', False), ("'>", False), ("]]>", False))
"""What may end a tag, a doctype or a CDATA section, the shortest first, each with whether it
counts only once it frees the probe.
"""


def _nodes(node: Node) -> list[Node]:
    found: list[Node] = []
    todo = [node]
    while todo:
        found.append(node := todo.pop())
        todo.extend(reversed(getattr(node, "children", None) or []))
    return found


def _text(element: Element) -> str:
    return "".join(child.data for child in element.children if isinstance(child, Text))


def _normal(page: str) -> str:
    return page.replace("\r\n", "\n").replace("\r", "\n")


class _Read:
    """One parse of the page so far with the probe after it, and where the probe landed."""

    def __init__(self, page: str) -> None:
        self.page = page + _PROBE
        nodes = _nodes(JustHTML(self.page, sanitize=False).root)
        self.probe = next(
            (
                node
                for node in nodes
                if isinstance(node, Element)
                and node.name == "script"
                and _text(node) == _PROBE_TEXT
            ),
            None,
        )
        self.kind, self.data = "lost", ""
        self.name: tuple[str, str | None] | None = None
        for node in nodes:
            data = node.data if isinstance(node, Text | Comment) else None
            if isinstance(data, str) and _PROBE_TEXT in data:
                self.kind = "text" if isinstance(node, Text) else "comment"
                if isinstance(node, Text) and node.parent is not None:
                    self.name = (node.parent.name, node.parent.namespace)
                self.data = data
                break
            if isinstance(node, Element) and _PROBE_TEXT in repr(node.attrs):
                self.kind = "tag"
                break
        self.family = (self.kind, self.name, self.data.endswith(_PROBE))

    def candidates(self) -> tuple[tuple[str, bool], ...]:
        """The closes to try, each with whether it counts only once it frees the probe."""
        if self.kind == "text" and self.name and self.name[1] == "html" and self.name[0] in _RAW:
            # A `</script` inside a double escape ends only the escape, which `-->` ends first.
            return ((">", True), (f"</{self.name[0]}>", True), ("-->", False))
        if self.kind == "comment":
            opened = _normal(self.page)[: -len(self.data)]
            return (("-->", False),) if opened.endswith("<!--") else ((">", False),)
        return _TAG

    def plaintext_at(self) -> int | None:
        """Where a `<plaintext>` that took the probe in starts, in the page as given."""
        if self.name != ("plaintext", "html"):
            return None
        normal = _normal(self.page)
        at = normal.lower().rfind("<plaintext", 0, len(normal) - len(self.data))
        # The parser reads each `\r\n` as one `\n`.
        crlfs = [found.start() - n for n, found in enumerate(re.finditer("\r\n", self.page))]
        return at + bisect.bisect_left(crlfs, at)


def _closers(probe: Element) -> str:
    """An end tag for each svg and math element around the probe, the nearest first."""
    closers, node = [], probe.parent
    while isinstance(node, Element):
        if node.name in ("svg", "math") and node.namespace != "html":
            closers.append(f"</{node.name}>")
        node = node.parent
    return "".join(closers)


def closer(page: str) -> tuple[int, str]:
    """Where the appended scripts go in a page cut off mid-write, and what closes it before them.

    Appended scripts would land inside an open tag, comment, raw text, `<svg>` or `<math>` and not
    run. Nothing ends a `<plaintext>`, so they go ahead of it (#1489). A whole page needs nothing.
    """
    close, read = "", _Read(page)
    for _ in range(_ROUNDS):
        if (at := read.plaintext_at()) is not None:
            return at, ""
        if read.probe is not None:
            return len(page), close + _closers(read.probe)
        for candidate, frees in read.candidates():
            tried = _Read(page + close + candidate)
            moved = tried.family != read.family or tried.plaintext_at() is not None
            if tried.probe is not None or (moved and not frees):
                close, read = close + candidate, tried
                break
        else:
            # The parser cannot tell, as where it parts from the spec: the shortest close.
            return len(page), close + read.candidates()[0][0]
    return len(page), close
