"""The Anki exports the anki tests build, and the note types and fields they hold.

An export is a zip around an sqlite file, and a real one carries a hundred
columns of scheduling state none of this reads. The builder below writes only
the columns the reader touches, in the two schemas Anki has written, so a test
says which schema it is about instead of a binary blob saying nothing. The note
types are the shapes a real export from Anki 26.09 holds, templates and all.
"""

import hashlib
import io
import json
import re
import sqlite3
import tempfile
import zipfile
from compression import zstd
from pathlib import Path
from typing import Any

import pytest

from kasten_backend.anki import read_apkg
from kasten_backend.anki_deck import Card, Deck, Template

type NoteType = tuple[int, str, int, tuple[str, ...], tuple[tuple[str, str, str], ...]]
"""A note type as the builder takes it: id, name, kind, field names, and templates."""

BASIC, REVERSED, JAPANESE, COND, SOLO, CLOZE, FILTERS = 1, 2, 3, 4, 5, 6, 7

TYPES: tuple[NoteType, ...] = (
    (
        BASIC,
        "Basic",
        0,
        ("Front", "Back"),
        (("Card 1", "{{Front}}", "{{FrontSide}}<hr id=answer>{{Back}}"),),
    ),
    (
        REVERSED,
        "Basic (and reversed card)",
        0,
        ("Front", "Back"),
        (
            ("Card 1", "{{Front}}", "{{FrontSide}}<hr id=answer>{{Back}}"),
            ("Card 2", "{{Back}}", "{{FrontSide}}<hr id=answer>{{Front}}"),
        ),
    ),
    (
        JAPANESE,
        "Japanese",
        0,
        ("Expression", "Meaning", "Audio", "Reading"),
        (
            ("T1", "{{Audio}}", "{{FrontSide}}<hr id=answer>{{Expression}}<br>{{Meaning}}"),
            ("T2", "{{Meaning}}", "{{FrontSide}}<hr id=answer>{{Expression}}"),
            ("T3", "{{Expression}}", "{{FrontSide}}<hr id=answer>{{Reading}} {{type:Meaning}}"),
        ),
    ),
    (
        COND,
        "Cond",
        0,
        ("Front", "Back", "Extra"),
        (
            (
                "C1",
                "{{#Extra}}Extra: {{Extra}}{{/Extra}}{{^Extra}}{{Front}}{{/Extra}}",
                "{{FrontSide}}<hr id=answer>{{Back}}<script>var x=1;</script>",
            ),
            ("C2", "Label only {{#Extra}}{{Extra}}{{/Extra}}", "{{Back}}"),
        ),
    ),
    (SOLO, "Solo", 0, ("Word",), (("S1", "{{Word}}", "{{FrontSide}}"),)),
    (
        CLOZE,
        "Cloze",
        1,
        ("Text", "Back Extra"),
        (("Cloze", "{{cloze:Text}}", "{{cloze:Text}}<br>{{Back Extra}}"),),
    ),
    (
        FILTERS,
        "Filters",
        0,
        ("Unused", "Front", "Back"),
        (
            (
                "F1",
                "{{text:Front}}{{type:Back}}{{tts en_US:Back}}{{Tags}}{{Deck}}{{Card}}{{Nope}}",
                "{{FrontSide}}{{hint:text:Back}}",
            ),
            (
                "F2",
                "Only {{Tags}}{{Type}}{{Subdeck}}{{CardFlag}}{{Nope}}{{tts en_US:Front}}",
                "{{Back}}",
            ),
        ),
    ),
)

# Tuples rather than lists so they can be default arguments: ruff refuses a
# mutable one, and every test that varies a fixture varies exactly one of them.
NOTES = ((1, BASIC, "Bonjour\x1fhello"), (2, BASIC, "Paris\x1fthe capital of France"))
CARDS = ((11, 1, 100, 0), (12, 2, 200, 0))
DECKS = ((100, "French"), (200, "Geography"))

EXPECTED = {"French": [("Bonjour", "hello")], "Geography": [("Paris", "the capital of France")]}

LAYOUTS = [
    pytest.param({"member": "collection.anki2"}, id="legacy-plain"),
    pytest.param({"schema18": True, "member": "collection.anki21b"}, id="schema18-zstd"),
]


PNG = b"\x89PNG\r\n\x1a\n not really an image"
MP3 = b"ID3\x04\x00 not really a sound"

type Media = tuple[tuple[str, bytes | None], ...]
"""Files an export carries, by the name a field gives them; `None` is listed but not zipped."""

CRT = 1767225600
"""When the collection was made, `col.crt`: 2026-01-01 at midnight UTC, whence `due` counts."""

NO_ROW = object()
"""A `crt` that leaves the row of `col` out altogether."""

type Review = tuple[int, int, int, int, int]
"""A card row's schedule as the builder takes it: card id, type, ivl, factor, due."""


# A builder whose every knob has a default and is named at the call; grouping
# them into a record would only add a type each test has to build.
def apkg(  # noqa: PLR0913
    notes: tuple[tuple[int, int, str], ...] = NOTES,
    cards: tuple[tuple[int, int, int, int], ...] = CARDS,
    decks: tuple[tuple[int, str], ...] = DECKS,
    *,
    types: tuple[NoteType, ...] = TYPES,
    schema18: bool = False,
    member: str = "collection.anki2",
    media: Media = (),
    reviews: tuple[Review, ...] = (),
    crt: object = CRT,
) -> bytes:
    """The bytes of an export holding `notes` in `decks`, in one of the two schemas.

    `media` goes in the form the collection's member implies: beside
    `collection.anki21b`, the latest export's zstd protobuf map with every file
    zstd-compressed, and otherwise the legacy JSON map with the files raw. A
    card row `reviews` does not name is new. On schema 18, whose `col` holds
    nothing else the reader needs, `crt` of `NO_ROW` leaves that row out.
    """
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "collection"
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT)")
            db.execute(
                "CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER,"
                " type INTEGER DEFAULT 0, ivl INTEGER DEFAULT 0, factor INTEGER DEFAULT 0,"
                " due INTEGER DEFAULT 0)"
            )
            db.executemany("INSERT INTO notes VALUES (?, ?, ?)", notes)
            db.executemany("INSERT INTO cards (id, nid, did, ord) VALUES (?, ?, ?, ?)", cards)
            db.executemany(
                "UPDATE cards SET type = ?, ivl = ?, factor = ?, due = ? WHERE id = ?",
                [(*review[1:], review[0]) for review in reviews],
            )
            if schema18:
                write_schema_18(db, decks, types, crt)
            else:
                write_legacy(db, decks, types)
        db.close()
        blob = path.read_bytes()

    latest = member == "collection.anki21b"
    return zipped(member, zstd.compress(blob) if latest else blob, *media_members(media, latest))


def media_members(media: Media, latest: bool) -> list[tuple[str, bytes]]:
    """The `media` map and the numbered files beside it, in the latest form or the legacy one."""
    files = [(str(i), data) for i, (_, data) in enumerate(media) if data is not None]
    if not latest:
        listing = {str(i): name for i, (name, _) in enumerate(media)}
        return [("media", json.dumps(listing).encode()), *files]
    entries = b"".join(
        proto(1, proto(1, name) + proto(2, len(data or b""))) for name, data in media
    )
    # `meta` is what tells Anki the export is the latest form; this reader goes by the map.
    return [
        ("media", zstd.compress(entries)),
        ("meta", proto(1, 3)),
        *((number, zstd.compress(data)) for number, data in files),
    ]


def write_legacy(
    db: sqlite3.Connection, decks: tuple[tuple[int, str], ...], types: tuple[NoteType, ...]
) -> None:
    listing = {str(did): {"name": name} for did, name in decks}
    models = {
        str(mid): {
            "name": name,
            "type": kind,
            "flds": [{"name": field, "ord": ord_} for ord_, field in enumerate(fields)],
            "tmpls": [
                {"name": tname, "ord": ord_, "qfmt": qfmt, "afmt": afmt}
                for ord_, (tname, qfmt, afmt) in enumerate(templates)
            ],
        }
        for mid, name, kind, fields, templates in types
    }
    db.execute("CREATE TABLE col (decks TEXT, models TEXT, crt INTEGER)")
    db.execute("INSERT INTO col VALUES (?, ?, ?)", (json.dumps(listing), json.dumps(models), CRT))


def write_schema_18(
    db: sqlite3.Connection,
    decks: tuple[tuple[int, str], ...],
    types: tuple[NoteType, ...],
    crt: object = CRT,
) -> None:
    db.execute("CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT)")
    db.executemany("INSERT INTO decks VALUES (?, ?)", decks)
    # `col.models` is an empty string from schema 18, which is what Anki writes.
    db.execute("CREATE TABLE col (decks TEXT, models TEXT, crt INTEGER)")
    if crt is not NO_ROW:
        db.execute("INSERT INTO col VALUES ('', '', ?)", (crt,))
    db.execute("CREATE TABLE notetypes (id INTEGER PRIMARY KEY, name TEXT, config BLOB)")
    db.execute("CREATE TABLE fields (ntid INTEGER, ord INTEGER, name TEXT, config BLOB)")
    db.execute("CREATE TABLE templates (ntid INTEGER, ord INTEGER, name TEXT, config BLOB)")
    for mid, name, kind, fields, templates in types:
        # A normal type leaves the kind out, and fields the reader has no use
        # for (css, a varint, a fixed32) sit around the ones it reads.
        config = (proto(1, kind) if kind else b"") + proto(3, ".card {}") + proto(9, 2)
        db.execute("INSERT INTO notetypes VALUES (?, ?, ?)", (mid, name, config))
        for ord_, field in enumerate(fields):
            db.execute("INSERT INTO fields VALUES (?, ?, ?, ?)", (mid, ord_, field, b""))
        for ord_, (tname, qfmt, afmt) in enumerate(templates):
            tconfig = proto(1, qfmt) + bytes([5 << 3 | 5, 1, 2, 3, 4]) + proto(2, afmt)
            db.execute("INSERT INTO templates VALUES (?, ?, ?, ?)", (mid, ord_, tname, tconfig))
    # Anki keeps rows for stock note types that have no `notetypes` row.
    db.execute("INSERT INTO templates VALUES (999, 0, 'orphan', ?)", (proto(1, "{{X}}"),))


def proto(number: int, value: int | str | bytes) -> bytes:
    """One protobuf field: a varint for an int, length-delimited for a string or a message."""
    if isinstance(value, int):
        return varint(number << 3) + varint(value)
    data = value.encode() if isinstance(value, str) else value
    return varint(number << 3 | 2) + varint(len(data)) + data


def varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte, value = value & 0x7F, value >> 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def zipped(name: str, blob: bytes, *more: tuple[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        for member, data in ((name, blob), *more):
            bundle.writestr(member, data)
    return buffer.getvalue()


def sides(decks: list[Deck]) -> dict[str, list[tuple[str, str]]]:
    """Each deck's cards as front and back, which is what most tests are about."""
    return {deck.name: [(card.front, card.back) for card in deck.cards] for deck in decks}


def one_deck(
    notes: tuple[tuple[int, int, str], ...],
    cards: tuple[tuple[int, int, int, int], ...],
    **layout: Any,
) -> list[tuple[str, str]]:
    """The cards of an export whose every card row sits in the deck `French`."""
    return sides(read_apkg(apkg(notes, cards, ((100, "French"),), **layout)))["French"]


def mark(nid: int, ord_: int = 0) -> str:
    """A marker less its hash, with the space before it, to hold against `unhashed` text."""
    return f" <!--anki:{nid}:{ord_}-->"


def marked(nid: int, text: str, ord_: int = 0) -> str:
    """The marker `as_note` writes after the card whose lines, joined, are `text`."""
    return f" <!--anki:{nid}:{ord_}:{hashlib.sha256(text.encode()).hexdigest()[:8]}-->"


def unhashed(text: str) -> str:
    """`text` with every marker's hash taken off, for a test about where the markers go."""
    return re.sub(r"(<!--anki:\d+:\d+):[0-9a-f]{8}-->", r"\1-->", text)


def basic_deck(*pairs: tuple[str, str]) -> Deck:
    """A deck `x` of hand-built cards from `pairs`, each its own Anki note numbered from 1."""
    template = Template("Card 1", "{{Front}}", "{{Back}}")
    cards = [
        Card(front, back, {}, template, "Basic", cloze=False, nid=nid, ord=0)
        for nid, (front, back) in enumerate(pairs, 1)
    ]
    return Deck("x", cards, {})


FURIGANA = 8
FURIGANA_TYPE: NoteType = (
    FURIGANA,
    "Furigana",
    0,
    ("Expression", "Reading"),
    (
        ("Ruby", "{{Expression}}", "{{furigana:Reading}}"),
        ("Kanji", "{{kanji:Reading}}", "{{kana:Reading}}"),
        ("Stored", "{{Reading}}", "{{Expression}}"),
    ),
)

SR1, SR2, SR3 = (f"<!--SR:!2026-10-2{day},{day},250-->" for day in (1, 2, 3))


def cloze_note(text: str, back: str) -> Deck:
    """The deck `x` of one cloze note whose text is `text` and whose Back Extra is `back`."""
    return read_apkg(apkg(((1, CLOZE, f"{text}\x1f{back}"),), CARDS[:1], ((100, "x"),)))[0]


def legacy_type(qfmt: object = "{{F}}", afmt: object = "x", field: object = "F") -> str:
    """`col.models` holding one note type, with whatever values a test wants to break."""
    tmpl = {"name": "c", "ord": 0, "qfmt": qfmt, "afmt": afmt}
    return json.dumps({"1": {"name": "B", "flds": [{"name": field, "ord": 0}], "tmpls": [tmpl]}})


def sqlite3_bytes(*statements: str, row: tuple[str, tuple[object, ...]]) -> bytes:
    """A collection built by hand, for the broken ones the builder will not write."""
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "collection"
        with sqlite3.connect(path) as db:
            for statement in statements:
                db.execute(statement)
            db.execute(*row)
        db.close()
        return path.read_bytes()


def deflated(export: bytes, method: int = zipfile.ZIP_DEFLATED) -> bytes:
    """`export` again with every member deflated, as Anki writes it, where `zipped` stores them.

    Or compressed by another `method`, which no Anki writes but a zip may hold.
    """
    buffer = io.BytesIO()
    with (
        zipfile.ZipFile(io.BytesIO(export)) as source,
        zipfile.ZipFile(buffer, "w", method) as bundle,
    ):
        for info in source.infolist():
            bundle.writestr(info.filename, source.read(info))
    return buffer.getvalue()


CAT_EXPORT = apkg(
    notes=(
        (1, BASIC, '<img src="cat.png"> which cat?\x1fthe tabby [sound:purr.mp3]'),
        (2, BASIC, '<img src="cat.png"> and here?\x1f<img src="bad.png">'),
    ),
    cards=((1, 1, 10, 0), (2, 2, 20, 0)),
    decks=((10, "Cats"), (20, "Pets/Cats")),
    schema18=True,
    member="collection.anki21b",
    media=(("cat.png", PNG), ("purr.mp3", MP3), ("bad.png", MP3)),
)
"""Two decks naming one picture, a sound, and a picture whose bytes are a sound."""
