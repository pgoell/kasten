"""Reading an Anki `.apkg` export into decks of front-and-back cards.

An `.apkg` is a zip around an sqlite database, so the whole reader is standard
library: `zipfile`, `sqlite3`, and `compression.zstd` for the collection Anki
writes today. A dependency would buy nothing a few queries do not.

A card is what Anki shows, not what the note holds. A note has as many fields as
its note type declares, and each card row names one of the type's templates; the
question is that template's front rendered over the note's fields, the answer
its back. The renderer below is the part of Anki's template language a card
needs to come out the same: field replacements, filters, and conditional
sections. A cloze note type is the exception and keeps the first two fields,
because its templates only mean something once cloze is rendered (#233).

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

ZSTD_MEMBER = "collection.anki21b"
"""The only member that is compressed rather than an sqlite file as it stands."""

CLOZE_KIND = 1
"""A note type's kind when it is a cloze type, in `col.models` and in its protobuf config alike."""

_CLOZE = re.compile(r"\{\{c\d+::(.*?)(?:::.*?)?\}\}")
"""One cloze deletion, with the hint the author may have written after it.

The hint is part of the match and not of the group, so it is dropped: a
highlight in a markdown note has nowhere to put it.
"""

_SOUND = re.compile(r"\[sound:[^\]]*\]")
_CODE = re.compile(r"<(script|style)\b.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
_BREAK = re.compile(r"<\s*(?:br\s*/?|/\s*(?:div|p))\s*>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]*>")
_MEDIA = re.compile(r"<img|\[sound:", re.IGNORECASE)
_TOKEN = re.compile(r"\{\{(.*?)\}\}|<!--.*?-->", re.DOTALL)
"""A handlebar or an HTML comment: Anki lexes the comment whole, so a field inside it is not one."""
_VARINT, _LENGTH = 0, 2
_FIXED = {1: 8, 5: 4}
"""The protobuf wire types of a fixed-width field, against how many bytes it takes."""
_EMPTY = re.compile(r"(?:\s|</?(?:br|div) ?/?>)*", re.IGNORECASE)
"""Anki's own test for an empty field: an editor leaves `<br>` and `<div>` behind."""
_SCHEDULE = re.compile(r"<!--SR:!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)-->")
"""`SR` in `card-line.ts`, the whole comment: `srs.ts` stops a back at nothing less."""
_HEADING = re.compile(r"#{1,6}[ \t]")
"""`HEADING` in `srs.ts`."""
_ONLY_TAGS = re.compile(r"(?:#[^\W\d][\w/-]*[ \t]*)+")
"""`ONLY_TAGS` in `deck-tag.ts`, `[^\\W\\d]` and `\\w` standing in for the `\\p{L}` `re` lacks."""


@dataclass(frozen=True)
class Template:
    """One card template of a note type: its front and its back."""

    name: str
    qfmt: str
    afmt: str


@dataclass(frozen=True)
class Card:
    """One Anki card as two lines of text, with what it was rendered from kept beside it."""

    front: str
    back: str
    fields: dict[str, str]
    template: Template
    notetype: str
    cloze: bool


@dataclass(frozen=True)
class Deck:
    """One Anki deck, as much of it as a markdown note can hold."""

    name: str
    cards: list[Card]
    dropped_media: int


@dataclass(frozen=True)
class _NoteType:
    name: str
    cloze: bool
    fields: list[str]
    templates: dict[int, Template]


@dataclass(frozen=True)
class _Field:
    key: str
    filters: list[str]


@dataclass(frozen=True)
class _Section:
    key: str
    negated: bool
    children: list[_Node]


type _Node = str | _Field | _Section


def plain(field: str) -> str:
    """One Anki field as a single line of markdown.

    A card is one line, so every break in the field becomes a space and the
    result never holds a newline.
    """
    text = _SOUND.sub("", field)
    # Before the tag strip, which would leave a script's code behind as prose.
    text = _CODE.sub("", text)
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
            zstd or sqlite refuses to read, or one whose decks, note types or
            note fields cannot be read.
    """
    blob = _collection(data)
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
            except sqlite3.Error as error:
                raise ValueError(f"unreadable Anki collection: {error}") from error

    if notes and not any(mid in types for mid, _ in notes.values()):
        raise ValueError("no note type in the collection matches its notes")

    cards: defaultdict[str, list[Card]] = defaultdict(list)
    dropped: Counter[str] = Counter()
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
            # One card per note, however many deletions it has: the rows differ
            # only in which deletion they hide, which a plain line cannot show.
            if nid in clozed or not kind.templates:
                continue
            clozed.add(nid)
            template = kind.templates[min(kind.templates)]
            question, answer = values[0], values[1] if len(values) > 1 else ""
        else:
            template = kind.templates.get(ord_)
            if template is None:
                continue
            question, filled = _render(_parse(template.qfmt), fields, question=True)
            if not filled:
                continue
            answer, _ = _render(_parse(template.afmt), fields, question=False)
        card = Card(plain(question), plain(answer), fields, template, kind.name, kind.cloze)
        cards[name].append(card)
        if _MEDIA.search(question) or _MEDIA.search(answer):
            dropped[name] += 1

    return [Deck(name, deck, dropped[name]) for name, deck in sorted(cards.items())]


def as_note(deck: Deck) -> str:
    """`deck` as one markdown note: the tag line, a blank line, then a line per card.

    A card with no front is left out, since there is nothing to ask. A card with
    no back is kept as `front::`, which kasten reads as a question parked
    without an answer: a back that adds nothing beyond the front is common in
    Anki, and dropping the line would lose the question with it.

    A front holding `::` is the exception to the one line. A card line splits at
    its first `::`, so `std::move` would cut the question short; such a card is
    written as front, `?` and back, with a blank line either side so the `?`
    card's front and back do not run into the lines next to it. It is left out
    where a side cannot stand in that form: an empty back, since `srs.ts` asks
    no `?` with nothing under it and `review.ts` would count one; a back of `?`,
    which `review.ts` counts as a second card; and a side `srs.ts` ends a card
    on, a heading, a line of tags, the parking token or, on the back only, a
    whole schedule comment, which drops the `?` card there and reads the front
    at its first `::` after all. `note_cards` holds these rules. The
    one-line form that parks a question is the form this card cannot take.
    """
    # A tag runs to the first space, so a deck called "AWS Certification" would
    # otherwise land in a deck called `AWS` with the rest of its name read as
    # prose. The note's `# heading` is not the deck name; the tag is.
    head = [f"#flashcards/{re.sub(r'\s+', '-', deck.name)}", ""]
    body: list[str] = []
    for card in note_cards(deck):
        if "::" not in card.front:
            body.append(f"{card.front}::{card.back}")
        else:
            if body and body[-1]:
                body.append("")
            body += [card.front, "?", card.back, ""]
    # The blank a `?` card leaves under itself is a separator, not part of the
    # note, so the last one comes off rather than ending the note on two breaks.
    if body and not body[-1]:
        body.pop()
    return "\n".join(head + body) + "\n"


def note_cards(deck: Deck) -> list[Card]:
    """The cards of `deck` that `as_note` writes, in order, by the rules its docstring gives.

    Its own function so the import's count and the note agree on which they are.
    """
    return [
        card
        for card in deck.cards
        if card.front
        and (
            "::" not in card.front
            or not (
                _ends_card(card.front)
                or _ends_card(card.back)
                or _SCHEDULE.search(card.back)
                or card.back == "?"
            )
        )
    ]


def _ends_card(line: str) -> bool:
    """Whether `srs.ts` `breaks()` would end a `?` card on `line`, so it cannot be a side of one.

    A side here is one stripped line, so blank means empty. The schedule `srs.ts`
    also stops a back at is checked apart, since it stops no front.
    """
    return (
        not line
        or line.startswith("!suspended")
        or _HEADING.match(line) is not None
        or _ONLY_TAGS.fullmatch(line) is not None
    )


def _parse(template: str) -> list[_Node]:
    """`template` as a tree of text, field replacements and conditional sections.

    One pass over the template, never over a field's value: a value holding
    `{{Back}}` is text, the way Anki shows it. A section left open runs to the
    end and a stray close is ignored, so a broken template still gives a card.
    """
    root: list[_Node] = []
    stack = [root]
    start = 0
    for match in _TOKEN.finditer(template):
        stack[-1].append(template[start : match.start()])
        start = match.end()
        if match.group(1) is None:
            # A comment, which Anki hands to the browser to hide; a markdown
            # line would show it, so it goes.
            continue
        # `{{{Front}}}` is a slip Anki forgives: the handlebar ends at the first
        # `}}`, the extra `{` is dropped, and the last `}` stays as text.
        tag = match.group(1).lstrip("{").strip()
        if tag.startswith(("#", "^")):
            section = _Section(tag[1:].strip(), tag[0] == "^", [])
            stack[-1].append(section)
            stack.append(section.children)
        elif tag.startswith("/"):
            if len(stack) > 1:
                stack.pop()
        else:
            *filters, key = tag.split(":")
            stack[-1].append(_Field(key.strip(), [f.strip() for f in filters]))
    stack[-1].append(template[start:])
    return root


def _render(nodes: list[_Node], fields: dict[str, str], *, question: bool) -> tuple[str, bool]:
    """`nodes` rendered over `fields`, and whether a non-empty field went into it.

    That second answer is Anki's test for making a card at all: a front of
    literal text and nothing else is still an empty front.
    """
    parts: list[str] = []
    filled = False
    for node in nodes:
        if isinstance(node, str):
            parts.append(node)
        elif isinstance(node, _Section):
            if _empty(fields.get(node.key, "")) != node.negated:
                continue
            text, inner = _render(node.children, fields, question=question)
            parts.append(text)
            filled = filled or inner
        else:
            value = _replacement(node, fields, question=question)
            parts.append(value)
            filled = filled or not _empty(value)
    return "".join(parts), filled


def _replacement(node: _Field, fields: dict[str, str], *, question: bool) -> str:
    """What one `{{...}}` shows.

    `FrontSide`, the special fields and a field the note type lacks all show
    nothing: the back would otherwise repeat the question, and the rest are
    Anki's view of the card rather than anything the author wrote.
    """
    # `type:` asks for typed input on the front and shows the field on the back;
    # `tts` reads it aloud. Neither has text a markdown line could carry.
    if any(f == "tts" or f.startswith("tts ") for f in node.filters):
        return ""
    if question and "type" in node.filters:
        return ""
    return fields.get(node.key, "")


def _empty(value: str) -> bool:
    return _EMPTY.fullmatch(value) is not None


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
    except zstd.ZstdError as error:
        raise ValueError(f"unreadable Anki export: {member} is not zstd: {error}") from error


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
