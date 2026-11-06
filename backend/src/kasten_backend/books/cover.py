"""The cover picture inside an epub, found the way its package names it.

EPUB 3 marks the manifest item `cover-image`; EPUB 2 points at it with `<meta name="cover">`.
A book that does neither gets the first image whose id or name says cover, or nothing.
"""

import posixpath
import xml.etree.ElementTree as ET
import zipfile
from typing import TYPE_CHECKING, NamedTuple
from urllib.parse import unquote

if TYPE_CHECKING:
    from pathlib import Path

_OPF_NS = "{http://www.idpf.org/2007/opf}"
_CONTAINER_NS = "{urn:oasis:names:tc:opendocument:xmlns:container}"

TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})
"""What a cover may be served as. No SVG: served from this origin, its script would run."""

MOST_BYTES = 10 * 1024 * 1024
"""A cover past this is refused, so a broken book cannot make one request read a gigabyte."""


class Cover(NamedTuple):
    """The picture's bytes and the type the package names for it."""

    data: bytes
    media_type: str


def _pick(opf: ET.Element) -> ET.Element | None:
    items = list(opf.iter(f"{_OPF_NS}item"))
    marked = next((i for i in items if "cover-image" in (i.get("properties") or "").split()), None)
    if marked is not None:
        return marked
    meta = next((m for m in opf.iter(f"{_OPF_NS}meta") if m.get("name") == "cover"), None)
    named = meta.get("content") if meta is not None else None
    by_id = next((i for i in items if named and i.get("id") == named), None)
    if by_id is not None:
        return by_id
    return next(
        (
            i
            for i in items
            if (i.get("media-type") or "") in TYPES
            and "cover" in f"{i.get('id', '')} {i.get('href', '')}".lower()
        ),
        None,
    )


def epub_cover(path: Path) -> Cover | None:
    """The cover of the epub at `path`, or None when it names none this can serve."""
    try:
        with zipfile.ZipFile(path) as book:
            container = ET.fromstring(book.read("META-INF/container.xml"))  # noqa: S314
            rootfile = container.find(f".//{_CONTAINER_NS}rootfile")
            if rootfile is None:
                return None
            opf_path = rootfile.get("full-path", "")
            item = _pick(ET.fromstring(book.read(opf_path)))  # noqa: S314
            if item is None or (item.get("media-type") or "") not in TYPES:
                return None
            name = posixpath.normpath(
                posixpath.join(posixpath.dirname(opf_path), unquote(item.get("href", "")))
            )
            if book.getinfo(name).file_size > MOST_BYTES:
                return None
            return Cover(book.read(name), item.get("media-type", ""))
    except OSError, KeyError, zipfile.BadZipFile, ET.ParseError:
        return None
