"""The text of the pdf, epub and html files beside the notes, kept in a cache for search.

ripgrep reads text, not pdfs or epubs, so each file is turned into a text file
once, in a cache outside the vault. On each query the cache is brought into step
with the vault: a file changed since its entry was made is extracted again, and
the entry of a file that is gone is dropped. The vault never gets a new file.
"""

import asyncio
import bisect
import contextlib
import json
import os
import posixpath
import tempfile
import xml.etree.ElementTree as ET
import zipfile
import zlib
from functools import lru_cache
from html.parser import HTMLParser
from pathlib import Path
from typing import NamedTuple
from urllib.parse import unquote

import pypdfium2

from kasten_backend.vault import list_assets, list_html

MOST_CHARS = 1_000_000
"""How many characters of text are kept per file; the rest of a file is not searched.

A cap on the work one file can cost, a book of a thousand pages being a few
million characters. Read at call time so a test can make it smaller.
"""

KINDS = (".pdf", ".epub", ".html")
"""The suffixes whose files are extracted, lower case, matched ignoring case."""

_OPF_NS = "{http://www.idpf.org/2007/opf}"
_CONTAINER_NS = "{urn:oasis:names:tc:opendocument:xmlns:container}"

_BLOCKS = frozenset(
    {
        "p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "pre",
        "blockquote", "br", "section", "article", "tr", "dt", "dd",
    }
)  # fmt: skip
"""Elements that end a line. A line is the text between two of them, as a search hit shows it."""

_HEADINGS = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})
_HIDDEN = frozenset({"script", "style", "noscript", "template"})
"""Elements whose text is code or markup, not the words a reader sees."""


class Place(NamedTuple):
    """Where a line sits in its file: the label the row shows, and the pdf page or html anchor."""

    label: str
    page: int | None = None
    anchor: str | None = None


class Extracted(NamedTuple):
    """The lines of one file, and the place each one is on. Both lists are the same length."""

    lines: list[str]
    places: list[Place]


class _Lines:
    """Collects lines until the cap is reached, cutting the last one to fit."""

    def __init__(self) -> None:
        self.lines: list[str] = []
        self.places: list[Place] = []
        self.chars = 0

    def add(self, text: str, place: Place) -> bool:
        """Keep `text` up to the cap. False once the cap is reached, so the caller stops."""
        text = text[: MOST_CHARS - self.chars]
        self.lines.append(text)
        self.places.append(place)
        self.chars += len(text)
        return self.chars < MOST_CHARS

    def done(self) -> Extracted:
        return Extracted(self.lines, self.places)


class _Line(NamedTuple):
    text: str
    heading: str | None
    anchor: str | None


class _Document(NamedTuple):
    title: str
    first_heading: str
    lines: list[_Line]


class _Parser(HTMLParser):
    """Splits an html document into the lines a reader sees, each with its nearest heading."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.first_heading = ""
        self.lines: list[_Line] = []
        self.heading: str | None = None
        self.anchor: str | None = None
        self._buffer: list[str] = []
        self._hidden = 0
        self._in_head = False
        self._in_title = False
        self._pre = 0
        self._open: tuple[str, str | None] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._in_title = True
        elif tag == "head":
            self._in_head = True
        elif tag == "body":
            self._in_head = False
        if tag in _HIDDEN:
            self._hidden += 1
        if tag in _BLOCKS:
            self._flush()
        if tag == "pre":
            self._pre += 1
        if tag in _HEADINGS:
            self._open = (tag, dict(attrs).get("id"))

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "head":
            self._in_head = False
        if tag in _HIDDEN:
            self._hidden = max(self._hidden - 1, 0)
        if tag in _HEADINGS and self._open is not None and self._open[0] == tag:
            self._end_heading(tag, self._open[1])
            self._open = None
        if tag in _BLOCKS:
            self._flush()
        if tag == "pre":
            self._pre = max(self._pre - 1, 0)

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        elif not self._in_head and self._hidden == 0:
            self._buffer.append(data)

    def document(self) -> _Document:
        self._flush()
        return _Document(" ".join(self.title.split()), self.first_heading, self.lines)

    def _end_heading(self, tag: str, heading_id: str | None) -> None:
        # Set before the flush, so the heading's own line carries its own label.
        text = " ".join("".join(self._buffer).split())
        if not text:
            return
        self.heading = text
        self.anchor = heading_id
        if tag in ("h1", "h2", "h3") and not self.first_heading:
            self.first_heading = text

    def _flush(self) -> None:
        raw = "".join(self._buffer)
        self._buffer = []
        # Inside <pre> a newline is a line break, the one place source line breaks
        # mean something; everywhere else they are the wrapping of the source.
        pieces = raw.split("\n") if self._pre else [raw]
        for piece in pieces:
            text = " ".join(piece.split())
            if text:
                self.lines.append(_Line(text, self.heading, self.anchor))


def _html_document(source: str) -> _Document:
    parser = _Parser()
    parser.feed(source)
    parser.close()
    return parser.document()


def _pdf_text(path: Path) -> Extracted:
    out = _Lines()
    with pypdfium2.PdfDocument(path) as pdf:
        for index in range(len(pdf)):
            number = index + 1
            # Pages close by hand: they are not context managers in pypdfium2.
            with contextlib.closing(pdf[index]) as page:
                textpage = page.get_textpage()
                text = textpage.get_text_range()
                textpage.close()
            for raw in text.splitlines():
                line = raw.strip()
                if line and not out.add(line, Place(f"page {number}", number)):
                    return out.done()
    return out.done()


def _epub_text(path: Path) -> Extracted:
    with zipfile.ZipFile(path) as book:
        # The standard library parser, as the brief asks: the files are the user's own, not
        # strangers', so the entity-expansion attacks defusedxml guards against do not apply.
        container = ET.fromstring(book.read("META-INF/container.xml"))  # noqa: S314
        rootfile = container.find(f".//{_CONTAINER_NS}rootfile")
        if rootfile is None:
            raise KeyError("no rootfile in container.xml")
        opf_path = rootfile.get("full-path", "")
        opf = ET.fromstring(book.read(opf_path))  # noqa: S314
        manifest = {item.get("id"): item.get("href", "") for item in opf.iter(f"{_OPF_NS}item")}
        base = posixpath.dirname(opf_path)

        # Every chapter is read before any line is kept: the percent in a label is
        # over the whole book, not over what the cap lets through.
        rows: list[tuple[str, str]] = []
        for position, ref in enumerate(opf.iter(f"{_OPF_NS}itemref"), 1):
            href = manifest[ref.get("idref", "")]
            name = posixpath.normpath(posixpath.join(base, unquote(href)))
            document = _html_document(book.read(name).decode("utf-8"))
            chapter = document.first_heading or document.title or f"chapter {position}"
            rows.extend((line.text, chapter) for line in document.lines)

    total = sum(len(text) for text, _ in rows)
    out = _Lines()
    before = 0
    for text, chapter in rows:
        place = Place(f"{chapter}, {before * 100 // total}%")
        if not out.add(text, place):
            break
        before += len(text)
    return out.done()


def _html_text(path: Path) -> Extracted:
    document = _html_document(path.read_bytes().decode("utf-8"))
    out = _Lines()
    for line in document.lines:
        place = Place(line.heading or document.title or "top", None, line.anchor)
        if not out.add(line.text, place):
            break
    return out.done()


def _extract(path: Path) -> Extracted:
    """The text of one file, or nothing at all when the file will not read.

    A file that fails to read is an empty entry, not an error: the search answers
    with its other hits, and the entry keeps the file from being tried again on
    every query.
    """
    try:
        suffix = path.suffix.lower()
        if suffix == ".pdf":
            return _pdf_text(path)
        if suffix == ".epub":
            return _epub_text(path)
        return _html_text(path)
    except (
        pypdfium2.PdfiumError,
        zipfile.BadZipFile,
        # A member whose deflated bytes are damaged, compressed some way zipfile
        # does not read, or encrypted.
        zlib.error,
        NotImplementedError,
        RuntimeError,
        KeyError,
        ValueError,
        UnicodeDecodeError,
        OSError,
        ET.ParseError,
    ):
        return Extracted([], [])


_lock = asyncio.Lock()
"""One extraction at a time.

pdfium is not thread safe, and two cold queries would otherwise extract one book twice at once.
"""


async def refresh(root: Path, cache: Path, skip: str | None) -> None:
    """Bring the cache into step with the book and page files in the vault."""
    async with _lock:
        await asyncio.to_thread(_refresh, root, cache, skip)


def _in_folder(path: str, folder: str | None) -> bool:
    """Whether `path` lies under a folder named `folder` anywhere, as `skipping` reads it."""
    return folder is not None and folder != "" and f"/{folder}/" in f"/{path}"


def _refresh(root: Path, cache: Path, skip: str | None) -> None:
    files = [path for path in list_html(root) + list_assets(root) if path.lower().endswith(KINDS)]
    # Entries of the archive are kept when it is left out of a search, so that
    # the archive is not extracted again the next time it is read.
    listed = set(files)
    for key in _entries(cache):
        if not _in_folder(key, skip) and key not in listed:
            _drop(cache, key)

    for path in files:
        if _in_folder(path, skip):
            continue
        try:
            stat = (root / path).stat()
        except OSError:
            # Gone between the listing and now, so there is nothing to extract.
            continue
        if not _current(cache, path, stat):
            _write(cache, path, _extract(root / path), stat)


def _entries(cache: Path) -> set[str]:
    """The vault path of every cache entry, whether its txt or its json is there."""
    if not cache.is_dir():
        return set()
    return {
        path.relative_to(cache).with_suffix("").as_posix()
        for path in cache.rglob("*")
        if path.suffix in (".txt", ".json") and path.is_file()
    }


def _drop(cache: Path, key: str) -> None:
    # The json goes first: a txt with no json is ignored, a json with no txt is not.
    (cache / f"{key}.json").unlink(missing_ok=True)
    (cache / f"{key}.txt").unlink(missing_ok=True)


def _current(cache: Path, key: str, stat: os.stat_result) -> bool:
    try:
        entry = json.loads((cache / f"{key}.json").read_text(encoding="utf-8"))
    except OSError, ValueError:
        return False
    return (
        isinstance(entry, dict)
        and entry.get("mtime_ns") == stat.st_mtime_ns
        and entry.get("size") == stat.st_size
    )


def _write(cache: Path, key: str, extracted: Extracted, stat: os.stat_result) -> None:
    target = cache / key
    target.parent.mkdir(parents=True, exist_ok=True)
    # The txt first and the json last: a json on disk always matches the txt beside it.
    _replace(Path(f"{target}.txt"), "\n".join(extracted.lines))
    entry = {
        "mtime_ns": stat.st_mtime_ns,
        "size": stat.st_size,
        "places": _spans(extracted.places),
    }
    _replace(Path(f"{target}.json"), json.dumps(entry))


def _replace(path: Path, content: str) -> None:
    # A temp name in the same folder, so the rename is atomic and a reader never
    # sees half a file.
    descriptor, temp = tempfile.mkstemp(dir=path.parent, prefix=".", suffix=".tmp")
    with os.fdopen(descriptor, "w", encoding="utf-8", errors="replace") as handle:
        handle.write(content)
    Path(temp).replace(path)


def _spans(places: list[Place]) -> list[list[object]]:
    """One span per place change: the line it starts at, then the label, page and anchor."""
    spans: list[list[object]] = []
    previous: Place | None = None
    for number, place in enumerate(places, 1):
        if place != previous:
            spans.append([number, *place])
            previous = place
    return spans


@lru_cache(maxsize=32)
def _load(json_path: str, _mtime_ns: int, _size: int) -> tuple[list[int], list[Place]]:
    """The spans of one entry, parsed once.

    Its stamp is in the key, so a rewritten entry is read again.
    """
    try:
        entry = json.loads(Path(json_path).read_text(encoding="utf-8"))
    except OSError, ValueError:
        return [], []
    spans = entry["places"]
    return [span[0] for span in spans], [Place(*span[1:]) for span in spans]


def place_of(cache: Path, path: str, line: int) -> Place | None:
    """Where `line` of the file at `path` sits, or None when the cache has no entry for it."""
    json_path = cache / f"{path}.json"
    try:
        status = json_path.stat()
    except OSError:
        return None
    starts, places = _load(str(json_path), status.st_mtime_ns, status.st_size)
    index = bisect.bisect_right(starts, line) - 1
    return places[index] if index >= 0 else None
