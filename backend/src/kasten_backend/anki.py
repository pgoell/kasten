"""Reading an Anki `.apkg` export into decks of front-and-back cards.

An `.apkg` is a zip around an sqlite database, so the whole reader is standard
library: `zipfile`, `sqlite3`, and `compression.zstd` for the collection Anki
writes today. A dependency would buy nothing four queries do not.

Anki's model is larger than what survives the trip. A note has as many fields as
its note type declares and a card is a template over them; here a note is its
first two fields and nothing else, because what the vault wants back is a
markdown note of `front::back` lines and a second parser for card templates
would be a second thing to keep true. A note that cannot spare two fields is
left out whole rather than imported halfway.

Media is counted rather than carried. The image or sound a field names lives in
the zip under a numbered name that only the export's `media` map translates, and
a note rendering a broken image is worse than a note saying how many cards did
not come through.
"""

import html
import io
import json
import re
import sqlite3
import tempfile
import zipfile
from collections import Counter, defaultdict
from compression import zstd
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

SEPARATOR = "\x1f"
"""Anki's separator: it joins a note's fields, and from schema 18 the levels of a deck name."""

COLLECTION_MEMBERS = ("collection.anki21b", "collection.anki21", "collection.anki2")
"""The collection an export may hold, newest first.

An export written by a recent Anki holds several of these at once, the older
ones being a stub kept so an older Anki opening the file says so rather than
crashing. Reading them in this order is what keeps the stub out.
"""

SIDES = 2
"""How many of a note's fields a card is: the front and the back, in that order."""

ZSTD_MEMBER = "collection.anki21b"
"""The only member that is compressed rather than an sqlite file as it stands."""

_CLOZE = re.compile(r"\{\{c\d+::(.*?)(?:::.*?)?\}\}")
"""One cloze deletion, with the hint the author may have written after it.

The hint is part of the match and not of the group, so it is dropped: a
highlight in a markdown note has nowhere to put it.
"""

_SOUND = re.compile(r"\[sound:[^\]]*\]")
_BREAK = re.compile(r"<\s*(?:br\s*/?|/\s*(?:div|p))\s*>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]*>")
_MEDIA = re.compile(r"<img|\[sound:", re.IGNORECASE)


@dataclass(frozen=True)
class Deck:
    """One Anki deck, as much of it as a markdown note can hold."""

    name: str
    cards: list[tuple[str, str]]
    dropped_media: int


def plain(field: str) -> str:
    """One Anki field as a single line of markdown.

    A card is one line, so every break in the field becomes a space and the
    result never holds a newline.
    """
    text = _SOUND.sub("", field)
    text = _BREAK.sub(" ", text)
    # Takes `<img>` with it, which is what removes an image reference.
    text = _TAG.sub("", text)
    # After the strip, so a `&lt;b&gt;` the author meant as text stays text.
    text = html.unescape(text)
    text = _CLOZE.sub(r"==\1==", text)
    # `split()` counts the non-breaking space `&nbsp;` just unescaped as
    # whitespace, which is what turns it into an ordinary space.
    return " ".join(text.split())


def read_apkg(data: bytes) -> list[Deck]:
    """Every deck `data` holds, sorted by name and without the empty ones.

    Raises:
        ValueError: `data` is not a zip, or holds no collection, or holds one
            sqlite refuses to read.
    """
    blob = _collection(data)
    with tempfile.TemporaryDirectory() as folder:
        # sqlite3 opens a path rather than bytes, so the collection has to touch
        # a disk somewhere before it can be read.
        path = Path(folder) / "collection.anki2"
        path.write_bytes(blob)
        with closing(sqlite3.connect(path)) as db:
            try:
                note_rows = db.execute("SELECT id, flds FROM notes").fetchall()
                card_rows = db.execute("SELECT nid, did FROM cards").fetchall()
                names = _deck_names(db)
            except sqlite3.Error as error:
                raise ValueError(f"unreadable Anki collection: {error}") from error

    # A note type with several templates gives a note several cards, all of them
    # the same two fields. The first one decides which deck the note joins.
    deck_of: dict[int, int] = {}
    for nid, did in card_rows:
        deck_of.setdefault(nid, did)

    cards: defaultdict[str, list[tuple[str, str]]] = defaultdict(list)
    dropped: Counter[str] = Counter()
    for nid, flds in note_rows:
        fields = flds.split(SEPARATOR)
        did = deck_of.get(nid)
        name = names.get(did) if did is not None else None
        if len(fields) < SIDES or name is None:
            continue
        cards[name].append((plain(fields[0]), plain(fields[1])))
        if _MEDIA.search(fields[0]) or _MEDIA.search(fields[1]):
            dropped[name] += 1

    return [Deck(name, pairs, dropped[name]) for name, pairs in sorted(cards.items())]


def as_note(deck: Deck) -> str:
    """`deck` as one markdown note: the tag line, a blank line, then a line per card.

    A card missing either side is left out. It would read as a line ending in
    `::`, which every flashcard reader takes for a card with an empty answer.
    """
    # A tag runs to the first space, so a deck called "AWS Certification" would
    # otherwise land in a deck called `AWS` with the rest of its name read as
    # prose. The note's `# heading` is not the deck name; the tag is.
    lines = [f"#flashcards/{re.sub(r'\s+', '-', deck.name)}", ""]
    lines += [f"{front}::{back}" for front, back in deck.cards if front and back]
    return "\n".join(lines) + "\n"


def _collection(data: bytes) -> bytes:
    """The sqlite bytes of the newest collection the export holds."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as bundle:
            held = set(bundle.namelist())
            member = next((name for name in COLLECTION_MEMBERS if name in held), None)
            if member is None:
                raise ValueError(f"no Anki collection in the export: {sorted(held)}")
            blob = bundle.read(member)
            return zstd.decompress(blob) if member == ZSTD_MEMBER else blob
    except zipfile.BadZipFile as error:
        raise ValueError("not an Anki export: the bytes are not a zip") from error


def _deck_names(db: sqlite3.Connection) -> dict[int, str]:
    """Every deck id in the collection against its name, nesting spelled with `/`."""
    try:
        rows = db.execute("SELECT id, name FROM decks").fetchall()
    except sqlite3.OperationalError:
        # Before schema 18 there was no decks table: the whole deck list sat in
        # one JSON object on the single row of `col`, keyed by deck id, and
        # nesting was spelled `Certs::AWS` rather than with the separator.
        rows = db.execute("SELECT decks FROM col").fetchall()
        listing = json.loads(rows[0][0]) if rows else {}
        return {int(did): deck["name"].replace("::", "/") for did, deck in listing.items()}
    return {did: name.replace(SEPARATOR, "/") for did, name in rows}
