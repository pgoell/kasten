"""What closes a page of HTML cut off mid-write, so the scripts appended after it run (#886).

The page is read by the WHATWG tokenizer's states, and open `<svg>` and `<math>` by the tree
builder's rules for foreign content (#1559), with the html elements opened inside them (#1560).
"""

import re

_RAW_TEXT = (
    "script",
    "style",
    "textarea",
    "title",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
    "noscript",
)
"""Elements whose text runs to their own end tag, so a `<` inside one opens nothing."""

_OPEN = re.compile(r"<(!--|[!?]|/[A-Za-z]|/|[A-Za-z])")
_TAG_NAME = re.compile(r"[^\t\n\f\r />]*")
_NAME = re.compile(r"=?[^\t\n\f\r />=]*")
_UNQUOTED = re.compile(r"[^\t\n\f\r >]*")
_COMMENT_END = re.compile(r"--!?>")
_SPACE = " \t\n\f\r"
"""HTML's whitespace, which the classes above spell out: `\\s` would take in a no-break space."""
_ATTR = re.compile(
    r"(=?[^\t\n\f\r />=]+)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(\"[^\"]*\"|'[^']*'|[^\t\n\f\r >]*))?"
)


def _past(pattern: re.Pattern[str], page: str, at: int) -> int:
    """Where a run of `pattern` from `at` ends. Each pattern here matches an empty run too."""
    found = pattern.match(page, at)
    return found.end() if found else at


def _value_end(page: str, at: int) -> int | str:
    """Where the value after an `=` at `at` ends, or what closes the tag if the page ends first."""
    while at < len(page) and page[at] in _SPACE:
        at += 1
    if at == len(page):
        return ">"
    if page[at] in "\"'":
        close = page.find(page[at], at + 1)
        return page[at] + ">" if close == -1 else close + 1
    # A `>` here ends the tag with no value, and the caller reads it.
    return _past(_UNQUOTED, page, at) if page[at] != ">" else at


def _tag_end(page: str, at: int) -> tuple[int | str, bool]:
    """Where a tag ends, from just past its name, or what closes it, and whether it closes itself.

    The states are the WHATWG tokenizer's: an `=` starts a value only after a name, and an unquoted
    value takes a `/` in, so `<svg width=10/>` stays open.
    """
    named = slash = False
    while at < len(page):
        char = page[at]
        if char == ">":
            return at + 1, slash
        slash = char == "/"
        if char in _SPACE or slash:
            named = named and not slash
            at += 1
            continue
        if char == "=" and named:
            end = _value_end(page, at + 1)
            if isinstance(end, str):
                return end, False
            at, named = end, False
            continue
        at, named = _past(_NAME, page, at), True
    return ">", False


_ESCAPE = re.compile(r"(<!--)|(-->)|<(/?)script(?=[\t\n\f\r />]|\Z)", re.IGNORECASE)


def _script_end(page: str, at: int) -> int | None:
    """Where the `</script` that ends a script's text ends, or None when the page ends first.

    The tokenizer's script states: a `<script` after `<!--` starts a double escape, inside which a
    `</script` ends only the double escape and `-->` ends both.
    """
    escaped = double = False
    while (found := _ESCAPE.search(page, at)) is not None:
        at = found.end()
        if found.group(1):
            # The `--` of `<!--` may close it again: `<!-->`.
            escaped, at = True, found.start() + 2
        elif found.group(2):
            escaped = double = False
        elif found.group(3):
            if not double:
                return at
            double = False
        else:
            double = escaped
    return None


def _raw_text_end(page: str, end: int | str, name: str) -> int | str:
    """Where the text of a raw text element whose tag ends at `end` ends, or what closes it."""
    if isinstance(end, str):
        return end + f"</{name}>"
    if name == "script":
        closing = _script_end(page, end)
        if closing is None:
            # Only a double escape needs the `-->` first, and `</script>` alone keeps #886's bytes.
            return "</script>" if _script_end(page + "</script>", end) else "--></script>"
        return _tag_end(page, closing)[0]
    closing = re.compile(rf"</{name}(?=[\t\n\f\r />]|\Z)", re.IGNORECASE).search(page, end)
    return f"</{name}>" if closing is None else _tag_end(page, closing.end())[0]


def _markup_end(page: str, found: re.Match[str], foreign: bool) -> int | str:
    """Where a comment, doctype or CDATA section ends, or what closes it."""
    kind, at = found.group(1), found.end()
    if kind == "!--" and page.startswith((">", "->"), at):
        return page.index(">", at) + 1
    if kind == "!--":
        closing = _COMMENT_END.search(page, at)
        return "-->" if closing is None else closing.end()
    if kind == "!" and foreign and page.startswith("[CDATA[", at):
        closing = page.find("]]>", at + 7)
        return "]]>" if closing == -1 else closing + 3
    # A doctype, a bogus comment, or a `</` with no name, each ended by the next `>`.
    closing = page.find(">", at)
    return ">" if closing == -1 else closing + 1


_FOREIGN = ("svg", "math")
_TEXT_POINTS = ("mi", "mo", "mn", "ms", "mtext")
_BREAKOUT = frozenset(
    (
        "b",
        "big",
        "blockquote",
        "body",
        "br",
        "center",
        "code",
        "dd",
        "div",
        "dl",
        "dt",
        "em",
        "embed",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "head",
        "hr",
        "i",
        "img",
        "li",
        "listing",
        "menu",
        "meta",
        "nobr",
        "ol",
        "p",
        "pre",
        "ruby",
        "s",
        "small",
        "span",
        "strong",
        "strike",
        "sub",
        "sup",
        "table",
        "tt",
        "u",
        "ul",
        "var",
    )
)
"""The start tags that end foreign content, `<font>` too when it has a color, face or size."""

_VOID = frozenset(
    (
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "source",
        "track",
        "wbr",
        "param",
        "keygen",
        "basefont",
        "bgsound",
        "frame",
        "image",
        "html",
        "head",
        "body",
    )
)
"""Html start tags that leave nothing open, `<body>` and its kin only adding attributes."""

_FORMATTING = frozenset(
    (
        "a",
        "b",
        "big",
        "code",
        "em",
        "font",
        "i",
        "nobr",
        "s",
        "small",
        "strike",
        "strong",
        "tt",
        "u",
    )
)
"""Html elements the tree builder reopens after the adoption agency closes them."""

_MARKERS = frozenset(("applet", "caption", "marquee", "object", "td", "template", "th"))

_IMPLIED = ("dd", "dt", "li", "optgroup", "option", "p", "rb", "rp", "rt", "rtc")

_CLOSES_P = frozenset(
    (
        "address",
        "article",
        "aside",
        "blockquote",
        "center",
        "details",
        "dialog",
        "dir",
        "div",
        "dl",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "header",
        "hgroup",
        "main",
        "menu",
        "nav",
        "ol",
        "p",
        "search",
        "section",
        "summary",
        "ul",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "pre",
        "listing",
        "form",
        "xmp",
        "hr",
        "table",
        "li",
        "dd",
        "dt",
    )
)
"""Html start tags that close an open `<p>`."""

_HEADINGS = ("h1", "h2", "h3", "h4", "h5", "h6")

_SCOPE = frozenset(
    ("applet", "caption", "html", "marquee", "object", "table", "td", "template", "th")
)
"""Html elements that end the scope an end tag such as `</div>` looks for its element in."""

_SPECIAL = (_CLOSES_P - {"dialog"}) | _SCOPE
_SPECIAL |= {"button", "colgroup", "select", "tbody", "tfoot", "thead", "tr"}
"""The spec's special html elements that can stay open, which stop an end tag's search."""

_STOPS = {
    **dict.fromkeys(_CLOSES_P | {"applet", "button", "marquee", "object"}, _SCOPE),
    "p": _SCOPE | {"button"},
    "li": _SCOPE | {"ol", "ul"},
}
"""What stops the search for the element an end tag closes; `_SPECIAL` for the rest."""

_Open = tuple[str, str, str]
"""An open element inside `<svg>` or `<math>`: its lowercased name, its namespace (`html` for an
html element), and `html` or `text` where it holds html; an html element holds html.
"""


def _point(namespace: str, name: str, attrs: dict[str, str]) -> str:
    """Whether an element holds html again, as an html or a MathML text integration point."""
    if namespace == "svg" and name in ("foreignobject", "desc", "title"):
        return "html"
    if namespace == "math" and name in _TEXT_POINTS:
        return "text"
    html = attrs.get("encoding", "").lower() in ("text/html", "application/xhtml+xml")
    return "html" if namespace == "math" and name == "annotation-xml" and html else ""


def _as_html(stack: list[_Open], name: str) -> bool:
    """Whether a start tag goes by the html rules, and not those for foreign content."""
    if not stack:
        return True
    top, namespace, point = stack[-1]
    if point == "text":
        return name not in ("mglyph", "malignmark")
    return point == "html" or (namespace == "math" and top == "annotation-xml" and name == "svg")


def _attrs(text: str) -> dict[str, str]:
    """A tag's attributes from the text after its name, the first of a name winning."""
    attrs: dict[str, str] = {}
    for found in _ATTR.finditer(text):
        attrs.setdefault(found.group(1).lower(), (found.group(2) or "").strip("\"'"))
    return attrs


def _find(
    stack: list[_Open], names: tuple[str, ...], stops: frozenset[str], *, past_points: bool = False
) -> int | None:
    """The nearest open html element in `names`; a point or one in `stops` hides it."""
    for at in range(len(stack) - 1, -1, -1):
        entry, namespace, point = stack[at]
        if namespace == "html" and entry in names:
            return at
        if (namespace != "html" and point and not past_points) or (
            namespace == "html" and entry in stops
        ):
            return None
    return None


def _close(stack: list[_Open], names: tuple[str, ...], stops: frozenset[str]) -> None:
    if (at := _find(stack, names, stops)) is not None:
        del stack[at:]


def _adopt(stack: list[_Open], name: str) -> None:
    """The adoption agency for a new `<a>` or `<nobr>`, which closes the open one.

    Out of scope only it goes; else so does each element above it neither special nor formatting.
    An `<a>` is looked for back to the last marker, which no point sets.
    """
    stops = _MARKERS if name == "a" else _SCOPE
    if (at := _find(stack, (name,), stops, past_points=name == "a")) is None:
        return
    if _find(stack, (name,), _SCOPE) != at:
        del stack[at]
        return
    kept: list[_Open] = []
    run: list[_Open] = []
    for entry in stack[at + 1 :]:
        if entry[0] not in _SPECIAL:
            run.append(entry)
            continue
        # The inner loop keeps formatting only among the three nodes nearest each special one.
        kept += [*(e for e in run[-3:] if e[0] in _FORMATTING), entry]
        run = []
    stack[at:] = kept + [entry for entry in run if entry[0] in _FORMATTING]


def _html_start(stack: list[_Open], name: str) -> bool:
    """Close what an html start tag closes by the in-body rules; False when they ignore it."""
    # The form pointer: a form inside an open one is ignored.
    if name == "form" and _find(stack, ("form",), frozenset()) is not None:
        return False
    if name in _CLOSES_P:
        _close(stack, ("p",), _STOPS["p"])
    if name in ("li", "dd", "dt"):
        items = ("li",) if name == "li" else ("dd", "dt")
        _close(stack, items, _SPECIAL - {"address", "div", "p"})
    if name in _HEADINGS and stack and stack[-1][0] in _HEADINGS and stack[-1][1] == "html":
        stack.pop()
    if name in ("option", "optgroup") and stack and stack[-1][:2] == ("option", "html"):
        stack.pop()
    if name == "button":
        _close(stack, ("button",), _SCOPE)
    if name in ("a", "nobr"):
        _adopt(stack, name)
    return True


def _start(stack: list[_Open], name: str, attrs: dict[str, str], self_closing: bool) -> bool:
    """Keep `stack` the open elements after a start tag; True when it went as html.

    The spec ignores the `/` of an html start tag, so `<div/>` stays open.
    """
    breakout = name in _BREAKOUT or (name == "font" and attrs.keys() & {"color", "face", "size"})
    if not _as_html(stack, name) and breakout:
        while stack and not stack[-1][2]:
            stack.pop()
    if _as_html(stack, name):
        if not _html_start(stack, name):
            return True
        if name in _FOREIGN and not self_closing:
            stack.append((name, name, ""))
        elif stack and name not in _VOID and name not in _RAW_TEXT:
            stack.append((name, "html", "html"))
        return True
    if not self_closing:
        namespace = stack[-1][1]
        stack.append((name, namespace, _point(namespace, name, attrs)))
    return False


def _end(stack: list[_Open], name: str) -> None:
    """Keep `stack` the open elements after an end tag; `</p>` and `</br>` break out.

    Foreign elements match from the top down to the first html element. From there the html
    rules take it, where a point or a special element stops the search, so `</svg>` cannot close
    past an open `<div>`.
    """
    if name in ("p", "br"):
        while stack and not stack[-1][2]:
            stack.pop()
    for at in range(len(stack) - 1, -1, -1):
        if stack[at][1] == "html":
            break
        if stack[at][0] == name:
            del stack[at:]
            return
    if name == "form":
        # It removes only the form, after the implied end tags on top.
        if (at := _find(stack, ("form",), _SCOPE)) is not None:
            while stack[-1][1] == "html" and stack[-1][0] in _IMPLIED:
                stack.pop()
            del stack[at]
        return
    # Any heading's end tag closes whichever heading is open.
    _close(stack, _HEADINGS if name in _HEADINGS else (name,), _STOPS.get(name, _SPECIAL))


def closer(page: str) -> tuple[int, str]:
    """Where the appended scripts go in a page cut off mid-write, and what closes it before them.

    Appended scripts would land inside an open tag, comment, raw text, `<svg>` or `<math>` and not
    run. Nothing ends a `<plaintext>`, so they go ahead of it (#1489). A whole page needs nothing.
    """
    at, stack = 0, []
    while (found := _OPEN.search(page, at)) is not None:
        kind = found.group(1)
        if not kind[-1].isalpha():
            end = _markup_end(page, found, bool(stack) and stack[-1][1] != "html")
        else:
            name = page[found.end() - 1 : _past(_TAG_NAME, page, found.end())].lower()
            html = kind[0] != "/" and _as_html(stack, name)
            if html and name == "plaintext":
                return found.start(), ""
            tag_at = found.end() + len(name) - 1
            end, self_closing = _tag_end(page, tag_at)
            if kind[0] == "/" and not isinstance(end, str):
                _end(stack, name)
            elif not isinstance(end, str):
                html = _start(stack, name, _attrs(page[tag_at : end - 1]), self_closing)
            if html and name in _RAW_TEXT:
                end = _raw_text_end(page, end, name)
        if isinstance(end, str):
            return len(page), end + _closers(stack)
        at = end
    return len(page), _closers(stack)


def _closers(stack: list[_Open]) -> str:
    return "".join(f"</{name}>" for name, _, _ in reversed(stack) if name in _FOREIGN)
