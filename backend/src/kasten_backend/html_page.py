"""Assembles one page of HTML out of the vault, for the frame and the tab that show it.

The page script goes first, so it runs before any of the page's own code. The
theme goes where the page's head ends, and only for a page that asks for it.
HTMLParser finds the tokens, since it knows a comment and a script's text from
a tag: a `<meta>` inside a comment does not opt a page in.
"""

import argparse
import base64
import codecs
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

LINKS_OUT = b"""
<script>
document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (link !== null && link.host !== location.host) link.target = "_blank";
  // A link to another page of the vault would load it with no query and so with
  // no theme, so it keeps the frame's query, which holds only theme and palette.
  else if (link !== null && link.pathname.startsWith("/api/html/") && link.search === "")
    link.search = location.search;
}, true);
</script>
"""
"""Sends a link to another site into a tab of its own.

The app's `frame-src` holds the frame to kasten's own pages, so a link that
leaves would load nothing. A `<base target>` would do the same with no script,
and would also send every `#section` of a page's contents to a new tab.
Appended rather than put in the head, because anything ahead of the doctype
drops the page into quirks mode.
"""

PAGE_SCRIPT = (
    b"\n<script>\n" + (Path(__file__).parent / "page_script.js").read_bytes() + b"\n</script>\n"
)
"""Hands the keys a page takes to kasten, and goes in ahead of the page.

Read once at import, as `mcp-instructions.md` is. A file beside the package
rather than a string here, so the script can be read and linted as JavaScript.
In front of the page's own code, so it takes `window.parent` and its key
listener before the page does, and a listener the page adds on its capture
phase runs after this one.
"""

THEMES = ("light", "dark")
PALETTES = ("poel", "russet", "peach", "pansy")
KASTEN_THEME = (Path(__file__).parent / "kasten-theme.css").read_bytes()
"""The design tokens, the same bytes the frontend reads from `styles/`.

`test_page_theme.py` holds this copy to that file. It is also served at
`/api/kasten-theme.css`, a path a plugin can copy at build time.
"""

_FONTS = Path(__file__).parent / "fonts"
_LATIN = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,"
    "U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
)
"""The latin block of each family's own CSS. The other subsets stay out of the page."""


def _face(family: str, style: str, weight: str, file: str) -> str:
    """One `@font-face` rule with the file inlined, so the page asks nobody for it."""
    data = base64.b64encode((_FONTS / file).read_bytes()).decode("ascii")
    return (
        "@font-face {\n"
        f"  font-family: '{family}';\n"
        f"  font-style: {style};\n"
        "  font-display: swap;\n"
        f"  font-weight: {weight};\n"
        f"  src: url(data:font/woff2;base64,{data}) format('woff2-variations');\n"
        f"  unicode-range: {_LATIN};\n"
        "}\n"
    )


STYLES = (
    "<style data-kasten-fonts>"
    + _face("Newsreader Variable", "normal", "200 800", "newsreader-latin-opsz-normal.woff2")
    + _face("Newsreader Variable", "italic", "200 800", "newsreader-latin-opsz-italic.woff2")
    + _face(
        "Instrument Sans Variable", "normal", "400 700", "instrument-sans-latin-wght-normal.woff2"
    )
    + _face(
        "JetBrains Mono Variable", "normal", "100 800", "jetbrains-mono-latin-wght-normal.woff2"
    )
    + "</style><style data-kasten-theme>"
    + KASTEN_THEME.decode("utf-8")
    + "</style>"
)
"""What an opted-in page gets in its head: the fonts, then the tokens, neither in a layer.

Built once at import, as `PAGE_SCRIPT` is. They go last in the head, so a
`:root` rule the page wrote for the same token name is the one overridden.
"""

_BLANK = " \t\n\r\f﻿"
"""What a page may hold before its first real token: whitespace and a byte order mark."""

_INERT = ("noscript", "template")
"""Elements whose contents are not the page's head or body, to a browser."""

_CONTENT_CHARSET = re.compile(r"charset\s*=\s*[\"']?([^\"'\s;]*)")
"""The label in a `content` attribute such as `text/html; charset=ISO-8859-1`."""

_LABEL = re.compile(r"[A-Za-z0-9._:-]{1,40}")
"""What a charset label may hold. It goes into the header as it is, so nothing else may."""


def _encoding(label: str | None) -> str | None:
    """The charset a label names to a browser, or None when no browser knows it."""
    if label is None or _LABEL.fullmatch(label) is None:
        return None
    try:
        name = codecs.lookup(label).name
    except LookupError:
        return None
    # The WHATWG prescan reads a UTF-16 label as UTF-8: a UTF-16 page starts with a
    # byte order mark, and this one has none.
    return "utf-8" if name.startswith("utf-16") else label


class _Tokens(HTMLParser):
    """The few tokens of a page that decide where the pieces go, as string offsets.

    HTMLParser reports each token's start as a line and a column, so the offsets
    are worked out against where each line starts. A comment, the text of a
    script or style and an attribute value never reach the tag handlers, so a
    `<meta>` or a `</head>` inside one of them is not seen.
    """

    def __init__(self, page: str) -> None:
        super().__init__(convert_charrefs=True)
        self.page = page
        self.line_starts = [0, *(match.end() for match in re.finditer("\n", page))]
        self.first: int | None = None
        self.first_is_doctype = False
        self.head_at: int | None = None
        self.meta_end: int | None = None
        # Open `<template>` or `<noscript>` elements. A browser does not treat a
        # meta or a `</head>` inside one as the page's head, so neither counts.
        self.inert = 0
        # The page's own charset, which the header has to name: a browser reads the
        # page's bytes with it, and a header that says otherwise garbles them.
        self.charset: str | None = None
        self.feed(page)
        self.close()

    def _offset(self) -> int:
        line, column = self.getpos()
        return self.line_starts[line - 1] + column

    def _significant(self, doctype: bool = False) -> None:
        """Note the first token that is neither blank, a comment nor a processing instruction.

        A processing instruction (`<?xml ...?>`) and a bogus declaration are
        comments to a browser, so a doctype may come after them and still be
        the first thing the parser makes a token of. They have no handler here,
        so HTMLParser's empty default leaves them out.
        """
        if self.first is None:
            self.first = self._offset()
            self.first_is_doctype = doctype

    def handle_decl(self, decl: str) -> None:
        self._significant(decl.lower().startswith("doctype"))

    def handle_data(self, data: str) -> None:
        if data.strip(_BLANK):
            self._significant()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._significant()
        if tag in _INERT:
            self.inert += 1
        elif self.inert == 0 and tag == "meta":
            values = {name: (value or "").strip().lower() for name, value in attrs}
            if (
                self.meta_end is None
                and values.get("name") == "kasten-theme"
                and values.get("content") == "tokens"
            ):
                self.meta_end = self._offset() + len(self.get_starttag_text() or "")
            # The first label a browser can read is the page's charset. Once one is
            # found, later metas are not read.
            if self.charset is None:
                label = values.get("charset")
                if label is None and values.get("http-equiv") == "content-type":
                    found = _CONTENT_CHARSET.search(values.get("content", ""))
                    label = found.group(1) if found else None
                self.charset = _encoding(label)

    def handle_endtag(self, tag: str) -> None:
        self._significant()
        if tag in _INERT:
            self.inert = max(self.inert - 1, 0)
        elif self.inert == 0 and tag == "head" and self.head_at is None:
            self.head_at = self._offset()


def _bytes(text: str) -> bytes:
    """Encode a piece of a page the way the page was decoded, so the bad bytes come back."""
    return text.encode("utf-8", "surrogateescape")


def serve_page(raw: bytes, theme: str | None, palette: str | None) -> tuple[bytes, str]:
    """Hand back one page the way the frame gets it: script first, theme if it opted in.

    The script goes right after the doctype, or at the very start when there is
    none (after a byte order mark, which stays first). A page opts in with the
    `kasten-theme` meta, and only then does it get the theme and palette on its
    `<html>` element and the styles before `</head>`. Any other theme or palette
    means no theme at all, and the page keeps its own fallback. The charset comes
    back with the bytes, for the header: the page's own meta, or utf-8 without one.
    """
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        # UTF-16 is not the UTF-8 read below, so nothing can go in front of its
        # bytes without breaking them. It goes out as it did before, with no theme.
        # A browser reads the byte order mark ahead of the header, so the header
        # keeps utf-8.
        return raw + LINKS_OUT + PAGE_SCRIPT, "utf-8"

    page = raw.decode("utf-8", "surrogateescape")
    tokens = _Tokens(page)
    charset = tokens.charset or "utf-8"
    # A doctype cut off before its `>` (a page read mid-write) is no doctype here.
    doctype_end = page.find(">", tokens.first or 0) if tokens.first_is_doctype else -1
    bom = 1 if page.startswith("﻿") else 0
    script_at = doctype_end + 1 if doctype_end != -1 else bom

    if tokens.meta_end is None or theme not in THEMES or palette not in PALETTES:
        return (
            _bytes(page[:script_at]) + PAGE_SCRIPT + _bytes(page[script_at:]) + LINKS_OUT,
            charset,
        )

    # The browser keeps the first value of each attribute it meets, so this
    # `<html>` is the one that counts: the page's own `<html lang>` joins it, and
    # a page cannot set `data-theme` itself.
    head_at = tokens.head_at if tokens.head_at is not None else tokens.meta_end
    return (
        _bytes(page[:script_at])
        + _bytes(f'<html data-theme="{theme}" data-palette="{palette}">')
        + PAGE_SCRIPT
        + _bytes(page[script_at:head_at])
        + _bytes(STYLES)
        + _bytes(page[head_at:])
        + LINKS_OUT,
        charset,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Write one page as kasten serves it.")
    parser.add_argument("file", type=Path)
    parser.add_argument("--theme")
    parser.add_argument("--palette")
    args = parser.parse_args()
    sys.stdout.buffer.write(serve_page(args.file.read_bytes(), args.theme, args.palette)[0])
