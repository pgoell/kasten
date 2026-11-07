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

_POINTS = frozenset(
    (
        *(("svg", name) for name in ("foreignObject", "desc", "title")),
        *(("math", name) for name in ("mi", "mo", "mn", "ms", "mtext", "annotation-xml")),
    )
)
_MARKERS = frozenset(("applet", "caption", "marquee", "object", "td", "template", "th"))
"""Elements that put a marker on the list of active formatting elements."""

_MARK = "kasten-closer-mark"
_REWRITES = 16
_FOREIGN = re.compile("<(?:svg|math)", re.IGNORECASE)
_SUSPECT = re.compile("<image|</foreignobject", re.IGNORECASE)
_POINT_TAG = re.compile(
    r"<(?:foreignobject|desc|title|m[ionst]|mtext|annotation-xml)[\t\n\f\r />]", re.IGNORECASE
)
_CDATA = re.compile(r"<!\[(?!CDATA\[)(?i:cdata)\[")
_A_START = re.compile(r"<a[\t\n\f\r />]", re.IGNORECASE)
_FOREIGN_OBJECT_END = re.compile(r"</foreignobject[\t\n\f\r />]", re.IGNORECASE)
_START_TAG = re.compile(r"""<(?:"[^"]*"|'[^']*'|[^"'>])*>""")

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


def _parse(page: str) -> Node:
    """The tree justhtml builds, each token where it parts from Chrome rewritten first (#1652).

    A rewrite keeps the length, so offsets into the page hold.
    """
    # `[CDATA[` matches case-sensitively; justhtml reads `[cdata[` as a CDATA section.
    page = _CDATA.sub("<![xdata[", page)
    a = _A_START.search(page)
    if _FOREIGN.search(page) and (
        _SUSPECT.search(page) or (a is not None and _POINT_TAG.search(page, a.end()))
    ):
        for _ in range(_REWRITES):
            # Only to find the faults: tracking locations changes some parses.
            located = JustHTML(page, sanitize=False, track_node_locations=True).root
            if (fixed := _fixed(page, _nodes(located))) is None:
                break
            page = fixed
    return JustHTML(page, sanitize=False).root


def _fixed(page: str, nodes: list[Node]) -> str | None:
    """The page with its first token at fault rewritten, or None when there is none."""
    elements = [node for node in nodes if isinstance(node, Element)]
    # The in-body rules make `<image>` an `<img>`; justhtml misses it inside a point.
    image = min(
        (
            e.origin_offset
            for e in elements
            if (e.namespace, e.name) == ("html", "image")
            and e.origin_offset is not None
            and page[e.origin_offset : e.origin_offset + 6].lower() == "<image"
        ),
        default=len(page),
    )
    html_point = min(
        (
            e.origin_offset
            for e in elements
            if (e.namespace, e.name) == ("html", "foreignobject") and e.origin_offset is not None
        ),
        default=len(page),
    )
    # justhtml closes the point at the inner `<a>`, so it is the first after the point's last tag.
    behind = (
        _A_START.search(page, max(n.origin_offset or 0 for n in _nodes(e)))
        for e in elements
        if (e.namespace, e.name) in _POINTS and _ancestor_a(e)
    )
    tags = sorted(
        [(m.start(), _a_fix) for m in behind if m is not None and m.start() < image]
        + [(m.start(), _end_fix) for m in _FOREIGN_OBJECT_END.finditer(page, html_point, image)]
    )
    for at, fix in tags:
        if (fixed := fix(page, at)) is not None:
            return fixed
    return page[:image] + "<img  " + page[image + 6 :] if image < len(page) else None


def _ancestor_a(element: Element) -> bool:
    node = element.parent
    while isinstance(node, Element):
        if (node.namespace, node.name) == ("html", "a"):
            return True
        node = node.parent
    return False


def _open(prefix: str) -> list[Element]:
    """A marker after the prefix and its ancestors, which stand for the open elements."""
    nodes = _nodes(JustHTML(prefix + f"<{_MARK}>", sanitize=False, track_node_locations=True).root)
    node = next((n for n in nodes if isinstance(n, Element) and n.name == _MARK), None)
    found: list[Element] = []
    while isinstance(node, Element):
        found.append(node)
        node = node.parent
    return found


def _a_fix(page: str, at: int) -> str | None:
    """An `<a>` past a point takes the outer `<a>` off the stack and leaves the point open.

    justhtml's adoption agency closes the point instead; blanking the outer tag gives that stack.
    """
    stack = _open(page[:at])
    if not stack or stack[0].namespace != "html":
        return None
    point = False
    for node in stack[1:]:
        point = point or (node.namespace, node.name) in _POINTS
        if node.namespace == "html" and node.name in _MARKERS:
            return None
        if (node.namespace, node.name) == ("html", "a"):
            start = node.origin_offset
            tag = None if start is None or not point else _START_TAG.match(page, start)
            if start is None or tag is None:
                return None
            return page[:start] + "<?" + " " * (tag.end() - start - 3) + ">" + page[tag.end() :]
    return None


def _end_fix(page: str, at: int) -> str | None:
    """Chrome gives `</foreignObject>` svg case, so in svg content no html element takes it."""
    stack = _open(page[:at])
    if not stack[1:] or stack[1].namespace != "svg":
        return None
    for node in stack[1:]:
        if node.namespace == "html":
            return page[:at] + "<?" + page[at + 2 :]
        if node.name.lower() == "foreignobject":
            return None
    return None


class _Read:
    """One parse of the page so far with the probe after it, and where the probe landed."""

    def __init__(self, page: str) -> None:
        self.page = page + _PROBE
        nodes = _nodes(_parse(self.page))
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
