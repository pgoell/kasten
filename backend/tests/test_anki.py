"""What an Anki `.apkg` export turns into, and what it refuses to import.

The fixtures are built here rather than checked in: an export is a zip around an
sqlite file, and a real one carries a hundred columns of scheduling state none of
this reads. The builder below writes only the columns the reader touches, in the
two schemas Anki has written, so a test says which schema it is about instead of
a binary blob saying nothing. The note types are the shapes a real export from
Anki 26.09 holds, templates and all.
"""

import asyncio
import hashlib
import io
import json
import re
import sqlite3
import struct
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from compression import zstd
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest

from kasten_backend import anki, files, main
from kasten_backend.anki import (
    _MARK,
    Card,
    Deck,
    Template,
    _replaced,
    _Span,
    as_note,
    card_count,
    merge,
    plain,
    read_apkg,
)

if TYPE_CHECKING:
    from httpx import AsyncClient

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


def apkg(
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


def test_plain_strips_a_tag_it_has_no_markdown_for() -> None:
    # `<span>` leaves no space behind: only the tags that end a line do (#234).
    assert plain('one<span class="x">two</span><font>three</font>') == "onetwothree"


def test_plain_unescapes_entities() -> None:
    assert plain("salt&nbsp;&amp;&nbsp;pepper") == "salt & pepper"


def test_plain_drops_an_image_and_a_sound() -> None:
    assert plain('<img src="cat.jpg"> a cat [sound:meow.mp3] purring') == "a cat purring"


def test_plain_keeps_a_cloze_mark_only_for_a_cloze_note() -> None:
    # Anki shows the marks of a note that is not a cloze type as typed, and a
    # mark kept there would make kasten ask a card Anki never did.
    assert plain("{{c1::Paris}} is the capital") == "==Paris== is the capital"
    assert plain("{{c1::Paris}} is the capital", cloze=True) == "{{c1::Paris}} is the capital"


def test_plain_keeps_a_cloze_hint_for_a_cloze_note() -> None:
    field = "{{c1::Paris::a city}} is in {{c2::<b>France</b>}}"

    assert plain(field) == "==Paris== is in ==France=="
    assert plain(field, cloze=True) == "{{c1::Paris::a city}} is in {{c2::France}}"


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        (r"{{c1::\(x^{2}\)}} is the square", r"==\\(x^{2}\\)== is the square"),
        ("{{c1::}} x", "==== x"),
        (r"{{c1::\(x^{2}\)}} is {{c2::the square}}", r"==\\(x^{2}\\)== is {{c2::the square}}"),
    ],
    ids=["brace", "empty", "mixed"],
)
def test_plain_highlights_a_cloze_mark_kasten_cannot_read(field: str, expected: str) -> None:
    # `MARK` in `card-line.ts` takes no brace and no empty text, and a mark it
    # does not read would leave its `::` to split the line.
    assert plain(field, cloze=True) == expected


def test_plain_answers_with_one_line() -> None:
    result = plain("first\nsecond  \t third \n")

    assert "\n" not in result
    assert result == "first second third"


def test_plain_drops_script_and_style_blocks() -> None:
    assert plain("<style>.card { color: red }</style>a<SCRIPT>var x = 1;</script>b") == "ab"


def test_plain_writes_breaks_and_paragraphs_as_lines() -> None:
    field = "one<br>two<div>three</div><p>four</p>five"

    assert plain(field) == "one\ntwo\nthree\nfour\nfive"


def test_plain_leaves_no_blank_line_in_a_side() -> None:
    # `srs.ts` ends a `?` card at a blank line, so a run of breaks is one.
    assert plain("a<br><br><br>b<p></p><div><br></div><p>c</p>") == "a\nb\nc"


def test_plain_writes_bold_italic_and_underline_as_bold() -> None:
    field = "<b>a</b> <strong>b</strong> <i>c</i> <em>d</em> <u>e</u> <b> f </b>"

    assert plain(field) == "**a** **b** *c* *d* **e** **f**"


def test_plain_writes_lists_a_line_per_item() -> None:
    field = "<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>"

    assert plain(field) == "- one\n- two\n1. first\n2. second"


def test_plain_writes_links() -> None:
    field = 'see <a href="https://example.com/a (b)">the site</a> now'

    assert plain(field) == "see [the site](https://example.com/a%20%28b%29) now"


def test_plain_writes_code_and_pre_with_backticks() -> None:
    # No fence: both readers skip every card inside one.
    assert plain("use <code>a*b</code>") == "use `a*b`"
    assert plain("<pre>x = `1`\n  y</pre>") == "`` x = `1` ``\n`  y`"


def test_plain_keeps_ruby_and_drops_its_parentheses() -> None:
    field = "<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>"

    assert plain(field) == "<ruby>漢字<rt>かんじ</rt></ruby>"


def test_plain_escapes_markdown_characters_in_text() -> None:
    field = "2*3, snake_case, `x`, [y], a == b, <b>bold</b>"

    assert plain(field) == r"2\*3, snake\_case, \`x\`, \[y], a \=\= b, **bold**"


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        ("# of elements", r"\# of elements"),
        ("?", r"\?"),
        ("!suspended x", r"\!suspended x"),
        ("#pragma #once", r"\#pragma #once"),
        ("on &lt;!--SR:!2026-08-20,4,270--&gt; here", r"on <!--SR\:!2026-08-20,4,270--> here"),
        ("a<br># b<br>?", "a\n\\# b\n\\?"),
    ],
    ids=["heading", "divider", "token", "tags", "schedule", "per-line"],
)
def test_plain_escapes_a_line_that_would_end_a_card(field: str, expected: str) -> None:
    # Kept as text with a backslash rather than dropped: each of these is a line
    # `srs.ts` ends a `?` card on, or counts as a card of its own.
    assert plain(field) == expected


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


def test_furigana_filters_follow_anki() -> None:
    notes = ((1, FURIGANA, "x\x1f漢字[かんじ]を&nbsp;読[よ]む"),)
    cards = ((11, 1, 100, 0), (12, 1, 100, 1), (13, 1, 100, 2))

    assert one_deck(notes, cards, types=(*TYPES, FURIGANA_TYPE)) == [
        ("x", "<ruby>漢字<rt>かんじ</rt></ruby>を<ruby>読<rt>よ</rt></ruby>む"),
        ("漢字を読む", "かんじをよむ"),
        # No filter shows the brackets as stored, which is what Anki shows.
        (r"漢字\[かんじ]を 読\[よ]む", "x"),
    ]


def test_furigana_inside_a_cloze_mark_leaves_the_mark_whole() -> None:
    # Anki fills the furigana in after the cloze, where the mark is a tag and
    # `>` stops the base; read raw, the base would swallow `{{c1::`.
    notes = ((1, FURIGANA, "x\x1f{{c1::漢字[かんじ]}}を"),)

    assert one_deck(notes, ((11, 1, 100, 0),), types=(*TYPES, FURIGANA_TYPE)) == [
        ("x", "==<ruby>漢字<rt>かんじ</rt></ruby>==を")
    ]


def test_a_literal_anki_marker_in_a_field_is_escaped() -> None:
    # A re-import finds its cards by the marker, so one in the text would claim
    # a card that is not there; the back of a hand-built `?` card is refused.
    field = "the &lt;!--anki:7:0--&gt; comment"
    notes = ((1, BASIC, f"What is a::b?\x1f{field}"), (2, CLOZE, f"{{{{c1::x}}}} {field}\x1f"))
    deck = read_apkg(apkg(notes, ((11, 1, 100, 0), (21, 2, 100, 0)), ((100, "x"),)))[0]

    assert plain(field) == r"the <!--anki\:7:0--> comment"
    assert as_note(deck).count("<!--anki:") == 2
    assert as_note(basic_deck(("What is a::b?", "the <!--anki:7:0--> comment"))) == (
        "#flashcards/x\n\n"
    )


def test_plain_escapes_the_parking_token_anywhere_in_a_line() -> None:
    # `suspended()` in `card-line.ts` reads the token after any space, and
    # would park the card the answer only mentions it in.
    assert plain("type x !suspended there") == r"type x \!suspended there"


@pytest.mark.parametrize(
    ("cloze", "expected"),
    [(True, r"x {{c1::a \!suspended b}} y"), (False, r"x ==a \!suspended b== y")],
    ids=["cloze", "highlight"],
)
def test_plain_escapes_the_parking_token_inside_a_cloze_mark(cloze: bool, expected: str) -> None:
    # A mark skips the parse, and its text would park the line all the same.
    assert plain("x {{c1::a !suspended b}} y", cloze=cloze) == expected


def test_a_cloze_mark_keeps_ruby_with_attributes_as_bare_tags() -> None:
    field = '{{c1::<ruby class="x">漢字<rt class="y">かんじ</rt></ruby>}}'

    assert plain(field, cloze=True) == "{{c1::<ruby>漢字<rt>かんじ</rt></ruby>}}"


def test_plain_keeps_the_address_of_a_link_over_a_break() -> None:
    assert plain('<a href="https://x.org">a<br>b</a>') == "[a b](https://x.org)"


def test_a_multi_line_side_takes_the_question_form() -> None:
    notes = ((1, BASIC, "Name three<br>colours\x1f<ul><li>red</li><li>green</li></ul>"),)
    decks = read_apkg(apkg(notes, CARDS[:1], ((100, "x"),)))

    assert unhashed(as_note(decks[0])) == (
        f"#flashcards/x\n\nName three\ncolours\n?\n- red\n- green{mark(1)}\n"
    )


def test_a_multi_line_front_with_no_back_is_parked_on_one_line() -> None:
    # A `?` with nothing under it is no card, so the breaks become spaces.
    decks = read_apkg(apkg(((1, SOLO, "one<br>two"),), CARDS[:1], ((100, "x"),)))

    assert unhashed(as_note(decks[0])) == f"#flashcards/x\n\none two::{mark(1)}\n"


def test_an_imported_side_that_would_end_the_card_is_kept_as_text() -> None:
    notes = ((1, BASIC, "Is a::b valid?\x1f?<br>```js"),)
    decks = read_apkg(apkg(notes, CARDS[:1], ((100, "x"),)))

    assert unhashed(as_note(decks[0])) == (
        f"#flashcards/x\n\nIs a::b valid?\n?\n\\?\n\\`\\`\\`js{mark(1)}\n"
    )
    assert card_count(decks[0]) == 1


def test_a_cloze_text_stays_one_line_and_its_extra_runs_over_lines() -> None:
    notes = ((1, CLOZE, "{{c1::Paris}}<br>is the capital\x1fOn the<br><b>Seine</b>"),)
    decks = read_apkg(apkg(notes, CARDS[:1], ((100, "x"),)))

    assert unhashed(as_note(decks[0])) == (
        f"#flashcards/x\n\n{{{{c1::Paris}}}} is the capital\n?\nOn the\n**Seine**{mark(1)}\n"
    )
    assert card_count(decks[0]) == 1


COUNTED_NOTE = """#flashcards/French

Name three
colours
?
- red
- green <!--anki:1:0:c7b4cdb4-->

漢字::<ruby>漢字<rt>かんじ</rt></ruby> <!--anki:2:0:6e5a75f5-->

{{c1::Paris}} is in {{c2::France}}
?
On the
Seine <!--anki:3:0:572ce8f6-->

What does std::size count?
?
\\# of elements
\\!suspended no <!--anki:4:0:1b669e79-->
"""
"""The note `frontend/tests/srs.test.ts` reads back, holding five cards."""


def test_each_card_carries_its_anki_note_and_template_on_its_last_line() -> None:
    notes = (
        (1, REVERSED, "Paris\x1fcapital"),
        (2, CLOZE, "{{c1::H}} and {{c2::O}}\x1f"),
        (3, BASIC, "What does std::move do?\x1fcasts"),
        (4, CLOZE, "{{c1::Seine}} river\x1fin Paris"),
    )
    cards = ((11, 1, 100, 0), (12, 1, 100, 1), (21, 2, 100, 1), (22, 2, 100, 0))
    cards += ((31, 3, 100, 0), (41, 4, 100, 0))
    deck = read_apkg(apkg(notes, cards, ((100, "x"),)))[0]

    # The hash is of the lines the import wrote, so a re-import can tell them
    # from lines edited since.
    cloze, divided = "{{c1::H}} and {{c2::O}}", "What does std::move do?\n?\ncasts"
    seine = "{{c1::Seine}} river\n?\nin Paris"
    assert as_note(deck) == (
        f"#flashcards/x\n\nParis::capital{marked(1, 'Paris::capital')}\n"
        f"capital::Paris{marked(1, 'capital::Paris', 1)}\n"
        f"{cloze}{marked(2, cloze)}\n\n{divided}{marked(3, divided)}\n\n"
        f"{seine}{marked(4, seine)}\n"
    )


def test_a_re_import_adds_the_cards_that_are_new() -> None:
    old = as_note(basic_deck(("a", "b")))

    merged = merge(old, basic_deck(("a", "b"), ("c", "d"), ("What is a::b?", "e")))

    assert merged is not None
    assert merged.text == (
        f"#flashcards/x\n\na::b{marked(1, 'a::b')}\nc::d{marked(2, 'c::d')}\n\n"
        f"What is a::b?\n?\ne{marked(3, 'What is a::b?\n?\ne')}\n"
    )
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (2, 0, 1, 0)


def test_a_re_import_updates_the_text_of_cards_anki_changed() -> None:
    old = as_note(basic_deck(("a", "b"), ("What is a::b?", "e"), ("c", "d")))

    merged = merge(old, basic_deck(("a", "B"), ("What is a::b?", "e\nf"), ("c", "d")))

    assert merged is not None
    assert unhashed(merged.text) == (
        f"#flashcards/x\n\na::B{mark(1)}\n\nWhat is a::b?\n?\ne\nf{mark(2)}\n\nc::d{mark(3)}\n"
    )
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 2, 1, 0)


SR1, SR2, SR3 = (f"<!--SR:!2026-10-2{day},{day},250-->" for day in (1, 2, 3))
CLOZED = "<!--SR:c1!2026-10-24,4,250--> <!--SR:c2!2026-10-25,5,250-->"

ANSWERED_NOTE = f"""---
id: 1
modified: 2026-10-01T00:00:00+00:00
---
#flashcards/x

a::b{marked(1, "a::b")} !suspended {SR1}
c::d{marked(2, "c::d")} {SR2}
{{{{c1::H}}}} and {{{{c2::O}}}}{marked(3, "{{c1::H}} and {{c2::O}}")} {CLOZED}

What is a::b?
?
e{marked(4, "What is a::b?\n?\ne")}
!suspended {SR3}

What is c::d?
?
f{marked(5, "What is c::d?\n?\nf")}
{SR1}

What is e::f?
?
g{marked(6, "What is e::f?\n?\ng")}
!suspended
"""
"""A deck's note after a few ratings and parkings, each in the shape `srs.ts` writes."""


def answered_deck(*, changed: bool) -> Deck:
    """The deck `ANSWERED_NOTE` came from, or the same with every card's text changed."""
    end = "!" if changed else ""
    template = Template("Cloze", "{{cloze:Text}}", "{{cloze:Text}}")
    deck = basic_deck(
        ("a", f"b{end}"),
        ("c", f"d{end}"),
        ("x", "x"),
        ("What is a::b?", f"e{end}"),
        ("What is c::d?", f"f{end}"),
        ("What is e::f?", f"g{end}"),
    )
    cloze = Card(f"{{{{c1::H}}}} and {{{{c2::O}}}}{end}", "", {}, template, "Cloze", True, 3, 0)
    return Deck("x", [*deck.cards[:2], cloze, *deck.cards[3:]], {})


def test_a_re_import_keeps_the_schedule_and_park_of_every_answered_card() -> None:
    kept = merge(ANSWERED_NOTE, answered_deck(changed=False))
    updated = merge(ANSWERED_NOTE, answered_deck(changed=True))

    assert kept is not None
    assert updated is not None
    assert kept.text == ANSWERED_NOTE
    assert (kept.kept, kept.updated) == (6, 0)
    assert (updated.kept, updated.updated) == (0, 6)
    expected = unhashed(ANSWERED_NOTE)
    for nid in range(1, 7):
        expected = expected.replace(mark(nid), f"!{mark(nid)}")
    assert unhashed(updated.text) == expected


def test_cards_removed_in_anki_are_counted_and_stay_in_the_note() -> None:
    kept = answered_deck(changed=False)

    merged = merge(ANSWERED_NOTE, Deck("x", [kept.cards[0], kept.cards[5]], {}))

    assert merged is not None
    assert merged.text == ANSWERED_NOTE
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 0, 2, 4)


def test_a_re_import_leaves_unmarked_lines_byte_for_byte() -> None:
    # The user's own prose and cards, trailing spaces and all, and a `?` card of
    # theirs at the end that an added card must not run into.
    head = "---\nid: 1\n---\n#flashcards/x  \n\n# Mine\nSome prose  \t\n"
    old = f"{head}a::b{marked(1, 'a::b')}\nmine::own\n\nMy q\n?\nmy a"

    merged = merge(old, basic_deck(("a", "B"), ("c", "d")))

    assert merged is not None
    assert merged.text == (
        f"{head}a::B{marked(1, 'a::B')}\nmine::own\n\nMy q\n?\nmy a\n\nc::d{marked(2, 'c::d')}\n"
    )


def test_a_line_right_above_an_imported_question_card_stays() -> None:
    # No blank line parts the user's line from the card, so only the hash says
    # where the card starts.
    card = "q1\nq2\n?\na"
    old = f"#flashcards/x\n\nMy heading note\n{card}{marked(1, card)}\n{SR1}\n"

    unchanged = merge(old, basic_deck(("q1\nq2", "a")))
    changed = merge(old, basic_deck(("q1\nq2", "A")))

    assert unchanged is not None
    assert changed is not None
    assert unchanged.text == old
    assert unhashed(changed.text) == (
        f"#flashcards/x\n\nMy heading note\n\nq1\nq2\n?\nA{mark(1)}\n{SR1}\n"
    )


def test_a_users_question_card_right_above_an_imported_card_stays() -> None:
    old = f"#flashcards/x\n\nmine q\n?\nmine a\nz::z{marked(1, 'z::z')} {SR1}\n"

    merged = merge(old, basic_deck(("z", "Z")))

    # Glued under it, `z::z` reads as part of the user's answer, so it stays too.
    assert merged is not None
    assert (merged.text, merged.kept, merged.updated) == (old, 1, 0)


def test_two_question_cards_with_no_blank_between_keep_their_own_schedules() -> None:
    first, second = "q\n?\na", "r\n?\nb"
    old = f"#flashcards/x\n\n{first}{marked(1, first)}\n{SR1}\n{second}{marked(2, second)}\n"

    merged = merge(old, basic_deck(("q", "a\nx"), ("r", "B")))

    assert merged is not None
    assert merged.updated == 2
    assert unhashed(merged.text) == (
        f"#flashcards/x\n\nq\n?\na\nx{mark(1)}\n{SR1}\n\nr::B{mark(2)}\n"
    )


def test_overlapping_spans_replace_only_the_first() -> None:
    # `_spans` finds none today; were it to, the later would eat the earlier.
    lines = ["a", "b", "c", "d"]
    replaced = {
        0: (_Span(0, 2, "", True, False, []), ["X"]),
        1: (_Span(1, 3, "", True, False, []), ["Y"]),
    }

    assert _replaced(lines, replaced) == (["X", "d"], 1)


def test_a_card_edited_in_kasten_is_kept_whatever_anki_did() -> None:
    old = f"#flashcards/x\n\nb::my better answer{marked(1, 'b::c')} {SR1}\n"

    same = merge(old, basic_deck(("b", "c")))
    changed = merge(old, basic_deck(("b", "C")))

    assert same is not None
    assert changed is not None
    assert (same.text, same.kept, same.updated) == (old, 1, 0)
    assert (changed.text, changed.kept, changed.updated) == (old, 1, 0)


def test_a_note_with_crlf_line_ends_merges_without_mixing_them() -> None:
    old = as_note(basic_deck(("q1\nq2", "a"), ("b", "c"))).replace("\n", "\r\n")

    same = merge(old, basic_deck(("q1\nq2", "a"), ("b", "c")))
    changed = merge(old, basic_deck(("q1\nq2", "A"), ("b", "c"), ("d", "e")))

    assert same is not None
    assert changed is not None
    assert (same.text, same.kept, same.updated) == (old, 2, 0)
    assert (changed.added, changed.updated, changed.kept) == (1, 1, 1)
    assert unhashed(changed.text) == (
        f"#flashcards/x\r\n\r\nq1\r\nq2\r\n?\r\nA{mark(1)}\r\n\r\nb::c{mark(2)}\r\nd::e{mark(3)}\r\n"
    )


def test_a_card_inside_a_users_question_card_is_never_updated() -> None:
    # Glued under the user's `?` card, the line is part of their answer to
    # kasten, and the schedule under it is theirs.
    old = f"#flashcards/x\n\nmy q\n?\nmy a\nq1::a1{marked(1, 'q1::a1')}\n{SR1}\n"

    merged = merge(old, basic_deck(("q1", "a1 now\nover two lines")))

    assert merged is not None
    assert (merged.text, merged.kept, merged.updated) == (old, 1, 0)


def test_a_card_added_after_one_inside_a_users_question_card_starts_apart() -> None:
    old = f"#flashcards/x\n\nmy q\n?\nmy a\nq1::a1{marked(1, 'q1::a1')}\n"

    merged = merge(old, basic_deck(("q1", "a1"), ("q2", "a2")))

    assert merged is not None
    assert merged.text == f"{old}\nq2::a2{marked(2, 'q2::a2')}\n"


def test_a_shape_change_carries_the_schedule_into_the_new_shape() -> None:
    old = (
        f"#flashcards/x\n\na::b{marked(1, 'a::b')} !suspended {SR1}\nc::d{marked(2, 'c::d')}\n\n"
        f"What is a::b?\n?\ne{marked(3, 'What is a::b?\n?\ne')}\n{SR2}\n\n"
        f"z::z{marked(4, 'z::z')}\n"
    )

    merged = merge(old, basic_deck(("a", "b\nmore"), ("c", "d"), ("What is a?", "e"), ("z", "z")))

    assert merged is not None
    assert unhashed(merged.text) == (
        f"#flashcards/x\n\na\n?\nb\nmore{mark(1)}\n!suspended {SR1}\n\nc::d{mark(2)}\n\n"
        f"What is a?::e{mark(3)} {SR2}\n\nz::z{mark(4)}\n"
    )
    assert merged.updated == 2


def test_card_count_is_what_srs_reads_off_the_note() -> None:
    notes = (
        (1, BASIC, "Name three<br>colours\x1f<ul><li>red</li><li>green</li></ul>"),
        (2, FURIGANA, "漢字\x1f漢字[かんじ]"),
        (3, CLOZE, "{{c1::Paris}} is in<br>{{c2::France}}\x1fOn the<p>Seine</p>"),
        (4, BASIC, "What does std::size count?\x1f# of elements<br>!suspended no"),
    )
    cards = ((11, 1, 100, 0), (21, 2, 100, 0), (31, 3, 100, 0), (41, 4, 100, 0))
    deck = read_apkg(apkg(notes, cards, types=(*TYPES, FURIGANA_TYPE)))[0]

    assert as_note(deck) == COUNTED_NOTE
    assert card_count(deck) == 5


@pytest.mark.parametrize("layout", LAYOUTS)
def test_reads_note_types_and_their_templates(layout: dict[str, Any]) -> None:
    assert sides(read_apkg(apkg(**layout))) == EXPECTED


def test_reads_the_compressed_old_schema_the_same_way() -> None:
    assert sides(read_apkg(apkg(member="collection.anki21b"))) == EXPECTED


def test_reads_the_uncompressed_schema_18_the_same_way() -> None:
    assert sides(read_apkg(apkg(schema18=True, member="collection.anki21"))) == EXPECTED


@pytest.mark.parametrize("layout", LAYOUTS)
def test_a_card_keeps_its_fields_template_and_note_type(layout: dict[str, Any]) -> None:
    card = read_apkg(apkg(**layout))[0].cards[0]

    assert card == Card(
        "Bonjour",
        "hello",
        {"Front": "Bonjour", "Back": "hello"},
        Template("Card 1", "{{Front}}", "{{FrontSide}}<hr id=answer>{{Back}}"),
        "Basic",
        cloze=False,
        nid=1,
        ord=0,
    )


@pytest.mark.parametrize("layout", LAYOUTS)
def test_basic_and_reversed_gives_two_cards(layout: dict[str, Any]) -> None:
    notes = ((1, REVERSED, "Paris\x1fcapital of France"),)
    cards = ((11, 1, 100, 0), (12, 1, 100, 1))

    assert one_deck(notes, cards, **layout) == [
        ("Paris", "capital of France"),
        ("capital of France", "Paris"),
    ]


@pytest.mark.parametrize("layout", LAYOUTS)
def test_three_templates_give_three_cards(layout: dict[str, Any]) -> None:
    notes = ((1, JAPANESE, "漢字\x1fChinese characters\x1flisten here\x1fかんじ"),)
    cards = ((11, 1, 100, 0), (12, 1, 100, 1), (13, 1, 100, 2))

    assert one_deck(notes, cards, **layout) == [
        ("listen here", "漢字\nChinese characters"),
        ("Chinese characters", "漢字"),
        ("漢字", "かんじ Chinese characters"),
    ]


@pytest.mark.parametrize("layout", LAYOUTS)
def test_a_template_without_a_card_row_makes_no_card(layout: dict[str, Any]) -> None:
    notes = ((1, REVERSED, "Paris\x1fcapital of France"),)

    assert one_deck(notes, ((11, 1, 100, 1),), **layout) == [("capital of France", "Paris")]


@pytest.mark.parametrize("layout", LAYOUTS)
def test_a_field_the_front_uses_in_any_position_is_the_question(layout: dict[str, Any]) -> None:
    notes = ((1, JAPANESE, "漢字\x1fChinese characters\x1flisten here\x1fかんじ"),)

    assert one_deck(notes, ((11, 1, 100, 0),), **layout) == [
        ("listen here", "漢字\nChinese characters")
    ]


@pytest.mark.parametrize("layout", LAYOUTS)
def test_imports_a_note_with_one_field(layout: dict[str, Any]) -> None:
    assert one_deck(((1, SOLO, "alone"),), ((11, 1, 100, 0),), **layout) == [("alone", "")]


@pytest.mark.parametrize("layout", LAYOUTS)
def test_front_side_on_the_back_shows_nothing(layout: dict[str, Any]) -> None:
    card = read_apkg(apkg(**layout))[0].cards[0]

    assert "{{FrontSide}}" in card.template.afmt
    assert card.back == "hello"


@pytest.mark.parametrize("layout", LAYOUTS)
def test_conditional_sections_follow_anki(layout: dict[str, Any]) -> None:
    notes = ((1, COND, "F1\x1fB1\x1fX1"), (2, COND, "F2\x1fB2\x1f"))
    cards = ((11, 1, 100, 0), (12, 1, 100, 1), (21, 2, 100, 0), (22, 2, 100, 1))

    # The second note's `C2` front is literal text with nothing in it, so Anki
    # makes no card from it.
    assert one_deck(notes, cards, **layout) == [
        ("Extra: X1", "B1"),
        ("Label only X1", "B1"),
        ("F2", "B2"),
    ]


def test_conditional_sections_nest() -> None:
    types: tuple[NoteType, ...] = (
        (
            1,
            "Nest",
            0,
            ("A", "B"),
            (("N", "{{#A}}a{{#B}}b{{B}}{{/B}}{{^B}}no b {{A}}{{/B}}{{/A}}", "{{A}}"),),
        ),
    )
    notes = ((1, 1, "x\x1fy"), (2, 1, "x\x1f"), (3, 1, "\x1fy"))
    cards = ((11, 1, 100, 0), (21, 2, 100, 0), (31, 3, 100, 0))

    data = apkg(notes, cards, ((100, "D"),), types=types)

    assert sides(read_apkg(data)) == {"D": [("aby", "x"), ("ano b x", "x")]}


@pytest.mark.parametrize("layout", LAYOUTS)
def test_a_card_whose_front_renders_empty_is_not_made(layout: dict[str, Any]) -> None:
    notes = ((1, JAPANESE, "水\x1fwater\x1f\x1fみず"),)
    cards = ((11, 1, 100, 0), (12, 1, 100, 1), (13, 1, 100, 2))

    assert one_deck(notes, cards, **layout) == [("water", "水"), ("水", "みず water")]


@pytest.mark.parametrize("layout", LAYOUTS)
def test_each_card_lands_in_the_deck_its_row_names(layout: dict[str, Any]) -> None:
    notes = ((1, REVERSED, "Paris\x1fcapital of France"),)
    cards = ((11, 1, 100, 0), (12, 1, 200, 1))

    assert sides(read_apkg(apkg(notes, cards, **layout))) == {
        "French": [("Paris", "capital of France")],
        "Geography": [("capital of France", "Paris")],
    }


@pytest.mark.parametrize("audio", ["<br>", " <BR /> ", "<div></div>", "\n<div> </div>"])
def test_a_field_of_breaks_and_divs_is_empty(audio: str) -> None:
    notes = ((1, JAPANESE, f"火\x1ffire\x1f{audio}\x1fひ"),)
    cards = ((11, 1, 100, 0), (12, 1, 100, 1), (13, 1, 100, 2))

    assert one_deck(notes, cards) == [("fire", "火"), ("火", "ひ fire")]


def test_a_field_of_other_markup_is_not_empty() -> None:
    notes = ((1, JAPANESE, "火\x1ffire\x1f<p></p>\x1fひ"),)

    # The front comes out empty after `plain`, and `as_note` leaves it out.
    assert one_deck(notes, ((11, 1, 100, 0),)) == [("", "火\nfire")]


@pytest.mark.parametrize("layout", LAYOUTS)
def test_filters_show_the_field_named_last_and_the_rest_nothing(layout: dict[str, Any]) -> None:
    notes = ((1, FILTERS, "unused\x1fBonjour\x1fhello"),)
    cards = ((11, 1, 100, 0), (12, 1, 100, 1))

    # `F2` has only special fields, an unknown one and a `tts`, which never
    # make a front, so the note gives one card.
    assert one_deck(notes, cards, **layout) == [("Bonjour", "hello")]


@pytest.mark.parametrize("layout", LAYOUTS)
def test_a_cloze_note_imports_as_one_cloze_line(layout: dict[str, Any]) -> None:
    # One line however many card rows, since kasten asks one card per number
    # from it; with no Back Extra it is the line alone, and no `::` after it.
    notes = ((1, CLOZE, "{{c1::Paris}} is in {{c2::France::a country}}\x1f"),)
    cards = ((11, 1, 200, 1), (12, 1, 100, 0))

    decks = read_apkg(apkg(notes, cards, **layout))

    assert sides(decks) == {"French": [("{{c1::Paris}} is in {{c2::France::a country}}", "")]}
    assert unhashed(as_note(decks[0])) == (
        f"#flashcards/French\n\n{{{{c1::Paris}}}} is in {{{{c2::France::a country}}}}{mark(1)}\n"
    )


def test_a_cloze_without_back_extra_is_kept_on_a_line_of_its_own() -> None:
    template = Template("Cloze", "{{cloze:Text}}", "{{cloze:Text}}")
    deck = Deck(
        "x",
        [
            Card("a", "b", {}, template, "Basic", cloze=False, nid=1, ord=0),
            Card("Ratio {{c1::1}}:", "", {}, template, "Cloze", cloze=True, nid=2, ord=0),
            Card("c", "d", {}, template, "Basic", cloze=False, nid=3, ord=0),
        ],
        {},
    )

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\na::b{mark(1)}\nRatio {{{{c1::1}}}}:{mark(2)}\nc::d{mark(3)}\n"
    )


def test_a_cloze_note_with_back_extra_imports_as_the_question_form() -> None:
    notes = (
        (1, BASIC, "Bonjour\x1fhello"),
        (2, CLOZE, "{{c1::Paris}} is the capital\x1fOn the <b>Seine</b>"),
        (3, BASIC, "Oui\x1fyes"),
    )
    cards = ((11, 1, 100, 0), (21, 2, 100, 0), (31, 3, 100, 0))

    decks = read_apkg(apkg(notes, cards, ((100, "French"),)))

    assert unhashed(as_note(decks[0])) == (
        f"#flashcards/French\n\nBonjour::hello{mark(1)}\n\n"
        f"{{{{c1::Paris}}}} is the capital\n?\nOn the **Seine**{mark(2)}\n\nOui::yes{mark(3)}\n"
    )


@pytest.mark.parametrize(
    "extra",
    ["# of rivers", "#geography", "!suspended x", "?", "<!--SR:!2026-08-20,4,270-->"],
    ids=["heading", "tags", "token", "divider", "schedule"],
)
def test_a_cloze_whose_back_extra_would_end_the_card_keeps_the_cloze(extra: str) -> None:
    # Under a `?` these would end the card or count as one, and unlike a
    # question holding `::` a cloze has a line of its own to fall back on.
    template = Template("Cloze", "{{cloze:Text}}", "{{cloze:Text}}")
    card = Card("{{c1::Paris}} is it", extra, {}, template, "Cloze", cloze=True, nid=1, ord=0)
    deck = Deck("x", [card], {})

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{{{{c1::Paris}}}} is it{mark(1)}\n"


@pytest.mark.parametrize(
    ("text", "body"),
    [
        (r"{{c1::\(x^{2}\)}} is the square", r"==\\(x^{2}\\)== is the square::extra"),
        ("{{c1::}} x", "==== x::extra"),
        (r"{{c1::\(x^{2}\)}} is {{c2::it}}", r"==\\(x^{2}\\)== is {{c2::it}}" + "\n?\nextra"),
    ],
    ids=["brace", "empty", "mixed"],
)
def test_a_cloze_mark_kasten_cannot_read_imports_as_a_highlight(text: str, body: str) -> None:
    # With no mark left the note is a card like any other; with one, the line
    # is a cloze of the marks kasten reads, so each case is one card.
    notes = ((1, CLOZE, f"{text}\x1fextra"),)
    deck = read_apkg(apkg(notes, CARDS[:1], ((100, "x"),)))[0]

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{body}{mark(1)}\n"
    assert card_count(deck) == 1


@pytest.mark.parametrize(
    ("text", "line", "count"),
    [
        (
            "{{c1::Canberra was {{c2::founded}} in 1913}}",
            "{{c1::Canberra was {{c2::founded}} in 1913}}",
            2,
        ),
        ("foo {{c1::bar {{c2::baz::h2}}::h1}}", "foo {{c1::bar {{c2::baz::h2}}::h1}}", 2),
        ("{{c1::outer {{c1::inner}}}}", "{{c1::outer {{c1::inner}}}}", 1),
        ("{{c1::a {{c2::b {{c3::c}}}}}}", "{{c1::a {{c2::b {{c3::c}}}}}}", 3),
        ("{{c1::<b>a</b> {{c2::<i>b</i>}}}}", "{{c1::a {{c2::b}}}}", 2),
    ],
    ids=["nested", "hints", "same", "three", "flat"],
)
def test_i1_a_nested_cloze_mark_imports_whole(text: str, line: str, count: int) -> None:
    # Anki reads nested marks since 2.1.56, so the outer mark is a card of its
    # own and not a highlight around the inner one (#254).
    notes = ((1, CLOZE, f"{text}\x1f"),)
    deck = read_apkg(apkg(notes, CARDS[:1], ((100, "x"),)))[0]

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{line}{mark(1)}\n"
    assert card_count(deck) == count


@pytest.mark.parametrize(
    ("text", "line"),
    [
        ("{{c1::a {{c2::b}}", "{{c1::a {{c2::b}}"),
        (r"{{c1::\(x^{2}\) {{c2::y}}}}", r"==\\(x^{2}\\) {{c2::y}}=="),
    ],
    ids=["unclosed", "brace"],
)
def test_i1_a_broken_nested_mark_reads_as_before(text: str, line: str) -> None:
    # An outer mark never closed is text, and one holding a lone brace is still
    # no mark, so each line is a cloze of its inner mark alone.
    notes = ((1, CLOZE, f"{text}\x1f"),)
    deck = read_apkg(apkg(notes, CARDS[:1], ((100, "x"),)))[0]

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{line}{mark(1)}\n"
    assert card_count(deck) == 1


def cloze_note(text: str, back: str) -> Deck:
    """The deck `x` of one cloze note whose text is `text` and whose Back Extra is `back`."""
    return read_apkg(apkg(((1, CLOZE, f"{text}\x1f{back}"),), CARDS[:1], ((100, "x"),)))[0]


@pytest.mark.parametrize("back", ["", "extra"], ids=["no-extra", "extra"])
@pytest.mark.parametrize(
    ("text", "line"),
    [
        ("{{c1::&#123;}}", "=={=="),
        ("{{c1::&#x7B;}}", "=={=="),
        ("{{c1::&lbrace;}}", "=={=="),
        ("{{c1::&#125;}}", "==}=="),
        ("{{c1::{}}", "=={=="),
    ],
    ids=["decimal", "hex", "named", "closing", "literal"],
)
def test_a1_an_entity_brace_in_a_mark_imports_as_a_literal_brace_does(
    text: str, line: str, back: str
) -> None:
    # The brace is decoded after the mark is read, so it once kept a mark
    # kasten cannot read, and with no Back Extra the card was left out (#333).
    deck = cloze_note(text, back)

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{line}::{back}{mark(1)}\n"
    assert card_count(deck) == 1


@pytest.mark.parametrize("back", ["", "extra"], ids=["no-extra", "extra"])
def test_i1_an_entity_brace_in_a_hint_imports_as_a_highlight(back: str) -> None:
    deck = cloze_note("{{c1::a::&#123;}}", back)

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n==a==::{back}{mark(1)}\n"
    assert card_count(deck) == 1


@pytest.mark.parametrize(
    ("back", "tail"), [("", ""), ("extra", "\n?\nextra")], ids=["no-extra", "extra"]
)
def test_a2_an_entity_brace_in_an_outer_mark_leaves_the_inner_one(back: str, tail: str) -> None:
    deck = cloze_note("{{c1::a &#123; {{c2::b}}}}", back)

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n==a {{ {{{{c2::b}}}}=={tail}{mark(1)}\n"
    assert card_count(deck) == 1


@pytest.mark.parametrize(
    ("back", "tail"), [("", ""), ("extra", "\n?\nextra")], ids=["no-extra", "extra"]
)
@pytest.mark.parametrize(
    ("text", "line", "count"),
    [
        ("{{c1::a {{c2::}}}}", "{{c1::a }}", 1),
        ("{{c1::a {{c2::&#123;}}}} {{c3::c}}", "==a {== {{c3::c}}", 1),
    ],
    ids=["empty", "brace"],
)
def test_a3_an_inner_mark_kasten_cannot_read_is_its_text(
    text: str, line: str, count: int, back: str, tail: str
) -> None:
    # Inside a mark the inner one is the text Anki shows for it, not a
    # highlight: `====` would be part of the answer, and a highlight's brace
    # would leave the outer mark one kasten cannot read.
    deck = cloze_note(text, back)

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{line}{tail}{mark(1)}\n"
    assert card_count(deck) == count


def test_i2_an_entity_that_is_no_brace_keeps_its_mark() -> None:
    deck = cloze_note("{{c1::a &amp; b}}", "")

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{{{{c1::a & b}}}}{mark(1)}\n"
    assert card_count(deck) == 1


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        ("{{c1::a {{c2::b}}}}", "==a b=="),
        ("{{c1::a {{c2::}}}}", "==a=="),
        ("{{c1::a\nb}}", "==a b=="),
    ],
    ids=["nested", "empty", "newline"],
)
def test_i3_a_nested_mark_outside_a_cloze_is_one_highlight(field: str, expected: str) -> None:
    assert plain(field) == expected


@pytest.mark.parametrize(
    ("text", "cloze", "line"),
    [
        ("{{c1::a {{c2::b}}", False, "==a b=="),
        ("x {{c1::a {{c2::b}} y", False, "x ==a b y=="),
        ("{{c1::a {{c2::&#123;}}", True, "==a {=="),
    ],
    ids=["basic", "basic-around", "cloze-no-mark"],
)
def test_an_outer_mark_never_closed_keeps_its_card(text: str, cloze: bool, line: str) -> None:
    # Its `::` would divide a line that is no cloze, and with no back that
    # card has no `?` form to fall back on.
    template = Template("Card 1", "{{Front}}", "{{Back}}")
    card = Card(plain(text, cloze=cloze), "", {}, template, "Basic", cloze, nid=1, ord=0)
    deck = Deck("x", [card], {})

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{line}::{mark(1)}\n"
    assert card_count(deck) == 1


def test_i6_a_re_import_rewrites_a_line_main_wrote_with_an_entity_brace() -> None:
    # The line before #333's fix, its hash as the import wrote it then.
    line = "{{c1::a { {{c2::b}}}}"
    schedule = "<!--SR:c2!2026-10-20,3,250-->"
    old = f"#flashcards/x\n\n{line}{marked(1, line)} {schedule}\n"

    merged = merge(old, cloze_note("{{c1::a &#123; {{c2::b}}}}", ""))

    assert merged is not None
    expected = f"#flashcards/x\n\n==a {{ {{{{c2::b}}}}=={mark(1)} {schedule}\n"
    assert unhashed(merged.text) == expected
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 1, 0, 0)


@pytest.mark.parametrize(
    ("back", "tail"), [("", ""), ("extra", "\n?\nextra")], ids=["no-extra", "extra"]
)
@pytest.mark.parametrize(
    "text",
    [
        "{{c1::a&#58;&#58;b}}",
        "{{c1::a&#x3A;&#x3A;b}}",
        "{{c1::a&colon;&colon;b}}",
        "{{c1::a&#058;&#058;b}}",
        "{{c1::a&#58;:b}}",
        "{{c1::a:&#58;b}}",
        "{{c1::a:<b>:</b>b}}",
    ],
    ids=["decimal", "hex", "named", "padded", "left", "right", "tag"],
)
def test_a1_an_entity_colon_pair_in_a_mark_stays_the_answer(
    text: str, back: str, tail: str
) -> None:
    # Anki divides answer from hint only at a `::` typed in the field, so it
    # shows `a::b` as the answer; decoded, kasten would ask `a` with hint `b` (#335).
    deck = cloze_note(text, back)

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{{{{c1::a&#58;&#58;b}}}}{tail}{mark(1)}\n"
    assert card_count(deck) == 1


@pytest.mark.parametrize(
    ("text", "line"),
    [
        ("{{c1::a&#58;&#58;b::h}}", "{{c1::a&#58;&#58;b::h}}"),
        ("{{c1::a&#58;::h}}", "{{c1::a&#58;::h}}"),
    ],
    ids=["pair", "trailing"],
)
def test_i2_an_entity_colon_before_a_hint_stays_the_answer(text: str, line: str) -> None:
    deck = cloze_note(text, "")

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{line}{mark(1)}\n"
    assert card_count(deck) == 1


@pytest.mark.parametrize(
    ("text", "line"),
    [
        ("{{c1::a::h}}", "{{c1::a::h}}"),
        ("{{c1::a:b}}", "{{c1::a:b}}"),
        ("{{c1::Ratio 1:}}", "{{c1::Ratio 1:}}"),
        ("{{c1::a&#58;b}}", "{{c1::a:b}}"),
        ("{{c1::a::b&#58;&#58;c}}", "{{c1::a::b::c}}"),
    ],
    ids=["hint", "single", "trailing", "single-entity", "entity-in-hint"],
)
def test_i3_a_colon_that_cannot_move_the_hint_is_decoded(text: str, line: str) -> None:
    deck = cloze_note(text, "")

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{line}{mark(1)}\n"
    assert card_count(deck) == 1


def test_i5_an_entity_colon_pair_in_an_inner_mark_stays_its_answer() -> None:
    deck = cloze_note("{{c1::x {{c2::a&#58;&#58;b}}}}", "")

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n{{{{c1::x {{{{c2::a&#58;&#58;b}}}}}}}}{mark(1)}\n"
    )
    assert card_count(deck) == 2


def test_i6_an_entity_colon_pair_in_a_highlight_does_not_split_the_line() -> None:
    # The brace leaves a mark kasten cannot read; decoded, its `::` split the
    # line and with no Back Extra the card was left out.
    deck = cloze_note("{{c1::{&#58;&#58;b}}", "")

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n=={{&#58;&#58;b==::{mark(1)}\n"
    assert card_count(deck) == 1


def test_i7_a_re_import_rewrites_a_line_main_wrote_with_an_entity_colon() -> None:
    # The line before #335's fix, its hash as the import wrote it then.
    line = "{{c1::a::b}}"
    schedule = "<!--SR:c1!2026-10-20,3,250-->"
    old = f"#flashcards/x\n\n{line}{marked(1, line)} {schedule}\n"

    merged = merge(old, cloze_note("{{c1::a&#58;&#58;b}}", ""))

    assert merged is not None
    expected = f"#flashcards/x\n\n{{{{c1::a&#58;&#58;b}}}}{mark(1)} {schedule}\n"
    assert unhashed(merged.text) == expected
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 1, 0, 0)


def test_a7_a_literal_entity_colon_on_a_basic_side_stays_text() -> None:
    # Anki shows `&amp;#58;` as the text `&#58;`, which kasten would show as
    # a colon unless the backslash says it is text (#340).
    notes = ((1, BASIC, "What is &amp;#58;?\x1fa&amp;#58;b"),)
    decks = read_apkg(apkg(notes, CARDS[:1], ((100, "x"),)))

    assert unhashed(as_note(decks[0])) == f"#flashcards/x\n\nWhat is \\&#58;?::a\\&#58;b{mark(1)}\n"


@pytest.mark.parametrize(
    ("text", "line"),
    [
        ("{{c1::a&amp;#58;b}}", "{{c1::a\\&#58;b}}"),
        ("{{c1::a::h&amp;#58;}}", "{{c1::a::h\\&#58;}}"),
        ("x &amp;#58; {{c1::a}}", "x \\&#58; {{c1::a}}"),
    ],
    ids=["answer", "hint", "prose"],
)
def test_a7_a_literal_entity_colon_in_a_cloze_stays_text(text: str, line: str) -> None:
    deck = cloze_note(text, "")

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{line}{mark(1)}\n"


@pytest.mark.parametrize(
    ("text", "line"),
    [
        ("{{c1::{&amp;#58;}}", "=={\\&#58;==::"),
        ("{{c1::a&#58;&#58;b}}", "{{c1::a&#58;&#58;b}}"),
        ("{{c1::a&#58;&#58;b&amp;#58;}}", "{{c1::a&#58;&#58;b\\&#58;}}"),
    ],
    ids=["highlight", "colon", "both"],
)
def test_i4_a_literal_entity_colon_is_kept_apart_from_the_imports_own(text: str, line: str) -> None:
    deck = cloze_note(text, "")

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{line}{mark(1)}\n"


def test_i6_a_re_import_rewrites_a_line_main_wrote_with_a_literal_entity_colon() -> None:
    # The line before #340's fix, its hash as the import wrote it then.
    line = "{{c1::a&#58;b}}"
    schedule = "<!--SR:c1!2026-10-20,3,250-->"
    old = f"#flashcards/x\n\n{line}{marked(1, line)} {schedule}\n"

    merged = merge(old, cloze_note("{{c1::a&amp;#58;b}}", ""))

    assert merged is not None
    expected = f"#flashcards/x\n\n{{{{c1::a\\&#58;b}}}}{mark(1)} {schedule}\n"
    assert unhashed(merged.text) == expected
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 1, 0, 0)


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        ("<code>&amp;#58;</code>", "`&#58;`"),
        ("<pre>&amp;#58;</pre>", "`&#58;`"),
    ],
    ids=["code", "pre"],
)
def test_a1_an_entity_colon_in_code_is_written_as_anki_shows_it(field: str, expected: str) -> None:
    # The editor draws a code span verbatim, so a backslash there would show (#343).
    assert plain(field) == expected


def test_a1_an_entity_colon_in_code_on_the_back_is_written_as_anki_shows_it() -> None:
    notes = ((1, BASIC, "x\x1f<code>&amp;#58;</code>"),)
    decks = read_apkg(apkg(notes, CARDS[:1], ((100, "x"),)))

    assert unhashed(as_note(decks[0])) == f"#flashcards/x\n\nx::`&#58;`{mark(1)}\n"


def test_a3_a_literal_backslash_on_a_basic_side_is_doubled() -> None:
    # Markdown would read a lone backslash as an escape and drop it (#342).
    notes = ((1, BASIC, "a\\-b\x1f\\&amp;#58;"),)
    decks = read_apkg(apkg(notes, CARDS[:1], ((100, "x"),)))

    assert unhashed(as_note(decks[0])) == f"#flashcards/x\n\na\\\\-b::\\\\\\&#58;{mark(1)}\n"


def test_a4_a_literal_backslash_in_a_cloze_answer_is_doubled() -> None:
    # Anki shows `a\::b`; a lone backslash would escape the import's `&#58;`.
    deck = cloze_note("{{c1::a\\&#58;&#58;b}}", "")

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{{{{c1::a\\\\&#58;&#58;b}}}}{mark(1)}\n"


def test_i1_a_backslash_before_markup_the_import_writes_is_doubled() -> None:
    assert plain("a\\<b>x</b>") == "a\\\\**x**"


@pytest.mark.parametrize("field", ["<code>a\\-b</code>", "<pre>a\\-b</pre>"], ids=["code", "pre"])
def test_i2_a_backslash_in_code_stays_one(field: str) -> None:
    assert plain(field) == "`a\\-b`"


def test_i4_an_entity_other_than_the_colon_is_written_as_itself() -> None:
    assert plain("&amp;copy; &amp;amp;") == "&copy; &amp;"


def test_i5_a_re_import_rewrites_a_line_main_wrote_with_a_backslash() -> None:
    # The line before #342's fix, its hash as the import wrote it then.
    line = "{{c1::a\\&#58;&#58;b}}"
    schedule = "<!--SR:c1!2026-10-20,3,250-->"
    old = f"#flashcards/x\n\n{line}{marked(1, line)} {schedule}\n"

    merged = merge(old, cloze_note("{{c1::a\\&#58;&#58;b}}", ""))

    assert merged is not None
    expected = f"#flashcards/x\n\n{{{{c1::a\\\\&#58;&#58;b}}}}{mark(1)} {schedule}\n"
    assert unhashed(merged.text) == expected
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 1, 0, 0)


def test_a1_a_cloze_mark_in_code_moves_the_code_inside_the_mark() -> None:
    # A code span is code to kasten, so a mark inside one is no mark (#346).
    deck = cloze_note("<code>{{c1::a&#58;&#58;b}}</code>", "")

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{{{{c1::`a::b`}}}}{mark(1)}\n"
    assert card_count(deck) == 1


def test_a2_a_backslash_in_a_cloze_mark_in_code_stays_one() -> None:
    deck = cloze_note("<code>{{c1::a\\b}}</code>", "")

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{{{{c1::`a\\b`}}}}{mark(1)}\n"


def test_a4_an_entity_colon_split_by_a_tag_stays_text() -> None:
    # Anki shows `a&#58;b`, which a card would show as `a:b` (#348).
    assert plain("a&amp;#<b></b>58;b") == "a\\&#58;b"


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        ("a&amp;#<span>58;</span>b", "a\\&#58;b"),
        ("<code>a&amp;#<b></b>58;b</code>", "`a&#58;b`"),
    ],
    ids=["prose", "code"],
)
def test_i5_an_entity_colon_split_by_a_tag_is_escaped_outside_code(
    field: str, expected: str
) -> None:
    assert plain(field) == expected


@pytest.mark.parametrize(
    ("text", "answer", "hint"),
    [
        ("{{c1::`a::b`}}", "`a::b`", None),
        ("{{c1::`a::b`::h}}", "`a::b`", "h"),
        ("{{c1::a`b}}", "a`b", None),
        ("{{c1::a`b::h}}", "a`b", "h"),
    ],
    ids=["span", "hint", "lone", "lone-hint"],
)
def test_i1_a_code_span_in_a_mark_is_read_whole(text: str, answer: str, hint: str | None) -> None:
    found = _MARK.fullmatch(text)

    assert found is not None
    assert (found[2], found[5]) == (answer, hint)


def test_b1_a_line_of_code_spans_after_an_open_mark_reads_in_linear_time() -> None:
    # A child process, since `re` cannot be stopped from inside: a regex that
    # backtracks doubles its time with every span here and runs for minutes.
    code = "from kasten_backend.anki import _MARK; _MARK.search('Use {{c1:: ' + '`x` ' * 30)"

    subprocess.run([sys.executable, "-c", code], check=True, timeout=5)  # noqa: S603


def test_i2_a_mark_inside_a_code_span_is_no_cloze() -> None:
    # As 0.49.x wrote one: kasten reads no mark in code, so the line is no
    # cloze, and with no back and a `::` it is no card either.
    template = Template("Cloze", "{{cloze:Text}}", "{{cloze:Text}}")
    card = Card("`{{c1::x}}`", "", {}, template, "Cloze", cloze=True, nid=1, ord=0)
    deck = Deck("x", [card], {})

    assert as_note(deck) == "#flashcards/x\n\n"
    assert card_count(deck) == 0


def test_i2_a_mark_inside_a_code_span_counts_no_card() -> None:
    template = Template("Cloze", "{{cloze:Text}}", "{{cloze:Text}}")
    card = Card("{{c1::a}} `{{c2::b}}`", "", {}, template, "Cloze", cloze=True, nid=1, ord=0)

    assert card_count(Deck("x", [card], {})) == 1


def test_i3_a_re_import_rewrites_a_line_main_wrote_with_a_mark_in_code() -> None:
    # The line 0.49.x wrote, its hash as the import wrote it then; no cloze to
    # kasten now, but its marker still finds it.
    line = "`{{c1::a&#58;&#58;b}}`"
    schedule = "<!--SR:c1!2026-10-20,3,250-->"
    old = f"#flashcards/x\n\n{line}{marked(1, line)} {schedule}\n"

    merged = merge(old, cloze_note("<code>{{c1::a&#58;&#58;b}}</code>", ""))

    assert merged is not None
    expected = f"#flashcards/x\n\n{{{{c1::`a::b`}}}}{mark(1)} {schedule}\n"
    assert unhashed(merged.text) == expected
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 1, 0, 0)


def test_a1_a_schedule_comment_in_a_cloze_answer_is_escaped() -> None:
    # `srs.ts` reads a schedule anywhere on a line, so unescaped this text
    # would be c1's schedule (#351).
    deck = cloze_note("{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}", "")

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n{{{{c1::<!--SR\\:c1!2026-01-01,1,250-->}}}}{mark(1)}\n"
    )


def test_a2_a_schedule_comment_in_a_cloze_answer_in_code_is_escaped() -> None:
    deck = cloze_note("<code>{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}</code>", "")

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n{{{{c1::`<!--SR\\:c1!2026-01-01,1,250-->`}}}}{mark(1)}\n"
    )


def test_i1_the_carried_schedule_follows_a_comment_in_the_answer() -> None:
    notes = ((1, CLOZE, "{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}\x1f"),)
    export = apkg(notes, CARDS[:1], ((100, "x"),), reviews=((11, 2, 4, 2500, 10),))

    deck = read_apkg(export, carry=True)[0]

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n{{{{c1::<!--SR\\:c1!2026-01-01,1,250-->}}}}{mark(1)}"
        " <!--SR:c1!2026-01-11,4,250-->\n"
    )


def test_i2_a_schedule_comment_in_a_cloze_hint_is_escaped() -> None:
    deck = cloze_note("{{c1::a::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}", "")

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n{{{{c1::a::<!--SR\\:c1!2026-01-01,1,250-->}}}}{mark(1)}\n"
    )


def test_i3_a_plain_schedule_comment_in_a_cloze_answer_is_escaped() -> None:
    deck = cloze_note("{{c1::&lt;!--SR:!2026-01-01,1,250--&gt;}}", "")

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n{{{{c1::<!--SR\\:!2026-01-01,1,250-->}}}}{mark(1)}\n"
    )


def test_i4_a_schedule_comment_in_a_highlight_is_escaped() -> None:
    field = "{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}"

    assert plain(field) == r"==<!--SR\:c1!2026-01-01,1,250-->=="


def test_b1_a_schedule_comment_beside_an_encoded_colon_is_written_as_main_wrote_it() -> None:
    # The `&#58;` already keeps the comment from reading as a schedule; a
    # backslash before it would show the text `&#58;`.
    field = "{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt; a&#58;&#58;b}}"

    assert plain(field, cloze=True) == "{{c1::<!--SR&#58;c1!2026-01-01,1,250--> a&#58;&#58;b}}"


def test_i5_a_re_import_rewrites_a_line_main_wrote_with_a_comment_in_the_answer() -> None:
    # The line 0.49.2 wrote, its hash as the import wrote it then, and the
    # real schedule after the marker, where a rating puts it.
    line = "{{c1::<!--SR:c1!2026-01-01,1,250-->}}"
    schedule = "<!--SR:c1!2026-10-20,3,250-->"
    old = f"#flashcards/x\n\n{line}{marked(1, line)} {schedule}\n"

    merged = merge(old, cloze_note("{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}", ""))

    assert merged is not None
    expected = f"#flashcards/x\n\n{{{{c1::<!--SR\\:c1!2026-01-01,1,250-->}}}}{mark(1)} {schedule}\n"
    assert unhashed(merged.text) == expected
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 1, 0, 0)


COMMENT_FIELD = "{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}"
"""A cloze field whose answer is a schedule comment, as #356's first case has it."""


def rated_old_line() -> str:
    """The note 0.49.2 wrote for `COMMENT_FIELD`, after review rated c1 inside the answer."""
    line = "{{c1::<!--SR:c1!2026-01-01,1,250-->}}"
    rated = "{{c1::<!--SR:c1!2026-10-20,3,250-->}}"
    return f"#flashcards/x\n\n{rated}{marked(1, line)}\n"


def test_a12_a_re_import_rewrites_a_line_main_wrote_and_review_rated_in_the_answer() -> None:
    merged = merge(rated_old_line(), cloze_note(COMMENT_FIELD, ""))

    assert merged is not None
    assert unhashed(merged.text) == (
        f"#flashcards/x\n\n{{{{c1::<!--SR\\:c1!2026-01-01,1,250-->}}}}{mark(1)}"
        " <!--SR:c1!2026-10-20,3,250-->\n"
    )
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 1, 0, 0)


def test_i8_a_second_re_import_of_the_rated_line_changes_nothing() -> None:
    deck = cloze_note(COMMENT_FIELD, "")
    first = merge(rated_old_line(), deck)
    assert first is not None
    assert first.updated == 1

    again = merge(first.text, deck)

    assert again is not None
    assert again.text == first.text
    assert (again.added, again.updated, again.kept, again.removed) == (0, 0, 1, 0)


def test_i8_a_rated_line_edited_beside_the_comment_is_kept() -> None:
    # More than a schedule changed, so the edit is the user's.
    old = rated_old_line().replace("}}", " mine}}")

    merged = merge(old, cloze_note(COMMENT_FIELD, ""))

    assert merged is not None
    assert merged.text == old
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 0, 1, 0)


def test_a13_the_marker_beside_an_encoded_colon_is_written_as_anki_shows_it() -> None:
    # A backslash before the marker's `&#58;` would show the text `&#58;`.
    field = "{{c1::&lt;!--anki:7:0--&gt; a&#58;&#58;b}}"

    assert plain(field, cloze=True) == "{{c1::<!--anki&#58;7&#58;0--> a&#58;&#58;b}}"


@pytest.mark.parametrize(
    ("field", "links", "cloze", "expected"),
    [
        ('one<span class="x">two</span><font>three</font>', {}, False, "onetwothree"),
        ("salt&nbsp;&amp;&nbsp;pepper", {}, False, "salt & pepper"),
        ('<img src="cat.jpg"> a cat [sound:meow.mp3] purring', {}, False, "a cat purring"),
        ("{{c1::Paris}} is the capital", {}, False, "==Paris== is the capital"),
        ("{{c1::Paris}} is the capital", {}, True, "{{c1::Paris}} is the capital"),
        (
            "{{c1::Paris::a city}} is in {{c2::<b>France</b>}}",
            {},
            False,
            "==Paris== is in ==France==",
        ),
        (
            "{{c1::Paris::a city}} is in {{c2::<b>France</b>}}",
            {},
            True,
            "{{c1::Paris::a city}} is in {{c2::France}}",
        ),
        ("{{c1::\\(x^{2}\\)}} is the square", {}, True, "==\\\\(x^{2}\\\\)== is the square"),
        ("{{c1::}} x", {}, True, "==== x"),
        (
            "{{c1::\\(x^{2}\\)}} is {{c2::the square}}",
            {},
            True,
            "==\\\\(x^{2}\\\\)== is {{c2::the square}}",
        ),
        ("first\nsecond  \t third \n", {}, False, "first second third"),
        ("<style>.card { color: red }</style>a<SCRIPT>var x = 1;</script>b", {}, False, "ab"),
        ("one<br>two<div>three</div><p>four</p>five", {}, False, "one\ntwo\nthree\nfour\nfive"),
        ("a<br><br><br>b<p></p><div><br></div><p>c</p>", {}, False, "a\nb\nc"),
        (
            "<b>a</b> <strong>b</strong> <i>c</i> <em>d</em> <u>e</u> <b> f </b>",
            {},
            False,
            "**a** **b** *c* *d* **e** **f**",
        ),
        (
            "<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>",
            {},
            False,
            "- one\n- two\n1. first\n2. second",
        ),
        (
            'see <a href="https://example.com/a (b)">the site</a> now',
            {},
            False,
            "see [the site](https://example.com/a%20%28b%29) now",
        ),
        ("use <code>a*b</code>", {}, False, "use `a*b`"),
        ("<pre>x = `1`\n  y</pre>", {}, False, "`` x = `1` ``\n`  y`"),
        (
            "<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>",
            {},
            False,
            "<ruby>漢字<rt>かんじ</rt></ruby>",
        ),
        (
            "2*3, snake_case, `x`, [y], a == b, <b>bold</b>",
            {},
            False,
            "2\\*3, snake\\_case, \\`x\\`, \\[y], a \\=\\= b, **bold**",
        ),
        ("# of elements", {}, False, "\\# of elements"),
        ("?", {}, False, "\\?"),
        ("!suspended x", {}, False, "\\!suspended x"),
        ("#pragma #once", {}, False, "\\#pragma #once"),
        (
            "on &lt;!--SR:!2026-08-20,4,270--&gt; here",
            {},
            False,
            "on <!--SR\\:!2026-08-20,4,270--> here",
        ),
        ("a<br># b<br>?", {}, False, "a\n\\# b\n\\?"),
        (
            "<ruby>漢字<rt>かんじ</rt></ruby>を<ruby>読<rt>よ</rt></ruby>む",
            {},
            False,
            "<ruby>漢字<rt>かんじ</rt></ruby>を<ruby>読<rt>よ</rt></ruby>む",
        ),
        ("漢字[かんじ]を&nbsp;読[よ]む", {}, False, "漢字\\[かんじ]を 読\\[よ]む"),
        (
            "{{c1::<ruby>漢字<rt>かんじ</rt></ruby>}}を",
            {},
            False,
            "==<ruby>漢字<rt>かんじ</rt></ruby>==を",
        ),
        ("What is a::b?", {}, False, "What is a::b?"),
        (
            "<hr id=answer>the &lt;!--anki:7:0--&gt; comment",
            {},
            False,
            "the <!--anki\\:7:0--> comment",
        ),
        (
            "{{c1::x}} the &lt;!--anki:7:0--&gt; comment",
            {},
            True,
            "{{c1::x}} the <!--anki\\:7:0--> comment",
        ),
        ("the &lt;!--anki:7:0--&gt; comment", {}, False, "the <!--anki\\:7:0--> comment"),
        ("type x !suspended there", {}, False, "type x \\!suspended there"),
        ("x {{c1::a !suspended b}} y", {}, True, "x {{c1::a \\!suspended b}} y"),
        ("x {{c1::a !suspended b}} y", {}, False, "x ==a \\!suspended b== y"),
        (
            '{{c1::<ruby class="x">漢字<rt class="y">かんじ</rt></ruby>}}',
            {},
            True,
            "{{c1::<ruby>漢字<rt>かんじ</rt></ruby>}}",
        ),
        ('<a href="https://x.org">a<br>b</a>', {}, False, "[a b](https://x.org)"),
        ("Name three<br>colours", {}, False, "Name three\ncolours"),
        ("<hr id=answer><ul><li>red</li><li>green</li></ul>", {}, False, "- red\n- green"),
        ("one<br>two", {}, False, "one\ntwo"),
        ("Is a::b valid?", {}, False, "Is a::b valid?"),
        ("<hr id=answer>?<br>```js", {}, False, "\\?\n\\`\\`\\`js"),
        ("{{c1::Paris}}<br>is the capital", {}, True, "{{c1::Paris}} is the capital"),
        ("On the<br><b>Seine</b>", {}, False, "On the\n**Seine**"),
        ("{{c1::H}} and {{c2::O}}", {}, True, "{{c1::H}} and {{c2::O}}"),
        ("What does std::move do?", {}, False, "What does std::move do?"),
        ("{{c1::Seine}} river", {}, True, "{{c1::Seine}} river"),
        ("<ruby>漢字<rt>かんじ</rt></ruby>", {}, False, "<ruby>漢字<rt>かんじ</rt></ruby>"),
        ("{{c1::Paris}} is in<br>{{c2::France}}", {}, True, "{{c1::Paris}} is in {{c2::France}}"),
        ("On the<p>Seine</p>", {}, False, "On the\nSeine"),
        ("What does std::size count?", {}, False, "What does std::size count?"),
        (
            "<hr id=answer># of elements<br>!suspended no",
            {},
            False,
            "\\# of elements\n\\!suspended no",
        ),
        ("<hr id=answer>the capital of France", {}, False, "the capital of France"),
        ("<hr id=answer>capital of France", {}, False, "capital of France"),
        ("<hr id=answer>漢字<br>Chinese characters", {}, False, "漢字\nChinese characters"),
        ("<hr id=answer>かんじ Chinese characters", {}, False, "かんじ Chinese characters"),
        ("Extra: X1", {}, False, "Extra: X1"),
        ("<hr id=answer>B1<script>var x=1;</script>", {}, False, "B1"),
        ("<hr id=answer>B2<script>var x=1;</script>", {}, False, "B2"),
        ("<hr id=answer>みず water", {}, False, "みず water"),
        ("<hr id=answer>ひ fire", {}, False, "ひ fire"),
        ("<p></p>", {}, False, ""),
        ("<hr id=answer>火<br>fire", {}, False, "火\nfire"),
        (
            "{{c1::Paris}} is in {{c2::France::a country}}",
            {},
            True,
            "{{c1::Paris}} is in {{c2::France::a country}}",
        ),
        ("On the <b>Seine</b>", {}, False, "On the **Seine**"),
        ("{{c1::\\(x^{2}\\)}} is {{c2::it}}", {}, True, "==\\\\(x^{2}\\\\)== is {{c2::it}}"),
        (
            "{{c1::Canberra was {{c2::founded}} in 1913}}",
            {},
            True,
            "{{c1::Canberra was {{c2::founded}} in 1913}}",
        ),
        ("foo {{c1::bar {{c2::baz::h2}}::h1}}", {}, True, "foo {{c1::bar {{c2::baz::h2}}::h1}}"),
        ("{{c1::outer {{c1::inner}}}}", {}, True, "{{c1::outer {{c1::inner}}}}"),
        ("{{c1::a {{c2::b {{c3::c}}}}}}", {}, True, "{{c1::a {{c2::b {{c3::c}}}}}}"),
        ("{{c1::<b>a</b> {{c2::<i>b</i>}}}}", {}, True, "{{c1::a {{c2::b}}}}"),
        ("{{c1::a {{c2::b}}", {}, True, "{{c1::a {{c2::b}}"),
        ("{{c1::\\(x^{2}\\) {{c2::y}}}}", {}, True, "==\\\\(x^{2}\\\\) {{c2::y}}=="),
        ("{{c1::&#123;}}", {}, True, "=={=="),
        ("{{c1::&#x7B;}}", {}, True, "=={=="),
        ("{{c1::&lbrace;}}", {}, True, "=={=="),
        ("{{c1::&#125;}}", {}, True, "==}=="),
        ("{{c1::{}}", {}, True, "=={=="),
        ("{{c1::a::&#123;}}", {}, True, "==a=="),
        ("{{c1::a &#123; {{c2::b}}}}", {}, True, "==a { {{c2::b}}=="),
        ("{{c1::a {{c2::}}}}", {}, True, "{{c1::a }}"),
        ("{{c1::a {{c2::&#123;}}}} {{c3::c}}", {}, True, "==a {== {{c3::c}}"),
        ("{{c1::a &amp; b}}", {}, True, "{{c1::a & b}}"),
        ("{{c1::a {{c2::b}}}}", {}, False, "==a b=="),
        ("{{c1::a {{c2::}}}}", {}, False, "==a=="),
        ("{{c1::a\nb}}", {}, False, "==a b=="),
        ("{{c1::a {{c2::b}}", {}, False, "==a b=="),
        ("x {{c1::a {{c2::b}} y", {}, False, "x ==a b y=="),
        ("{{c1::a {{c2::&#123;}}", {}, True, "==a {=="),
        ("{{c1::a&#58;&#58;b}}", {}, True, "{{c1::a&#58;&#58;b}}"),
        ("{{c1::a&#x3A;&#x3A;b}}", {}, True, "{{c1::a&#58;&#58;b}}"),
        ("{{c1::a&colon;&colon;b}}", {}, True, "{{c1::a&#58;&#58;b}}"),
        ("{{c1::a&#058;&#058;b}}", {}, True, "{{c1::a&#58;&#58;b}}"),
        ("{{c1::a&#58;:b}}", {}, True, "{{c1::a&#58;&#58;b}}"),
        ("{{c1::a:&#58;b}}", {}, True, "{{c1::a&#58;&#58;b}}"),
        ("{{c1::a:<b>:</b>b}}", {}, True, "{{c1::a&#58;&#58;b}}"),
        ("{{c1::a&#58;&#58;b::h}}", {}, True, "{{c1::a&#58;&#58;b::h}}"),
        ("{{c1::a&#58;::h}}", {}, True, "{{c1::a&#58;::h}}"),
        ("{{c1::a::h}}", {}, True, "{{c1::a::h}}"),
        ("{{c1::a:b}}", {}, True, "{{c1::a:b}}"),
        ("{{c1::Ratio 1:}}", {}, True, "{{c1::Ratio 1:}}"),
        ("{{c1::a&#58;b}}", {}, True, "{{c1::a:b}}"),
        ("{{c1::a::b&#58;&#58;c}}", {}, True, "{{c1::a::b::c}}"),
        ("{{c1::x {{c2::a&#58;&#58;b}}}}", {}, True, "{{c1::x {{c2::a&#58;&#58;b}}}}"),
        ("{{c1::{&#58;&#58;b}}", {}, True, "=={&#58;&#58;b=="),
        ("What is &amp;#58;?", {}, False, "What is \\&#58;?"),
        ("<hr id=answer>a&amp;#58;b", {}, False, "a\\&#58;b"),
        ("{{c1::a&amp;#58;b}}", {}, True, "{{c1::a\\&#58;b}}"),
        ("{{c1::a::h&amp;#58;}}", {}, True, "{{c1::a::h\\&#58;}}"),
        ("x &amp;#58; {{c1::a}}", {}, True, "x \\&#58; {{c1::a}}"),
        ("{{c1::{&amp;#58;}}", {}, True, "=={\\&#58;=="),
        ("{{c1::a&#58;&#58;b&amp;#58;}}", {}, True, "{{c1::a&#58;&#58;b\\&#58;}}"),
        ("<code>&amp;#58;</code>", {}, False, "`&#58;`"),
        ("<pre>&amp;#58;</pre>", {}, False, "`&#58;`"),
        ("<hr id=answer><code>&amp;#58;</code>", {}, False, "`&#58;`"),
        ("a\\-b", {}, False, "a\\\\-b"),
        ("<hr id=answer>\\&amp;#58;", {}, False, "\\\\\\&#58;"),
        ("{{c1::a\\&#58;&#58;b}}", {}, True, "{{c1::a\\\\&#58;&#58;b}}"),
        ("a\\<b>x</b>", {}, False, "a\\\\**x**"),
        ("<code>a\\-b</code>", {}, False, "`a\\-b`"),
        ("<pre>a\\-b</pre>", {}, False, "`a\\-b`"),
        ("&amp;copy; &amp;amp;", {}, False, "&copy; &amp;"),
        ("<code>{{c1::a&#58;&#58;b}}</code>", {}, True, "{{c1::`a::b`}}"),
        ("<code>{{c1::a\\b}}</code>", {}, True, "{{c1::`a\\b`}}"),
        ("a&amp;#<b></b>58;b", {}, False, "a\\&#58;b"),
        ("a&amp;#<span>58;</span>b", {}, False, "a\\&#58;b"),
        ("<code>a&amp;#<b></b>58;b</code>", {}, False, "`a&#58;b`"),
        (
            "{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}",
            {},
            True,
            "{{c1::<!--SR\\:c1!2026-01-01,1,250-->}}",
        ),
        (
            "<code>{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}</code>",
            {},
            True,
            "{{c1::`<!--SR\\:c1!2026-01-01,1,250-->`}}",
        ),
        (
            "{{c1::a::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}",
            {},
            True,
            "{{c1::a::<!--SR\\:c1!2026-01-01,1,250-->}}",
        ),
        (
            "{{c1::&lt;!--SR:!2026-01-01,1,250--&gt;}}",
            {},
            True,
            "{{c1::<!--SR\\:!2026-01-01,1,250-->}}",
        ),
        (
            "{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}",
            {},
            False,
            "==<!--SR\\:c1!2026-01-01,1,250-->==",
        ),
        (
            "{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt; a&#58;&#58;b}}",
            {},
            True,
            "{{c1::<!--SR&#58;c1!2026-01-01,1,250--> a&#58;&#58;b}}",
        ),
        ("<hr id=answer>casts to an rvalue", {}, False, "casts to an rvalue"),
        ("Ratio 1:", {}, False, "Ratio 1:"),
        ("F1<style>.x{}</style>", {}, False, "F1"),
        ("{{Back}} and {{#Back}}x{{/Back}}", {}, False, "{{Back}} and {{#Back}}x{{/Back}}"),
        ("<b>q</b>", {}, False, "**q**"),
        ("<i>secret</i>", {}, False, "*secret*"),
        (
            '<img src="cat.png"> a cat [sound:meow.mp3]',
            {"cat.png": "F/French%20media/cat.png", "meow.mp3": "F/French%20media/meow.mp3"},
            False,
            "![](F/French%20media/cat.png) a cat ![](F/French%20media/meow.mp3)",
        ),
        (
            "<hr id=answer>le chat",
            {"cat.png": "F/French%20media/cat.png", "meow.mp3": "F/French%20media/meow.mp3"},
            False,
            "le chat",
        ),
        (
            '<hr id=answer><img src="cat.png"> a cat [sound:meow.mp3]',
            {"cat.png": "F/French%20media/cat.png", "meow.mp3": "F/French%20media/meow.mp3"},
            False,
            "![](F/French%20media/cat.png) a cat ![](F/French%20media/meow.mp3)",
        ),
        (
            '<img src="cat.png">',
            {"cat.png": "French%20media/cat.png"},
            False,
            "![](French%20media/cat.png)",
        ),
        ("<hr id=answer>a cat", {"cat.png": "French%20media/cat.png"}, False, "a cat"),
        ('<img src="cat.svg"> a cat', {}, False, "a cat"),
        ("<hr id=answer>le chat", {}, False, "le chat"),
        ('<img src="cat.png"> a cat', {}, False, "a cat"),
        ('<img src="cat.pdf"> a cat', {}, False, "a cat"),
        ('<img src="../cat.png"> a cat', {}, False, "a cat"),
        ('<img src="a/cat.png"> a cat', {}, False, "a cat"),
        ('<img src=".."> a cat', {}, False, "a cat"),
        ('<img src=""> a cat', {}, False, "a cat"),
        (
            "[sound:kanji.mp3]",
            {"kanji.mp3": "French%20media/kanji.mp3"},
            False,
            "![](French%20media/kanji.mp3)",
        ),
        (
            "<hr id=answer>漢字<br>Chinese characters",
            {"kanji.mp3": "French%20media/kanji.mp3"},
            False,
            "漢字\nChinese characters",
        ),
        ("[sound:kanji.mp3]", {}, False, ""),
        ("What is S3?", {}, False, "What is S3?"),
        ("<hr id=answer>Simple Storage", {}, False, "Simple Storage"),
        ("What is EC2?", {}, False, "What is EC2?"),
        ("<hr id=answer>Elastic Compute", {}, False, "Elastic Compute"),
        ("<hr id=answer># of elements", {}, False, "\\# of elements"),
        ("<hr id=answer>", {}, False, ""),
        ("{{c1::H}}{{c1::O}} and {{c2::water}}", {}, True, "{{c1::H}}{{c1::O}} and {{c2::water}}"),
        (
            '<img src="cat.png"> and here?',
            {"cat.png": "03%20Flashcards/Pets/Cats%20media/cat.png"},
            False,
            "![](03%20Flashcards/Pets/Cats%20media/cat.png) and here?",
        ),
        (
            '<hr id=answer><img src="bad.png">',
            {"cat.png": "03%20Flashcards/Pets/Cats%20media/cat.png"},
            False,
            "",
        ),
        ("<hr id=answer>the tabby", {}, False, "the tabby"),
        ('<img src=".hidden.png"> which cat?', {}, False, "which cat?"),
        ("{{c1::H}} {{c2::O}} {{c3::N}}", {}, True, "{{c1::H}} {{c2::O}} {{c3::N}}"),
    ],
)
def test_a15_every_field_the_tests_import_is_written_as_main_wrote_it(
    field: str, links: dict[str, str], cloze: bool, expected: str
) -> None:
    # What main wrote before #356, every field the other tests here import
    # with a mark, an escape, an entity, code or media: the three edge cases
    # change no line but their own.
    assert plain(field, links, cloze=cloze) == expected


def test_a_cloze_note_with_no_marks_is_a_card_of_its_two_fields() -> None:
    # Anki will not save such a note, but a broken export can hold one; its
    # text is still worth a question.
    decks = read_apkg(apkg(((1, CLOZE, "Paris\x1fthe capital"),), CARDS[:1], ((100, "x"),)))

    assert unhashed(as_note(decks[0])) == f"#flashcards/x\n\nParis::the capital{mark(1)}\n"


def test_writes_a_deck_as_a_tagged_note() -> None:
    template = Template("Card 1", "{{Front}}", "{{Back}}")
    deck = Deck(
        "Certs/AWS",
        [
            Card(front, back, {}, template, "Basic", cloze=False, nid=nid, ord=0)
            for nid, (front, back) in enumerate(
                (("Bonjour", "hello"), ("", "orphan"), ("Paris", "the capital"), ("alone", "")), 1
            )
        ],
        {},
    )

    assert unhashed(as_note(deck)) == (
        f"#flashcards/Certs/AWS\n\nBonjour::hello{mark(1)}\nParis::the capital{mark(3)}\n"
        f"alone::{mark(4)}\n"
    )


def test_writes_a_deck_name_as_a_tag_read_whole() -> None:
    # `:` ends a tag, so `2:-Dakuten-Katakana` would land in a deck called `2`.
    decks = read_apkg(
        apkg(((1, SOLO, "alone"),), ((11, 1, 100, 0),), ((100, "2: Dakuten Katakana"),))
    )

    assert as_note(decks[0]).split("\n")[0] == "#flashcards/2-Dakuten-Katakana"


def test_parks_a_card_whose_back_adds_nothing() -> None:
    decks = read_apkg(apkg(((1, SOLO, "alone"),), ((11, 1, 100, 0),)))

    assert unhashed(as_note(decks[0])) == f"#flashcards/French\n\nalone::{mark(1)}\n"


def test_writes_a_question_holding_the_divider_over_three_lines() -> None:
    # A card line splits at its first `::`, so on one line this question would
    # read back as `What does std`. `frontend/tests/srs.test.ts` and
    # `review.test.ts` read this exact text back.
    decks = read_apkg(apkg(((1, BASIC, "What does std::move do?\x1fcasts to an rvalue"),)))

    assert unhashed(as_note(decks[0])) == (
        f"#flashcards/French\n\nWhat does std::move do?\n?\ncasts to an rvalue{mark(1)}\n"
    )


def test_sets_a_question_holding_the_divider_apart_from_its_neighbours() -> None:
    deck = basic_deck(("a", "b"), ("What does std::move do?", "casts std::move"), ("c", "d"))

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\na::b{mark(1)}\n\n"
        f"What does std::move do?\n?\ncasts std::move{mark(2)}\n\nc::d{mark(3)}\n"
    )


@pytest.mark.parametrize(
    ("front", "back"),
    [
        ("Is a::b valid?", "?"),
        ("What does std::size count?", "# of elements"),
        ("What opens a::b?", "#pragma"),
        ("What does a::b hold?", "!suspended x"),
        ("When is a::b due?", "on <!--SR:!2026-08-20,4,270--> here"),
        ("# What does std::move do?", "casts"),
    ],
    ids=["divider", "heading", "tags", "token", "schedule", "front-heading"],
)
def test_leaves_out_a_divider_question_whose_side_would_end_the_card(front: str, back: str) -> None:
    # `srs.ts` would drop the `?` card and read the front at its first `::`, or,
    # for a `?` answer, `review.ts` would count the answer as a second card.
    # `frontend/tests/review.test.ts` reads the first case's text back.
    deck = basic_deck((front, back), ("a", "b"))

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\na::b{mark(2)}\n"


@pytest.mark.parametrize(
    ("front", "back"),
    [
        ("How is a::b scheduled?", "as <!--SR:!date,int,ease-->"),
        ("Is <!--SR:!2026-08-20,4,270--> a::b?", "yes"),
    ],
    ids=["back-schedule-text", "front-schedule"],
)
def test_keeps_a_divider_question_holding_what_is_no_schedule_stop(front: str, back: str) -> None:
    # `srs.ts` stops a back only at a whole schedule comment, and a front at no
    # schedule at all, so neither of these ends the card.
    deck = basic_deck((front, back))

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{front}\n?\n{back}{mark(1)}\n"


def test_a_front_ending_in_a_colon_reads_back_whole() -> None:
    # `Ratio 1:::2` would split at its first `::` into `Ratio 1` and `:2`.
    # `divide` in `card-line.ts` trims the space the divider sits behind.
    decks = read_apkg(apkg(((1, BASIC, "Ratio 1:\x1f2"),), CARDS[:1], ((100, "x"),)))

    line = unhashed(as_note(decks[0])).splitlines()[-1].removesuffix(mark(1))
    front, back = line.split("::", 1)

    assert line == "Ratio 1: ::2"
    assert (front.strip(), back.strip()) == ("Ratio 1:", "2")


def test_a_side_opening_a_fence_opens_none() -> None:
    # The client finds code with the editor's markdown parser, which reads a
    # line opening with three backticks as a fence, and both readers would
    # skip every card under it.
    deck = basic_deck(("```js x", "code"), ("```a::b", "```c"), ("a", "b"))

    note = as_note(deck)

    assert not any(line.lstrip().startswith("```") for line in note.splitlines())
    assert unhashed(note) == (
        f"#flashcards/x\n\n\\```js x::code{mark(1)}\n\n\\```a::b\n?\n\\```c{mark(2)}\n\n"
        f"a::b{mark(3)}\n"
    )


def test_674_a1_a_side_opening_with_tildes_opens_no_fence() -> None:
    # The editor's parser reads `~~~` as a fence too, so the card under it
    # would be code and no card.
    deck = basic_deck(("~~~", "b"), ("~~~a::b", "~~~c"), ("a", "b"))

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n\\~~~::b{mark(1)}\n\n\\~~~a::b\n?\n\\~~~c{mark(2)}\n\na::b{mark(3)}\n"
    )


def test_674_i1_every_fence_opening_a_side_line_is_escaped() -> None:
    # A longer run is a fence, and so is one up to three spaces in, whose
    # spaces stay before the backslash.
    deck = basic_deck(
        ("~~~~ x", "b"), ("````y", "b"), ("   ~~~z", "b"), ("~~~1\n~~~2", "~~~3\n~~~4")
    )

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n\\~~~~ x::b{mark(1)}\n\\````y::b{mark(2)}\n   \\~~~z::b{mark(3)}\n\n"
        f"\\~~~1\n\\~~~2\n?\n\\~~~3\n\\~~~4{mark(4)}\n"
    )


def test_674_i2_a_re_import_escapes_a_tilde_side_and_keeps_its_schedule() -> None:
    # The old import wrote the side bare, so the marker's hash still finds it
    # and the card reads as one Anki changed.
    old = (
        f"#flashcards/x\n\n~~~ js::code{marked(1, '~~~ js::code')} {SR1}\na::b{marked(2, 'a::b')}\n"
    )

    merged = merge(old, basic_deck(("~~~ js", "code"), ("a", "b")))

    assert merged is not None
    assert (merged.text, merged.updated, merged.kept) == (
        f"#flashcards/x\n\n\\~~~ js::code{marked(1, '\\~~~ js::code')} {SR1}\n"
        f"a::b{marked(2, 'a::b')}\n",
        1,
        1,
    )


def test_679_a4_a_side_line_opening_a_list_item_with_a_fence_is_escaped() -> None:
    # CommonMark reads a fence inside a list item, so the card under it would
    # be code; the backslash goes after the marker, right before the fence.
    deck = basic_deck(("- ~~~", "b"), ("* ```x\n1. ~~~", "- ~~~ y"), ("a", "b"))

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n- \\~~~::b{mark(1)}\n\n* \\```x\n1. \\~~~\n?\n- \\~~~ y{mark(2)}\n\n"
        f"a::b{mark(3)}\n"
    )


def test_679_a5_a_side_line_opening_a_quote_with_a_fence_is_escaped() -> None:
    # A quote holds a fence too, with or without the space after `>`, and so
    # does a list item inside a quote.
    deck = basic_deck(("> ```", "b"), (">~~~\n> - ~~~", "c"), ("a", "b"))

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n> \\```::b{mark(1)}\n\n>\\~~~\n> - \\~~~\n?\nc{mark(2)}\n\n"
        f"a::b{mark(3)}\n"
    )


def test_679_a6_a_tab_after_a_list_or_quote_marker_still_escapes_the_fence() -> None:
    # CommonMark takes a tab where it takes the space after a marker.
    deck = basic_deck(("-\t~~~", "b"), (">\t```", "c"))

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n-\t\\~~~::b{mark(1)}\n>\t\\```::c{mark(2)}\n"
    )


def test_679_b1_a_line_of_many_quote_markers_and_no_fence_returns_at_once() -> None:
    # Each `> ` could match two ways, the space after `>` or the next marker's
    # indent, so a line ending in no fence must not try every split.
    side = "> " * 40 + "x"
    deck = basic_deck((side, "b"))

    start = time.perf_counter()
    text = unhashed(as_note(deck))
    elapsed = time.perf_counter() - start

    assert (text == f"#flashcards/x\n\n{side}::b{mark(1)}\n", elapsed < 1) == (True, True)


def test_679_i3_a_re_import_escapes_a_list_fence_side_and_keeps_its_schedule() -> None:
    # The old import wrote the side bare, so the marker's hash still finds it
    # and the card reads as one Anki changed.
    old = (
        f"#flashcards/x\n\n- ~~~ js::code{marked(1, '- ~~~ js::code')} {SR1}\n"
        f"a::b{marked(2, 'a::b')}\n"
    )

    merged = merge(old, basic_deck(("- ~~~ js", "code"), ("a", "b")))

    assert merged is not None
    assert (merged.text, merged.updated, merged.kept) == (
        f"#flashcards/x\n\n- \\~~~ js::code{marked(1, '- \\~~~ js::code')} {SR1}\n"
        f"a::b{marked(2, 'a::b')}\n",
        1,
        1,
    )


def test_679_i4_a_list_item_or_quote_with_no_fence_stays_unescaped() -> None:
    # A marker with no fence after it, a fence after other text and `-~~~`,
    # which is no list item, open no code block; `- ~~~` beside them does.
    deck = basic_deck(("- a", "b"), ("> b", "c"), ("a ~~~", "d"), ("-~~~", "e"), ("- ~~~", "f"))

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n- a::b{mark(1)}\n> b::c{mark(2)}\na ~~~::d{mark(3)}\n"
        f"-~~~::e{mark(4)}\n- \\~~~::f{mark(5)}\n"
    )


def test_leaves_out_a_question_holding_the_divider_with_no_answer() -> None:
    deck = basic_deck(("What does std::move do?", ""), ("a", "b"))

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\na::b{mark(2)}\n"


def test_script_and_style_add_no_text() -> None:
    notes = ((1, COND, "F1<style>.x{}</style>\x1fB1\x1f"),)

    assert one_deck(notes, ((11, 1, 100, 0),)) == [("F1", "B1")]


@pytest.mark.parametrize("layout", LAYOUTS)
def test_cards_come_in_note_order_then_template_order(layout: dict[str, Any]) -> None:
    notes = ((2, REVERSED, "b\x1fB"), (1, REVERSED, "a\x1fA"))
    cards = ((24, 2, 100, 1), (23, 2, 100, 0), (12, 1, 100, 1), (11, 1, 100, 0))

    assert one_deck(notes, cards, **layout) == [("a", "A"), ("A", "a"), ("b", "B"), ("B", "b")]


def test_a_field_value_is_never_read_as_template() -> None:
    notes = ((1, BASIC, "{{Back}} and {{#Back}}x{{/Back}}\x1fsecret"),)

    assert one_deck(notes, ((11, 1, 100, 0),)) == [("{{Back}} and {{#Back}}x{{/Back}}", "secret")]


def test_a_comment_in_a_template_shows_nothing_and_fills_nothing() -> None:
    types: tuple[NoteType, ...] = (
        (1, "Commented", 0, ("Front", "Back"), (("C", "<!-- {{Back}} -->{{Front}}", "{{Back}}"),)),
    )
    notes = ((1, 1, "<b>q</b>\x1f<i>secret</i>"), (2, 1, "\x1fsecret"))
    cards = ((11, 1, 100, 0), (21, 2, 100, 0))

    data = apkg(notes, cards, ((100, "D"),), types=types)

    # The second note's front is the comment alone, so Anki makes no card.
    assert sides(read_apkg(data)) == {"D": [("**q**", "*secret*")]}


def test_a_third_brace_is_dropped_before_the_field_and_kept_after() -> None:
    types: tuple[NoteType, ...] = (
        (1, "Triple", 0, ("Front", "Back"), (("T", "{{{Front}}}", "{{Back}}"),)),
    )

    data = apkg(((1, 1, "q\x1fa"),), ((11, 1, 100, 0),), ((100, "D"),), types=types)

    assert sides(read_apkg(data)) == {"D": [("q}", "a")]}


@pytest.mark.parametrize("layout", LAYOUTS)
def test_refuses_a_collection_with_no_note_types(layout: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match="no note types"):
        read_apkg(apkg(types=(), **layout))


@pytest.mark.parametrize("layout", LAYOUTS)
def test_refuses_notes_whose_note_type_is_not_there(layout: dict[str, Any]) -> None:
    notes = ((1, 404, "Bonjour\x1fhello"),)

    with pytest.raises(ValueError, match="no note type"):
        read_apkg(apkg(notes, CARDS[:1], **layout))


def test_refuses_a_collection_without_note_type_tables() -> None:
    blob = sqlite3_bytes(
        "CREATE TABLE notes (id, mid, flds)",
        "CREATE TABLE cards (id, nid, did, ord)",
        "CREATE TABLE decks (id, name)",
        row=("INSERT INTO notes VALUES (1, 1, ?)", ("a\x1fb",)),
    )

    with pytest.raises(ValueError, match="unreadable"):
        read_apkg(zipped("collection.anki21", blob))


@pytest.mark.parametrize(
    "config",
    [b"\x0a\x05abc", b"\x0a", b"\x0b\x00", b"\x80"],
    ids=["string-too-long", "no-length", "group", "unfinished-varint"],
)
def test_refuses_a_broken_protobuf_config(config: bytes) -> None:
    blob = sqlite3_bytes(
        "CREATE TABLE notes (id, mid, flds)",
        "CREATE TABLE cards (id, nid, did, ord)",
        "CREATE TABLE decks (id, name)",
        "CREATE TABLE notetypes (id, name, config)",
        "CREATE TABLE fields (ntid, ord, name)",
        "CREATE TABLE templates (ntid, ord, name, config)",
        "INSERT INTO notetypes VALUES (1, 'Basic', x'')",
        row=("INSERT INTO templates VALUES (1, 0, 'Card 1', ?)", (config,)),
    )

    with pytest.raises(ValueError, match="protobuf"):
        read_apkg(zipped("collection.anki21", blob))


def legacy_type(qfmt: object = "{{F}}", afmt: object = "x", field: object = "F") -> str:
    """`col.models` holding one note type, with whatever values a test wants to break."""
    tmpl = {"name": "c", "ord": 0, "qfmt": qfmt, "afmt": afmt}
    return json.dumps({"1": {"name": "B", "flds": [{"name": field, "ord": 0}], "tmpls": [tmpl]}})


@pytest.mark.parametrize(
    "models",
    [
        "{not json",
        '{"1": {"name": "Basic"}}',
        "[1]",
        legacy_type(qfmt=None),
        legacy_type(afmt=3),
        legacy_type(field=["F"]),
    ],
    ids=["not-json", "no-fields", "list", "qfmt-null", "afmt-int", "field-list"],
)
def test_refuses_note_types_it_cannot_read(models: str) -> None:
    blob = sqlite3_bytes(
        "CREATE TABLE notes (id, mid, flds)",
        "CREATE TABLE cards (id, nid, did, ord)",
        "CREATE TABLE col (decks, models)",
        "INSERT INTO notes VALUES (1, 1, 'a')",
        "INSERT INTO cards VALUES (1, 1, 1, 0)",
        row=("INSERT INTO col VALUES (?, ?)", ('{"1": {"name": "D"}}', models)),
    )

    with pytest.raises(ValueError):
        read_apkg(zipped("collection.anki2", blob))


@pytest.mark.parametrize("layout", LAYOUTS)
def test_skips_a_card_whose_template_or_note_type_is_not_there(layout: dict[str, Any]) -> None:
    notes = (*NOTES[:1], (3, 404, "lost\x1fnote"))
    cards = ((11, 1, 100, 0), (12, 1, 100, 5), (31, 3, 100, 0))

    assert one_deck(notes, cards, **layout) == [("Bonjour", "hello")]


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


def test_spells_a_nested_deck_with_a_slash_on_schema_18() -> None:
    data = apkg(decks=((100, "Certs\x1fAWS"), (200, "Geography")), schema18=True)

    assert read_apkg(data)[0].name == "Certs/AWS"


def test_spells_a_nested_deck_with_a_slash_on_the_old_schema() -> None:
    data = apkg(decks=((100, "Certs::AWS"), (200, "Geography")))

    assert read_apkg(data)[0].name == "Certs/AWS"


def test_plain_turns_media_into_links() -> None:
    links = {"cat.png": "d/cat.png", "a&b.png": "d/a&b.png", "meow.mp3": "d/meow.mp3"}
    field = (
        "<img src=\"cat.png\"> <IMG alt=x SRC='a&amp;b.png'> <img src=cat.png>"
        " [sound:meow.mp3] <img src='gone.png'> [sound:gone.mp3]"
    )

    assert plain(field, links) == "![](d/cat.png) ![](d/a&b.png) ![](d/cat.png) ![](d/meow.mp3)"


@pytest.mark.parametrize("layout", LAYOUTS)
def test_carries_media_from_either_form_of_the_map(layout: dict[str, Any]) -> None:
    notes = ((1, REVERSED, '<img src="cat.png"> a cat [sound:meow.mp3]\x1fle chat'),)
    cards = ((11, 1, 100, 0), (12, 1, 100, 1))
    media = (("unused.png", PNG), ("cat.png", PNG), ("meow.mp3", MP3))

    decks = read_apkg(apkg(notes, cards, ((100, "French"),), media=media, **layout), "F")

    link = "![](F/French%20media/cat.png) a cat ![](F/French%20media/meow.mp3)"
    assert sides(decks) == {"French": [(link, "le chat"), ("le chat", link)]}
    assert decks[0].media == {"cat.png": PNG, "meow.mp3": MP3}


def test_reads_a_media_entry_by_its_legacy_zip_name() -> None:
    # An entry carrying `legacy_zip_filename` lives under that number, not its index.
    entries = proto(1, proto(1, "cat.png") + proto(2, len(PNG)) + proto(255, 7))
    plain_export = apkg(((1, BASIC, '<img src="cat.png">\x1fa cat'),))
    collection = zipfile.ZipFile(io.BytesIO(plain_export)).read("collection.anki2")
    export = zipped(
        "collection.anki2",
        collection,
        ("media", zstd.compress(entries)),
        ("7", zstd.compress(PNG)),
    )

    decks = read_apkg(export)

    assert decks[0].cards[0].front == "![](French%20media/cat.png)"
    assert decks[0].media == {"cat.png": PNG}


@pytest.mark.parametrize(
    ("name", "data"),
    [("cat.svg", b"<svg/>"), ("cat.png", MP3), ("cat.png", None), ("cat.pdf", b"%PDF-1")],
    ids=["suffix", "magic", "missing", "book"],
)
def test_drops_media_it_cannot_carry(name: str, data: bytes | None) -> None:
    notes = ((1, BASIC, f'<img src="{name}"> a cat\x1fle chat'),)

    decks = read_apkg(apkg(notes, CARDS[:1], media=((name, data),)))

    assert sides(decks) == {"French": [("a cat", "le chat")]}
    assert decks[0].media == {}


def test_encodes_a_media_name_into_a_link_that_works() -> None:
    # `encodePath` in `note-path.ts`, and `:` and the parens besides: a `::` would
    # split the card line and a lone paren would end the link.
    name = "my cat (1) #2?ü:x.png"
    notes = ((1, BASIC, f"<img src='{name}'>\x1fa cat"),)

    decks = read_apkg(apkg(notes, CARDS[:1], media=((name, PNG),)), "03 Flashcards")

    assert decks[0].cards[0].front == (
        "![](03%20Flashcards/French%20media/my%20cat%20%281%29%20%232%3F%C3%BC%3Ax.png)"
    )


@pytest.mark.parametrize("name", ["../cat.png", "a/cat.png", "..", "", f"{'x' * 252}.png"])
def test_carries_no_media_name_that_leaves_its_folder(name: str) -> None:
    notes = ((1, BASIC, f'<img src="{name}"> a cat\x1fle chat'),)

    decks = read_apkg(apkg(notes, CARDS[:1], media=((name, PNG),)))

    assert decks[0].cards[0].front == "a cat"
    assert decks[0].media == {}


def test_a_front_of_only_a_sound_is_a_card() -> None:
    notes = ((1, JAPANESE, "漢字\x1fChinese characters\x1f[sound:kanji.mp3]\x1fかんじ"),)
    decks = read_apkg(apkg(notes, ((11, 1, 100, 0),), media=(("kanji.mp3", MP3),)))

    # The back's `<br>` is a line of it, so the card takes the `?` form.
    assert unhashed(as_note(decks[0])) == (
        "#flashcards/French\n\n![](French%20media/kanji.mp3)\n?\n漢字\n"
        f"Chinese characters{mark(1)}\n"
    )


def test_leaves_out_a_front_of_only_a_sound_it_could_not_carry() -> None:
    notes = ((1, JAPANESE, "漢字\x1fChinese characters\x1f[sound:kanji.mp3]\x1fかんじ"),)
    decks = read_apkg(apkg(notes, ((11, 1, 100, 0),)))

    assert unhashed(as_note(decks[0])) == "#flashcards/French\n\n"


def test_skips_a_note_no_card_points_at() -> None:
    data = apkg(cards=CARDS[1:])

    assert sides(read_apkg(data)) == {"Geography": EXPECTED["Geography"]}


def test_refuses_bytes_that_are_not_a_zip() -> None:
    with pytest.raises(ValueError, match="not a zip"):
        read_apkg(b"this is a note, not an export")


def test_refuses_a_zip_holding_no_collection() -> None:
    with pytest.raises(ValueError, match="no Anki collection"):
        read_apkg(zipped("media", b"{}"))


async def test_import_writes_one_note_per_deck(client: AsyncClient, vault: Path) -> None:
    export = apkg(
        notes=(
            (1, BASIC, "What is S3?\x1fSimple Storage"),
            (2, BASIC, "What is EC2?\x1fElastic Compute"),
        ),
        cards=((1, 1, 10, 0), (2, 2, 20, 0)),
        decks=((10, "AWS"), (20, "Terraform")),
    )

    response = await client.post("/api/anki", content=export)

    assert response.status_code == 201
    assert response.json() == {
        "notes": ["03 Flashcards/AWS.md", "03 Flashcards/Terraform.md"],
        "cards": 2,
        "media": 0,
        "added": 2,
        "updated": 0,
        "kept": 0,
        "removed": 0,
    }
    written = (vault / "03 Flashcards" / "AWS.md").read_text(encoding="utf-8")
    # Stamped like every other note kasten writes, so the tag is under the block.
    assert "\n#flashcards/AWS\n" in written
    assert written.startswith("---\nid: ")
    assert "What is S3?::Simple Storage" in written


async def test_import_counts_the_cards_the_note_holds(client: AsyncClient, vault: Path) -> None:
    # The empty back cannot be written without `srs.ts` cutting the question at
    # `std`, so the note leaves it out, and the count must not promise it. A
    # back reading as a heading is escaped and kept (#234).
    export = apkg(
        notes=(
            (1, BASIC, "What does std::size count?\x1f# of elements"),
            (2, BASIC, "a\x1fb"),
            (3, BASIC, "What does std::move do?\x1f"),
        ),
        cards=((1, 1, 10, 0), (2, 2, 10, 0), (3, 3, 10, 0)),
        decks=((10, "Cpp"),),
    )

    response = await client.post("/api/anki", content=export)

    note = (vault / "03 Flashcards" / "Cpp.md").read_text(encoding="utf-8")
    assert response.json()["cards"] == 2
    assert "a::b" in note
    assert "?\n\\# of elements" in note
    assert "std::move" not in note


async def test_import_counts_each_cloze_number_as_a_card(client: AsyncClient, vault: Path) -> None:
    # One line, and the review asks it once as `c1` and once as `c2`.
    export = apkg(
        notes=((1, CLOZE, "{{c1::H}}{{c1::O}} and {{c2::water}}\x1f"), (2, BASIC, "a\x1fb")),
        cards=((1, 1, 10, 0), (2, 1, 10, 1), (3, 2, 10, 0)),
        decks=((10, "Chem"),),
    )

    response = await client.post("/api/anki", content=export)

    assert response.json()["cards"] == 3


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


async def test_import_writes_media_beside_each_deck(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 201
    assert response.json()["media"] == 3
    folder = vault / "03 Flashcards"
    assert (folder / "Cats media" / "cat.png").read_bytes() == PNG
    assert (folder / "Cats media" / "purr.mp3").read_bytes() == MP3
    assert (folder / "Pets" / "Cats media" / "cat.png").read_bytes() == PNG
    assert not (folder / "Pets" / "Cats media" / "bad.png").exists()
    cats = (folder / "Cats.md").read_text(encoding="utf-8")
    pets = unhashed((folder / "Pets" / "Cats.md").read_text(encoding="utf-8"))
    assert (
        "![](03%20Flashcards/Cats%20media/cat.png) which cat?::"
        "the tabby ![](03%20Flashcards/Cats%20media/purr.mp3)"
    ) in cats
    assert f"![](03%20Flashcards/Pets/Cats%20media/cat.png) and here?::{mark(2)}\n" in pets
    served = await client.get("/api/assets/03%20Flashcards/Cats%20media/purr.mp3")
    assert served.content == MP3


async def test_import_refuses_media_already_in_the_vault(client: AsyncClient, vault: Path) -> None:
    taken = vault / "03 Flashcards" / "Pets" / "Cats media" / "cat.png"
    taken.parent.mkdir(parents=True)
    taken.write_bytes(b"mine")

    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 409
    assert taken.read_bytes() == b"mine"
    assert not (vault / "03 Flashcards" / "Cats.md").exists()
    assert not (vault / "03 Flashcards" / "Cats media").exists()


@pytest.mark.parametrize("name", [f"{'x' * 246}.png", ".hidden.png"], ids=["long", "hidden"])
async def test_import_skips_a_media_name_the_write_would_refuse(
    client: AsyncClient, vault: Path, name: str
) -> None:
    # A name that fits 255 bytes but whose temp beside it, `.{name}.{8 hex}.tmp`,
    # does not; and a hidden name, which no vault path may hold.
    export = apkg(
        notes=((1, BASIC, f'<img src="{name}"> which cat?\x1fthe tabby'),),
        cards=((1, 1, 10, 0),),
        decks=((10, "Cats"),),
        media=((name, PNG),),
    )

    response = await client.post("/api/anki", content=export)

    assert response.status_code == 201
    assert response.json()["media"] == 0
    note = unhashed((vault / "03 Flashcards" / "Cats.md").read_text(encoding="utf-8"))
    assert f"\nwhich cat?::the tabby{mark(1)}\n" in note
    assert not (vault / "03 Flashcards" / "Cats media").exists()


async def test_import_that_fails_partway_leaves_no_media_behind(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = main.store
    calls = 0

    async def second_fails(*args: Any, **kwargs: Any) -> str:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("disk full")
        return await real(*args, **kwargs)

    monkeypatch.setattr(main, "store", second_fails)

    with pytest.raises(OSError, match="disk full"):
        await client.post("/api/anki", content=CAT_EXPORT)

    folder = vault / "03 Flashcards"
    assert [path for path in folder.rglob("*") if path.is_file()] == []


async def test_a_re_import_answers_with_what_it_added_updated_kept_and_removed(
    client: AsyncClient, vault: Path
) -> None:
    first = apkg(
        notes=((1, BASIC, "a\x1fb"), (2, BASIC, "c\x1fd"), (3, BASIC, "e\x1ff")),
        cards=((1, 1, 10, 0), (2, 2, 10, 0), (3, 3, 10, 0)),
        decks=((10, "AWS"),),
    )
    second = apkg(
        notes=((1, BASIC, "a\x1fb"), (2, BASIC, "c\x1fD"), (4, BASIC, "g\x1fh")),
        cards=((1, 1, 10, 0), (2, 2, 10, 0), (4, 4, 10, 0)),
        decks=((10, "AWS"),),
    )
    await client.post("/api/anki", content=first)

    again = await client.post("/api/anki", content=second)

    assert again.status_code == 201
    assert again.json() == {
        "notes": ["03 Flashcards/AWS.md"],
        "cards": 3,
        "media": 0,
        "added": 1,
        "updated": 1,
        "kept": 1,
        "removed": 1,
    }
    note = unhashed((vault / "03 Flashcards" / "AWS.md").read_text(encoding="utf-8"))
    body = f"a::b{mark(1)}\nc::D{mark(2)}\ne::f{mark(3)}\ng::h{mark(4)}\n"
    assert note.endswith(f"\n#flashcards/AWS\n\n{body}")


async def test_an_unchanged_re_import_leaves_the_note_unwritten(
    client: AsyncClient, vault: Path
) -> None:
    export = apkg(notes=((1, BASIC, "a\x1fb"),), cards=((1, 1, 10, 0),), decks=((10, "AWS"),))
    await client.post("/api/anki", content=export)
    note = vault / "03 Flashcards" / "AWS.md"
    before = (note.read_bytes(), note.stat().st_mtime_ns)

    again = await client.post("/api/anki", content=export)

    assert again.status_code == 201
    assert again.json()["kept"] == 1
    assert (note.read_bytes(), note.stat().st_mtime_ns) == before


async def test_a_deck_note_with_no_marker_is_refused_and_left_alone(
    client: AsyncClient, vault: Path
) -> None:
    # Imported before the marker: nothing says which card is which.
    note = vault / "03 Flashcards" / "AWS.md"
    note.parent.mkdir()
    note.write_text("#flashcards/AWS\n\na::b\n", encoding="utf-8")
    export = apkg(notes=((1, BASIC, "a\x1fb"),), cards=((1, 1, 10, 0),), decks=((10, "AWS"),))

    response = await client.post("/api/anki", content=export)

    assert response.status_code == 409
    assert "AWS" in response.json()["detail"]
    assert note.read_text(encoding="utf-8") == "#flashcards/AWS\n\na::b\n"


async def test_a_merge_keeps_media_already_there(client: AsyncClient, vault: Path) -> None:
    await client.post("/api/anki", content=CAT_EXPORT)
    taken = vault / "03 Flashcards" / "Cats media" / "cat.png"
    taken.write_bytes(b"mine")

    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 201
    assert response.json()["media"] == 0
    assert taken.read_bytes() == b"mine"


async def test_one_export_merges_an_existing_deck_and_creates_a_new_one(
    client: AsyncClient, vault: Path
) -> None:
    first = apkg(notes=((1, BASIC, "a\x1fb"),), cards=((1, 1, 10, 0),), decks=((10, "AWS"),))
    both = apkg(
        notes=((1, BASIC, "a\x1fB"), (2, BASIC, "c\x1fd")),
        cards=((1, 1, 10, 0), (2, 2, 20, 0)),
        decks=((10, "AWS"), (20, "GCP")),
    )
    await client.post("/api/anki", content=first)

    response = await client.post("/api/anki", content=both)

    assert response.status_code == 201
    assert response.json()["notes"] == ["03 Flashcards/AWS.md", "03 Flashcards/GCP.md"]
    assert (response.json()["added"], response.json()["updated"]) == (1, 1)
    folder = vault / "03 Flashcards"
    assert f"\na::B{marked(1, 'a::B')}\n" in (folder / "AWS.md").read_text(encoding="utf-8")
    assert f"\nc::d{marked(2, 'c::d')}\n" in (folder / "GCP.md").read_text(encoding="utf-8")


def reviewed(deck: str, *, more: bool = False) -> bytes:
    """An export of one deck whose cards Anki has in review, `more` adding one to it."""
    notes = (
        (1, BASIC, "a\x1fb"),
        (2, BASIC, "What is a::b?\x1fc"),
        (3, CLOZE, "{{c1::H}} {{c2::O}} {{c3::N}}\x1f"),
    )
    cards = ((1, 1, 10, 0), (2, 2, 10, 0), (3, 3, 10, 0), (4, 3, 10, 1), (5, 3, 10, 2))
    reviews = ((1, 2, 4, 2500, 10), (2, 2, 9, 2300, 20), (3, 2, 3, 2500, 5), (5, 2, 7, 2700, 6))
    if more:
        notes += ((4, BASIC, "d\x1fe"),)
        cards += ((6, 4, 10, 0),)
        reviews += ((6, 2, 1, 2500, 2),)
    return apkg(notes, cards, ((10, deck),), reviews=reviews)


async def test_carry_writes_anki_schedules_and_is_off_by_default(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=reviewed("Off"))
    await client.post("/api/anki", params={"carry": "true"}, content=reviewed("Off", more=True))
    await client.post("/api/anki", params={"carry": "true"}, content=reviewed("On"))

    folder = vault / "03 Flashcards"
    off = unhashed((folder / "Off.md").read_text(encoding="utf-8"))
    on = unhashed((folder / "On.md").read_text(encoding="utf-8"))
    # A card already in the note keeps the schedule kasten gave it, none here;
    # only the one the merge added takes Anki's.
    assert off.count("<!--SR:") == 1
    assert f"\nd::e{mark(4)} <!--SR:!2026-01-03,1,250-->\n" in off
    assert on.endswith(
        f"a::b{mark(1)} <!--SR:!2026-01-11,4,250-->\n\n"
        f"What is a::b?\n?\nc{mark(2)}\n<!--SR:!2026-01-21,9,230-->\n\n"
        f"{{{{c1::H}}}} {{{{c2::O}}}} {{{{c3::N}}}}{mark(3)}"
        " <!--SR:c1!2026-01-06,3,250--> <!--SR:c3!2026-01-07,7,270-->\n"
    )


def test_carry_writes_nothing_for_a_card_new_learning_or_relearning() -> None:
    notes = tuple((nid, BASIC, f"q{nid}\x1fa") for nid in (1, 2, 3, 4))
    cards = tuple((nid, nid, 10, 0) for nid in (1, 2, 3, 4))
    reviews = tuple((nid, kind, 4, 2500, 10) for nid, kind in ((1, 0), (2, 1), (3, 3), (4, 2)))

    deck = read_apkg(apkg(notes, cards, ((10, "x"),), reviews=reviews), carry=True)[0]

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\nq1::a{mark(1)}\nq2::a{mark(2)}\nq3::a{mark(3)}\n"
        f"q4::a{mark(4)} <!--SR:!2026-01-11,4,250-->\n"
    )


@pytest.mark.parametrize("crt", [NO_ROW, None, "soon", 1.5], ids=["no-row", "null", "text", "real"])
async def test_carry_refuses_an_export_whose_creation_time_it_cannot_read(
    client: AsyncClient, vault: Path, crt: object
) -> None:
    export = apkg(schema18=True, reviews=((11, 2, 4, 2500, 10),), crt=crt)

    response = await client.post("/api/anki", params={"carry": "true"}, content=export)

    assert response.status_code == 400
    assert "unreadable" in response.json()["detail"]
    assert not (vault / "03 Flashcards").exists()


async def test_import_refuses_a_deck_name_that_climbs_out(client: AsyncClient, vault: Path) -> None:
    export = apkg(
        notes=((1, BASIC, "a\x1fb"),), cards=((1, 1, 10, 0),), decks=((10, "../../etc/passwd"),)
    )

    response = await client.post("/api/anki", content=export)

    assert response.status_code == 400
    assert not (vault.parent / "etc").exists()


async def test_import_refuses_something_that_is_not_an_export(client: AsyncClient) -> None:
    response = await client.post("/api/anki", content=b"not a zip at all")

    assert response.status_code == 400


async def test_import_refuses_a_collection_with_no_note_types(client: AsyncClient) -> None:
    response = await client.post("/api/anki", content=apkg(types=(), schema18=True))

    assert response.status_code == 400


async def test_import_writes_no_block_into_a_reserved_name(
    client: AsyncClient, vault: Path
) -> None:
    # A deck named `index` lands on a filename OKF reserves, and kasten writes
    # no block into one of those whichever route the text arrived by.
    export = apkg(notes=((1, BASIC, "a\x1fb"),), cards=((1, 1, 10, 0),), decks=((10, "index"),))

    await client.post("/api/anki", content=export)

    assert "---" not in (vault / "03 Flashcards" / "index.md").read_text(encoding="utf-8")


def legacy_collection(decks: str, flds: object) -> bytes:
    """An old-schema export holding one note whose fields are `flds`, of whatever type."""
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "collection"
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE notes (id, mid, flds)")
            db.execute("CREATE TABLE cards (id, nid, did, ord)")
            db.execute("CREATE TABLE col (decks, models)")
            db.execute("INSERT INTO notes VALUES (1, 1, ?)", (flds,))
            db.execute("INSERT INTO cards VALUES (1, 1, 1, 0)")
            db.execute("INSERT INTO col VALUES (?, ?)", (decks, legacy_type()))
        db.close()
        return zipped("collection.anki2", path.read_bytes())


@pytest.mark.parametrize(
    "export",
    [
        zipped("collection.anki21b", b"junk"),
        legacy_collection('{"1": {}}', "a"),
        legacy_collection('{"1": {"name": "D"}}', b"a\x1fb"),
        legacy_collection('{"1": {"name": 5}}', "a"),
        zipped(
            "collection.anki21",
            sqlite3_bytes(
                "CREATE TABLE notes (id, mid, flds)",
                "CREATE TABLE cards (id, nid, did, ord)",
                "CREATE TABLE decks (id, name)",
                "CREATE TABLE notetypes (id, name, config)",
                "CREATE TABLE fields (ntid, ord, name)",
                "CREATE TABLE templates (ntid, ord, name, config)",
                "INSERT INTO notes VALUES (1, 1, 'a')",
                "INSERT INTO cards VALUES (1, 1, 1, 0)",
                "INSERT INTO notetypes VALUES (1, 'B', x'')",
                "INSERT INTO fields VALUES (1, 0, 'F')",
                row=("INSERT INTO decks VALUES (1, X'41')", ()),
            ),
        ),
    ],
    ids=[
        "anki21b-not-zstd",
        "deck-without-name",
        "flds-blob",
        "legacy-deck-name-int",
        "deck-name-blob",
    ],
)
async def test_import_refuses_an_export_it_cannot_read(
    client: AsyncClient, vault: Path, export: bytes
) -> None:
    response = await client.post("/api/anki", content=export)

    assert response.status_code == 400
    assert "unreadable" in response.json()["detail"]
    assert not (vault / "03 Flashcards").exists()


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


def whole(*args: object, **kwargs: object) -> bytes:
    """What stands in for a whole read, which a bomb gets through before any cap is checked."""
    raise AssertionError("read a member whole rather than counting it as it unpacked")


def unpacked(export: bytes, *members: str) -> int:
    """What reading `members` of `export` spends: the bytes the zip gives, and zstd's besides."""
    total = 0
    with zipfile.ZipFile(io.BytesIO(export)) as bundle:
        for member in members:
            data = bundle.read(member)
            total += len(data)
            if data.startswith(anki.ZSTD_MAGIC):
                total += len(zstd.decompress(data))
    return total


def test_a_collection_of_two_zstd_frames_reads_whole() -> None:
    # `zstd.decompress` reads every frame, and a decompressor stops after one.
    export = apkg(schema18=True, member="collection.anki21b")
    blob = zstd.decompress(zipfile.ZipFile(io.BytesIO(export)).read("collection.anki21b"))
    half = len(blob) // 2
    split = zipped("collection.anki21b", zstd.compress(blob[:half]) + zstd.compress(blob[half:]))

    assert sides(read_apkg(split)) == sides(read_apkg(export))


@pytest.mark.parametrize("layer", ["deflate", "zstd"])
async def test_a4_a_member_unpacking_past_its_cap_is_refused(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch, layer: str
) -> None:
    if layer == "deflate":
        export, cap = deflated(apkg()), 1024
    else:
        # The cap the stored member's own size, so the zip passes and zstd runs over.
        export = apkg(schema18=True, member="collection.anki21b")
        cap = zipfile.ZipFile(io.BytesIO(export)).getinfo("collection.anki21b").file_size
    monkeypatch.setattr(anki, "MEMBER_LIMIT_BYTES", cap, raising=False)
    monkeypatch.setattr(zipfile.ZipFile, "read", whole)
    monkeypatch.setattr(zstd, "decompress", whole)

    response = await client.post("/api/anki", content=export)

    member = "collection.anki2" if layer == "deflate" else "collection.anki21b"
    assert response.status_code == 400
    assert response.json()["detail"] == f"Anki export too large: {member} unpacks past {cap} bytes"
    assert not (vault / "03 Flashcards").exists()


async def test_a5_members_together_past_the_total_cap_are_refused(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Room for the collection to the byte, so the media map after it runs over.
    total = unpacked(CAT_EXPORT, "collection.anki21b")
    monkeypatch.setattr(anki, "TOTAL_LIMIT_BYTES", total, raising=False)

    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 400
    assert response.json()["detail"] == (
        f"Anki export too large: its files unpack past {total} bytes together"
    )
    assert not (vault / "03 Flashcards").exists()


async def test_a6_more_members_than_the_count_cap_are_refused(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(anki, "MEMBER_COUNT_LIMIT", 2, raising=False)

    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 400
    assert response.json()["detail"] == "Anki export too large: it holds more than 2 files"
    assert not (vault / "03 Flashcards").exists()


async def test_a7_an_export_refused_at_its_media_writes_no_notes_and_no_media(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Room for the collection and the media map but not one file more, so the
    # refusal comes after every card is read and before any is written.
    total = unpacked(CAT_EXPORT, "collection.anki21b", "media")
    monkeypatch.setattr(anki, "TOTAL_LIMIT_BYTES", total, raising=False)

    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 400
    assert "together" in response.json()["detail"]
    assert not (vault / "03 Flashcards").exists()


@pytest.mark.parametrize("way", ["file", "link"])
async def test_a8_an_import_leaves_the_server_answering_while_it_reads(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch, way: str
) -> None:
    started, release = threading.Event(), threading.Event()
    released: list[bool] = []

    def held(*args: object, **kwargs: object) -> list[Deck]:
        started.set()
        # Times out rather than hangs when the read blocks the event loop,
        # since then nothing can answer the request that would release it.
        released.append(release.wait(3))
        return []

    async def fetched(url: str) -> bytes:
        return CAT_EXPORT

    monkeypatch.setattr(main, "read_apkg", held)
    monkeypatch.setattr(files, "fetch_deck", fetched)
    importing = asyncio.create_task(
        client.post("/api/anki", content=CAT_EXPORT)
        if way == "file"
        else client.post("/api/anki/link", json={"url": "https://example.com/deck.apkg"})
    )
    try:
        assert await asyncio.to_thread(started.wait, 5)
        health = await asyncio.wait_for(client.get("/api/health"), 1)
        assert health.status_code == 200
        assert not importing.done()
    finally:
        release.set()

    assert (await importing).status_code == 201
    assert released == [True]


def headers(export: bytes, member: str) -> tuple[int, int, int]:
    """Where `member`'s local header, its central entry and its data start in `export`."""
    with zipfile.ZipFile(io.BytesIO(export)) as bundle:
        infos = bundle.infolist()
        index = next(i for i, info in enumerate(infos) if info.filename == member)
        central = bundle.start_dir + sum(
            46 + len(info.filename.encode()) + len(info.extra) + len(info.comment)
            for info in infos[:index]
        )
        local = infos[index].header_offset
    names, extra = struct.unpack_from("<2H", export, local + 26)
    return local, central, local + 30 + names + extra


def broken(
    export: bytes,
    member: str,
    *,
    flags: int = 0,
    method: int | None = None,
    version: int | None = None,
    data: bytes = b"",
) -> bytes:
    """`export` with `member` patched: `flags` and `method` in both its headers, the
    `version` needed in its central entry, or its stored bytes begun with `data`.

    Python writes no encrypted and no deflate64 member, so these patch one it wrote.
    """
    local, central, start = headers(export, member)
    out = bytearray(export)
    out[local + 6] |= flags
    out[central + 8] |= flags
    if method is not None:
        struct.pack_into("<H", out, local + 8, method)
        struct.pack_into("<H", out, central + 10, method)
    if version is not None:
        out[central + 6] = version
    out[start : start + len(data)] = data
    return bytes(out)


def cut_short() -> bytes:
    """An export whose collection states a size past the end of the zip, so its read runs out.

    zipfile refuses a size that runs into the next member, except where a
    second entry starts at the same header, and there it only warns: `x` is
    that entry.
    """
    blob = zipfile.ZipFile(io.BytesIO(apkg())).read("collection.anki2")
    export = zipped("collection.anki2", blob, ("x", b""))
    _, central, _ = headers(export, "collection.anki2")
    _, other, _ = headers(export, "x")
    out = bytearray(export)
    struct.pack_into("<2L", out, central + 20, 2 * len(export), 2 * len(export))
    struct.pack_into("<L", out, other + 42, 0)
    return bytes(out)


UNREADABLE = {
    # A first byte of block type 3, which deflate does not have.
    "deflate": broken(deflated(apkg()), "collection.anki2", data=b"\xff"),
    "encrypted": broken(apkg(), "collection.anki2", flags=0x1),
    "deflate64": broken(deflated(apkg()), "collection.anki2", method=9),
    "cut-short": cut_short(),
    "crc": broken(apkg(), "collection.anki2", data=b"X"),
    # Past zipfile's own four bytes, an lc/lp/pb byte no LZMA allows.
    "lzma": broken(
        deflated(apkg(), zipfile.ZIP_LZMA), "collection.anki2", data=b"\x09\x04\x05\x00\xff"
    ),
    "bzip2": broken(deflated(apkg(), zipfile.ZIP_BZIP2), "collection.anki2", data=b"XXXX"),
    "zstd": broken(deflated(apkg(), zipfile.ZIP_ZSTANDARD), "collection.anki2", data=b"XXXX"),
    # zipfile reads up to version 6.3 and refuses the whole directory past it.
    "version": broken(apkg(), "collection.anki2", version=64),
}
"""Exports zipfile cannot read a member of, each in its own way."""


@pytest.fixture
def directory_reads(monkeypatch: pytest.MonkeyPatch) -> list[zipfile.ZipFile]:
    """Every zip whose directory zipfile reads from here on, an object built per entry."""
    reads: list[zipfile.ZipFile] = []
    real = zipfile.ZipFile._RealGetContents  # ty: ignore[unresolved-attribute]

    def counted(self: zipfile.ZipFile) -> None:
        reads.append(self)
        real(self)

    monkeypatch.setattr(zipfile.ZipFile, "_RealGetContents", counted)
    return reads


async def test_b1_an_export_past_the_count_cap_is_refused_before_its_directory_is_read(
    client: AsyncClient,
    vault: Path,
    monkeypatch: pytest.MonkeyPatch,
    directory_reads: list[zipfile.ZipFile],
) -> None:
    monkeypatch.setattr(anki, "MEMBER_COUNT_LIMIT", 2, raising=False)

    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 400
    assert response.json()["detail"] == "Anki export too large: it holds more than 2 files"
    assert directory_reads == []


async def test_b2_a_corrupt_deflate_stream_is_refused(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/anki", content=UNREADABLE["deflate"])

    assert response.status_code == 400
    assert response.json()["detail"].startswith("unreadable Anki export: ")


async def test_b3_an_encrypted_member_is_refused(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/anki", content=UNREADABLE["encrypted"])

    assert response.status_code == 400
    assert response.json()["detail"].startswith("unreadable Anki export: ")


async def test_b4_a_deflate64_member_is_refused(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/anki", content=UNREADABLE["deflate64"])

    assert response.status_code == 400
    assert response.json()["detail"].startswith("unreadable Anki export: ")


@pytest.mark.parametrize("case", ["cut-short", "crc", "lzma", "bzip2", "zstd", "version"])
async def test_b5_every_other_unreadable_export_is_refused(
    client: AsyncClient, vault: Path, case: str
) -> None:
    response = await client.post("/api/anki", content=UNREADABLE[case])

    assert response.status_code == 400
    assert response.json()["detail"].startswith("unreadable Anki export: ")


@pytest.mark.parametrize("case", UNREADABLE)
async def test_b6_an_unreadable_export_writes_no_note_and_no_media(
    client: AsyncClient, vault: Path, case: str
) -> None:
    response = await client.post("/api/anki", content=UNREADABLE[case])

    assert response.status_code == 400
    assert not (vault / "03 Flashcards").exists()


async def test_i1_a_record_that_understates_its_count_is_refused_all_the_same(
    client: AsyncClient,
    vault: Path,
    monkeypatch: pytest.MonkeyPatch,
    directory_reads: list[zipfile.ZipFile],
) -> None:
    # zipfile reads the directory by its size, so a count of 1 hides the other five.
    export = bytearray(CAT_EXPORT)
    struct.pack_into("<2H", export, len(export) - 22 + 8, 1, 1)
    monkeypatch.setattr(anki, "MEMBER_COUNT_LIMIT", 2, raising=False)

    response = await client.post("/api/anki", content=bytes(export))

    assert response.status_code == 400
    assert response.json()["detail"] == "Anki export too large: it holds more than 2 files"
    assert directory_reads == []


async def test_i1_a_zip64_record_that_understates_its_count_is_refused_all_the_same(
    client: AsyncClient,
    vault: Path,
    monkeypatch: pytest.MonkeyPatch,
    directory_reads: list[zipfile.ZipFile],
) -> None:
    # Both counts of the zip64 record, 56 bytes before its 20-byte locator and
    # the plain record, say 1; the directory still holds six.
    export = bytearray(rewritten(CAT_EXPORT, zip64=True))
    directory_reads.clear()  # the rewrite's own read of CAT_EXPORT
    struct.pack_into("<2Q", export, len(export) - 22 - 20 - 56 + 24, 1, 1)
    # So only the walk can refuse it: the record zipfile resolves counts 1.
    end = zipfile._EndRecData(io.BytesIO(bytes(export)))  # ty: ignore[unresolved-attribute]
    assert (end[0], end[4]) == (b"PK\x06\x06", 1)
    monkeypatch.setattr(anki, "MEMBER_COUNT_LIMIT", 2, raising=False)

    response = await client.post("/api/anki", content=bytes(export))

    assert response.status_code == 400
    assert response.json()["detail"] == "Anki export too large: it holds more than 2 files"
    assert directory_reads == []


def rewritten(export: bytes, *, zip64: bool = False, comment: bytes = b"") -> bytes:
    """`export` written again with a zip `comment`, or with a zip64 end record."""
    buffer = io.BytesIO()
    with pytest.MonkeyPatch.context() as patch:
        if zip64:
            # zipfile writes the zip64 record only past this many members.
            patch.setattr(zipfile, "ZIP_FILECOUNT_LIMIT", 0)
        with (
            zipfile.ZipFile(io.BytesIO(export)) as source,
            zipfile.ZipFile(buffer, "w") as bundle,
        ):
            bundle.comment = comment
            for info in source.infolist():
                bundle.writestr(info.filename, source.read(info))
    out = bytearray(buffer.getvalue())
    if zip64:
        # What the plain record says past 65535 members: read the zip64 one.
        struct.pack_into("<2H", out, len(out) - 22 + 8, 0xFFFF, 0xFFFF)
    return bytes(out)


@pytest.mark.parametrize("form", ["zip64", "comment"])
async def test_i2_a_zip64_record_or_a_comment_is_counted_and_imports(
    client: AsyncClient,
    vault: Path,
    monkeypatch: pytest.MonkeyPatch,
    directory_reads: list[zipfile.ZipFile],
    form: str,
) -> None:
    comment = b"from Anki" if form == "comment" else b""
    export = rewritten(CAT_EXPORT, zip64=form == "zip64", comment=comment)
    directory_reads.clear()  # the rewrite's own read of CAT_EXPORT
    # Six members: the collection, the media map, meta and three files.
    monkeypatch.setattr(anki, "MEMBER_COUNT_LIMIT", 5, raising=False)
    refused = await client.post("/api/anki", content=export)
    assert directory_reads == []
    monkeypatch.setattr(anki, "MEMBER_COUNT_LIMIT", 6, raising=False)

    imported = await client.post("/api/anki", content=export)

    assert refused.status_code == 400
    assert refused.json()["detail"] == "Anki export too large: it holds more than 5 files"
    assert imported.status_code == 201


async def test_i3_a_corrupt_media_file_refuses_the_import(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/anki", content=broken(CAT_EXPORT, "0", data=b"X"))

    assert response.status_code == 400
    assert response.json()["detail"].startswith("unreadable Anki export: 0: ")
    assert not (vault / "03 Flashcards").exists()


@pytest.mark.parametrize("case", [case for case in UNREADABLE if case != "version"])
async def test_i5_the_refusal_names_the_member_it_could_not_read(
    client: AsyncClient, vault: Path, case: str
) -> None:
    response = await client.post("/api/anki", content=UNREADABLE[case])

    assert response.json()["detail"].startswith("unreadable Anki export: collection.anki2: ")


async def test_a7_a_local_header_name_that_is_not_utf_8_names_the_member(
    client: AsyncClient, vault: Path
) -> None:
    # The flag and the bad byte in the local header only, so the directory
    # reads and the member's own open is what fails.
    export = apkg()
    local, _, _ = headers(export, "collection.anki2")
    out = bytearray(export)
    out[local + 7] |= 0x08  # flag bit 0x800, a name in utf-8
    out[local + 30] = 0xFF

    response = await client.post("/api/anki", content=bytes(out))

    assert response.status_code == 400
    assert response.json()["detail"].startswith("unreadable Anki export: collection.anki2: ")
    assert not (vault / "03 Flashcards").exists()


async def test_a8_a_central_entry_name_that_is_not_utf_8_is_refused(
    client: AsyncClient, vault: Path
) -> None:
    export = apkg()
    _, central, _ = headers(export, "collection.anki2")
    out = bytearray(export)
    out[central + 9] |= 0x08  # flag bit 0x800, a name in utf-8
    out[central + 46] = 0xFF

    response = await client.post("/api/anki", content=bytes(out))

    assert response.status_code == 400
    assert response.json()["detail"].startswith("unreadable Anki export: ")
    assert not (vault / "03 Flashcards").exists()
