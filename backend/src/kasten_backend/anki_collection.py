"""The collection an export holds, read with sqlite into the card sides the reader renders.

It hides the schema: an export older than schema 18 keeps its decks and note
types as JSON on the `col` row, a newer one in tables whose config is protobuf,
and both come out as the same decks, note types and rendered cards. The
protobuf reader is here too, and `media_map` reads the export's media map with it.
"""

import json
import sqlite3
import tempfile
from collections import defaultdict
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from kasten_backend.anki_deck import Review, Template
from kasten_backend.anki_template import render

SEPARATOR = "\x1f"
"""Anki's separator: it joins a note's fields, and from schema 18 the levels of a deck name."""

CLOZE_KIND = 1
"""A note type's kind when it is a cloze type, in `col.models` and in its protobuf config alike."""

REVIEW = 2
"""A card row's `type` when Anki has it in review, the one kind with a schedule worth carrying."""

_VARINT, _LENGTH = 0, 2
_FIXED = {1: 8, 5: 4}
"""The protobuf wire types of a fixed-width field, against how many bytes it takes."""


@dataclass(frozen=True)
class _Rendered:
    """One card before `plain`, which needs to know first which media came through."""

    deck: str
    question: str
    answer: str
    fields: dict[str, str]
    template: Template
    kind: _NoteType
    nid: int
    ord: int
    reviews: tuple[Review, ...]


@dataclass(frozen=True)
class _NoteType:
    name: str
    cloze: bool
    fields: list[str]
    templates: dict[int, Template]


def rendered(blob: bytes, *, carry: bool) -> list[_Rendered]:
    """Every card the collection `blob` makes, its sides rendered and not yet plain.

    The schedule columns are read only with `carry`, so an import that does
    not want them does not depend on them.
    """
    with tempfile.TemporaryDirectory() as folder:
        # sqlite3 opens a path rather than bytes, so the collection has to touch
        # a disk somewhere before it can be read.
        path = Path(folder) / "collection.anki2"
        path.write_bytes(blob)
        with closing(sqlite3.connect(path)) as db:
            try:
                notes = {
                    nid: (mid, flds)
                    for nid, mid, flds in db.execute("SELECT id, mid, flds FROM notes")
                }
                card_rows = db.execute(
                    "SELECT nid, did, ord FROM cards ORDER BY nid, ord"
                ).fetchall()
                names = _deck_names(db)
                types = _note_types(db)
                reviews = _reviews(db) if carry else {}
            except sqlite3.Error as error:
                raise ValueError(f"unreadable Anki collection: {error}") from error

    if notes and not any(mid in types for mid, _ in notes.values()):
        raise ValueError("no note type in the collection matches its notes")

    rendered: list[_Rendered] = []
    clozed: set[int] = set()
    for nid, did, ord_ in card_rows:
        note = notes.get(nid)
        kind = types.get(note[0]) if note else None
        name = names.get(did)
        if note is None or kind is None or name is None:
            continue
        # sqlite keeps whatever type a row was written with, whatever the
        # column says, so a broken export can hold its fields as a blob.
        if not isinstance(note[1], str):
            raise ValueError(f"unreadable Anki export: note {nid} holds its fields as {note[1]!r}")
        values = note[1].split(SEPARATOR)
        fields = dict(zip(kind.fields, values + [""] * len(kind.fields), strict=False))
        if kind.cloze:
            # One line per note, however many deletions it has: the rows differ
            # only in which number they hide, and kasten asks each number from
            # the one line.
            if nid in clozed or not kind.templates:
                continue
            clozed.add(nid)
            which = min(kind.templates)
            template = kind.templates[which]
            question, answer = values[0], values[1] if len(values) > 1 else ""
        else:
            which = ord_
            template = kind.templates.get(ord_)
            if template is None:
                continue
            question, filled = render(template.qfmt, fields, question=True)
            if not filled:
                continue
            answer, _ = render(template.afmt, fields, question=False)
        # A cloze line holds every number's rows, the others their own.
        held = tuple(r for r in reviews.get(nid, ()) if kind.cloze or r.ord == ord_)
        rendered.append(_Rendered(name, question, answer, fields, template, kind, nid, which, held))

    return rendered


def _reviews(db: sqlite3.Connection) -> dict[int, list[Review]]:
    """Every card row in review, by its note, in template order.

    A review card's `due` is a day counted from `col.crt`, when the collection
    was made, in seconds since the epoch.

    Raises:
        ValueError: `col` has no row, or a `crt` that is not a whole number.
    """
    row = db.execute("SELECT crt FROM col").fetchone()
    # sqlite keeps whatever type a row was written with, so a broken export
    # can hold the time as text or nothing at all.
    crt = row[0] if row else None
    if not isinstance(crt, int):
        raise ValueError(f"unreadable Anki export: the collection was made at {crt!r}")
    start = datetime.fromtimestamp(crt, UTC).date()
    held: defaultdict[int, list[Review]] = defaultdict(list)
    for nid, ord_, ivl, factor, due in db.execute(
        "SELECT nid, ord, ivl, factor, due FROM cards WHERE type = ? ORDER BY nid, ord", (REVIEW,)
    ):
        held[nid].append(Review(ord_, start + timedelta(days=due), ivl, factor // 10))
    return held


def _deck_names(db: sqlite3.Connection) -> dict[int, str]:
    """Every deck id in the collection against its name, nesting spelled with `/`."""
    try:
        rows = db.execute("SELECT id, name FROM decks").fetchall()
    except sqlite3.OperationalError:
        # Before schema 18 there was no decks table: the whole deck list sat in
        # one JSON object on the single row of `col`, keyed by deck id, and
        # nesting was spelled `Certs::AWS` rather than with the separator.
        rows = db.execute("SELECT decks FROM col").fetchall()
        try:
            listing = json.loads(rows[0][0]) if rows else {}
            return {int(did): deck["name"].replace("::", "/") for did, deck in listing.items()}
        except (KeyError, TypeError, AttributeError) as error:
            raise ValueError(f"unreadable Anki export: bad deck list ({error!r})") from error
    # sqlite keeps whatever type a row was written with, so a name can be a blob.
    for did, name in rows:
        if not isinstance(name, str):
            raise ValueError(f"unreadable Anki export: deck {did} is named {name!r}")
    return {did: name.replace(SEPARATOR, "/") for did, name in rows}


def _note_types(db: sqlite3.Connection) -> dict[int, _NoteType]:
    """Every note type in the collection against its id.

    Raises:
        ValueError: the collection holds none, or one that cannot be read.
    """
    try:
        rows = db.execute("SELECT id, name, config FROM notetypes").fetchall()
    except sqlite3.OperationalError:
        types = _legacy_note_types(db)
    else:
        types = {}
        for ntid, name, config in rows:
            names = db.execute("SELECT name FROM fields WHERE ntid = ? ORDER BY ord", (ntid,))
            templates = {
                ord_: Template(tname, _string(tconfig, 1), _string(tconfig, 2))
                for ord_, tname, tconfig in db.execute(
                    "SELECT ord, name, config FROM templates WHERE ntid = ?", (ntid,)
                )
            }
            kind = _protobuf(config).get(1, [0])[0]
            types[ntid] = _NoteType(
                name, kind == CLOZE_KIND, [field for (field,) in names], templates
            )
    if not types:
        raise ValueError("no note types in the Anki collection")
    return types


def _legacy_note_types(db: sqlite3.Connection) -> dict[int, _NoteType]:
    """The note types of a collection older than schema 18, from the JSON on `col`."""
    rows = db.execute("SELECT models FROM col").fetchall()
    try:
        listing = json.loads(rows[0][0]) if rows and rows[0][0] else {}
        return {
            int(mid): _NoteType(
                kind["name"],
                kind.get("type") == CLOZE_KIND,
                [_text(f["name"]) for f in sorted(kind["flds"], key=lambda f: f["ord"])],
                {
                    t["ord"]: Template(t["name"], _text(t["qfmt"]), _text(t["afmt"]))
                    for t in kind["tmpls"]
                },
            )
            for mid, kind in listing.items()
        }
    except (KeyError, TypeError, AttributeError) as error:
        raise ValueError(f"unreadable Anki note types: {error!r}") from error


def _text(value: object) -> str:
    """`value` when the JSON held a string there, which the renderer needs to parse it."""
    if not isinstance(value, str):
        raise ValueError(f"unreadable Anki note types: {value!r} is not text")
    return value


def media_map(raw: bytes) -> dict[str, str]:
    """The latest export's media map: each file's zip member, by the name a field gives it.

    `raw` is the map once decompressed: Anki's `MediaEntries`, whose entries are
    numbered by position unless one carries the `legacy_zip_filename` of field 255.

    Raises:
        ValueError, AttributeError, TypeError: `raw` is not that protobuf, an entry
            being one way, a field the wrong kind another.
    """
    index: dict[str, str] = {}
    for number, entry in enumerate(_protobuf(raw).get(1, [])):
        if not isinstance(entry, bytes):
            raise ValueError(f"entry {number} is not a message")
        legacy = _protobuf(entry).get(255)
        index[_string(entry, 1)] = str(legacy[0] if legacy else number)
    return index


def _string(message: bytes, number: int) -> str:
    """Field `number` of a protobuf `message` as text, or empty when it is not set."""
    value = _protobuf(message).get(number, [b""])[0]
    if not isinstance(value, bytes):
        raise ValueError(f"protobuf field {number} is not a string")
    return value.decode()


def _protobuf(message: bytes) -> dict[int, list[int | bytes]]:
    """The fields of a protobuf `message` by number: a varint as an int, the rest as bytes.

    Anki keeps a note type's kind and a template's front and back in protobuf
    blobs from schema 18. The wire format is simple enough that a reader is
    shorter than a dependency on one; a field this reader has no use for is
    stepped over by its wire type.

    Raises:
        ValueError: `message` is not well-formed protobuf.
    """
    fields: defaultdict[int, list[int | bytes]] = defaultdict(list)
    at = 0
    while at < len(message):
        key, at = _varint(message, at)
        number, wire = key >> 3, key & 7
        if wire == _VARINT:
            value, at = _varint(message, at)
            fields[number].append(value)
        elif wire == _LENGTH:
            size, at = _varint(message, at)
            if at + size > len(message):
                raise ValueError("protobuf field runs past the end of its message")
            fields[number].append(message[at : at + size])
            at += size
        elif wire in _FIXED:
            at += _FIXED[wire]
        else:
            raise ValueError(f"protobuf wire type {wire} is not one Anki writes")
    if at > len(message):
        raise ValueError("protobuf field runs past the end of its message")
    return fields


def _varint(message: bytes, at: int) -> tuple[int, int]:
    """The varint starting at `at`, and where the next field starts."""
    value = shift = 0
    while True:
        if at >= len(message):
            raise ValueError("protobuf varint runs past the end of its message")
        byte = message[at]
        value |= (byte & 0x7F) << shift
        at += 1
        shift += 7
        if not byte & 0x80:
            return value, at
