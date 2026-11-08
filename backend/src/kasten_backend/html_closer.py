"""What closes a page of HTML cut off mid-write, so the scripts appended after it run (#886).

justhtml, a WHATWG parser foreign content and all, judges each close (#1577). A probe script goes
after the page and the close: where its text lands (a tag, a comment, raw text) picks the next
close to try, and once it parses as a script the svg and math elements around it get end tags.
"""

import bisect
import functools
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
_A_START = re.compile(r"<(?:a|nobr)[\t\n\f\r />]", re.IGNORECASE)
_FOREIGN_OBJECT_END = re.compile(r"</foreignobject[\t\n\f\r />]", re.IGNORECASE)
_COMMENT = re.compile(r"<!--(?:>|->|.*?(?:-->|--!>))", re.DOTALL)
_A_END = re.compile(r"</a[\t\n\f\r />]", re.IGNORECASE)
_NOBR_END = re.compile(r"</nobr[\t\n\f\r />]", re.IGNORECASE)
_POINT_END = re.compile(r"</(desc|title|m[ionst]|mtext|annotation-xml)[\t\n\f\r />]", re.IGNORECASE)
_SCOPE = _MARKERS | {"html", "table"}
"""With the points, the elements that bound the spec's "in scope" (#1657)."""
# A value follows an attribute name and `=`; a quote anywhere else is a plain character.
_START_TAG = re.compile(
    r"""<[^\s/>]++(?:[\s/]++|[^\s/>=]++(?:\s*+=\s*+(?:"[^"]*+"|'[^']*+'|[^\s>]*+))?+)*+>"""
)
# As the tokenizer reads it: a name after a space or a quote may start with `=`, a name followed
# by `=` takes a value, and an unquoted value never starts with a quote, so a cut quoted value
# matches no tag.
_END_TAG = re.compile(
    r"""</[^\s/>]++(?:[\s/]++|(?<=[\s/"'])=?+[^\s/>=]*+"""
    r"""(?:\s*+=\s*+(?:"[^"]*+"|'[^']*+'|(?!["'])[^\s>]*+)|(?!\s*=)))*+>"""
)

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
    page = source = _CDATA.sub("<![xdata[", page)
    a = _A_START.search(page)
    foreign = _FOREIGN.search(page)
    if foreign and (
        _SUSPECT.search(page)
        or (a is not None and _POINT_TAG.search(page, a.end()))
        or _POINT_END.search(page, foreign.end())
    ):
        for _ in range(_REWRITES):
            # Only to find the faults: tracking locations changes some parses.
            located = JustHTML(page, sanitize=False, track_node_locations=True).root
            if (fixed := _fixed(source, page, _nodes(located))) is None:
                break
            page = fixed
    return JustHTML(page, sanitize=False).root


def _fixed(source: str, page: str, nodes: list[Node]) -> str | None:
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
    # justhtml closes the point at the token at fault, so it is the first tag after the point's
    # last node; an `</a>` between means the outer `<a>` had gone.
    starts = sorted(
        e.origin_offset
        for e in elements
        if (e.namespace, e.name) == ("html", "a") and e.origin_offset is not None
    )
    a_tags = {
        starts[i]
        for e in elements
        if (e.namespace, e.name) in _POINTS and _ancestor_a(e)
        for last in [_last(page, e)]
        if (i := bisect.bisect_left(starts, last)) < len(starts)
        and not _A_END.search(page, last, starts[i])
    }
    end_tags = {
        m.start()
        for e in elements
        if (e.namespace, e.name) == ("html", "foreignobject")
        and (m := _FOREIGN_OBJECT_END.search(page, _last(page, e)))
    }
    point = min(
        (e.origin_offset or 0 for e in elements if (e.namespace, e.name) in _POINTS),
        default=len(page),
    )
    nobr = functools.partial(_nobr_fix, source)
    nobr_tags = {e.origin_offset for e in elements if (e.namespace, e.name) == ("html", "nobr")} | {
        m.start() for m in _NOBR_END.finditer(page)
    }
    # Only a point holding an html element can meet its own end tag with an html current node.
    names = {
        e.name.lower()
        for e in elements
        if (e.namespace, e.name) in _POINTS
        and any(isinstance(n, Element) and n.namespace == "html" for n in _nodes(e)[1:])
    }
    point_ends = {m.start() for m in _POINT_END.finditer(page, point) if m[1].lower() in names}
    tags = sorted(
        [(at, _a_fix) for at in a_tags if at < image]
        + [(at, _end_fix) for at in end_tags if at < image]
        + [(at, nobr) for at in nobr_tags if at is not None and point < at < image]
        + [(at, _point_end_fix) for at in point_ends if at < image]
    )
    # Each inner `nobr` tag and point end tag needs its own rewrite, so a run of them goes in one
    # pass (_REWRITES).
    runs = (nobr, _point_end_fix)
    fixed = None
    for at, fix in tags:
        if fixed is not None and fix not in runs:
            return fixed
        if (found := fix(fixed or page, at)) is not None and fix not in runs:
            return found
        fixed = found or fixed
    if fixed is not None:
        return fixed
    return page[:image] + "<img  " + page[image + 6 :] if image < len(page) else None


def _last(page: str, element: Element) -> int:
    """Where the source of the element's last node ends, past any tag-like text inside it."""
    node = max(_nodes(element), key=lambda n: n.origin_offset or 0)
    at = node.origin_offset or 0
    if isinstance(node, Element):
        tag = _START_TAG.match(page, at)
        return tag.end() if tag else at
    if isinstance(node, Comment):
        found = _COMMENT.match(page, at)
        end = found.end() if found else page.find(">", at)
    elif (
        isinstance(node, Text)
        and isinstance(node.parent, Element)
        and (node.parent.namespace, node.parent.name in _RAW) == ("html", True)
    ):
        found = re.compile(f"</{node.parent.name}", re.IGNORECASE).search(page, at)
        end = found.start() if found else -1
    else:
        return at
    return len(page) if end < 0 else end


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


def _point_end_fix(page: str, at: int) -> str | None:
    """A point's own end tag with an html current node, which Chrome ignores (#1670).

    The in-body rules stop at the point, a special element; justhtml pops it. The tag becomes a
    bogus comment, blank through the tag's real end, past any `>` in a quoted value.
    """
    if (tag := _END_TAG.match(page, at)) is None:
        return None
    stack = _open(page[:at])
    name = re.split(r"[\t\n\f\r />]", page[at + 2 : at + 18], maxsplit=1)[0].lower()
    if not stack[1:] or stack[1].namespace != "html":
        return None
    foreign = False
    for node in stack[1:]:
        foreign = foreign or node.namespace != "html"
        if node.name.lower() == name:
            blank = "<?" + " " * (tag.end() - at - 3) + ">"
            return page[:at] + blank + page[tag.end() :] if foreign else None
    return None


def _nobr_fix(source: str, page: str, at: int) -> str | None:
    """A `nobr` tag that justhtml reads against a `nobr` out of the spec's scope (#1657).

    justhtml takes any open `nobr` off the stack, where Chrome keeps the outer one and opens a
    new one. The inner tag becomes a `<font`, and its end tag with it; an end tag that reaches
    no `nobr` in scope becomes a bogus comment.
    """
    stack = _open(page[:at])
    bounded, target = False, None
    for node in stack[1:]:
        if node.namespace != "html" or node.name in _SCOPE:
            bounded = bounded or node.namespace == "html" or (node.namespace, node.name) in _POINTS
            continue
        start = node.origin_offset
        if node.name != "nobr" and source[start or 0 : (start or 0) + 5].lower() == "<nobr":
            target = target or ("bogus" if bounded else "close")
        elif node.name == "nobr":
            if not bounded and target is None:
                return None
            if not page.startswith("</", at):
                return page[:at] + "<font" + page[at + 5 :]
            if target == "close":
                return page[:at] + "</font" + page[at + 6 :]
            return page[:at] + "<?" + page[at + 2 :]
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
