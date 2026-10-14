"""What an Anki `.apkg` export turns into, and what it refuses to import.

The fixtures are built here rather than checked in: an export is a zip around an
sqlite file, and a real one carries a hundred columns of scheduling state none of
this reads. The builder below writes only the columns the reader touches, in the
two schemas Anki has written, so a test says which schema it is about instead of
a binary blob saying nothing. The note types are the shapes a real export from
Anki 26.09 holds, templates and all.
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
from typing import TYPE_CHECKING, Any

import pytest

from kasten_backend import main
from kasten_backend.anki import (
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
        (r"{{c1::\(x^{2}\)}} is the square", r"==\(x^{2}\)== is the square"),
        ("{{c1::}} x", "==== x"),
        (r"{{c1::\(x^{2}\)}} is {{c2::the square}}", r"==\(x^{2}\)== is {{c2::the square}}"),
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

    assert merged is not None
    assert unhashed(merged.text) == f"#flashcards/x\n\nmine q\n?\nmine a\nz::Z{mark(1)} {SR1}\n"


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
        (r"{{c1::\(x^{2}\)}} is the square", r"==\(x^{2}\)== is the square::extra"),
        ("{{c1::}} x", "==== x::extra"),
        (r"{{c1::\(x^{2}\)}} is {{c2::it}}", r"==\(x^{2}\)== is {{c2::it}}" + "\n?\nextra"),
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
    # `fences()` in `card-line.ts` reads a line opening with three backticks as
    # a fence, and both readers would skip every card under it.
    deck = basic_deck(("```js x", "code"), ("```a::b", "```c"), ("a", "b"))

    note = as_note(deck)

    assert not any(line.lstrip().startswith("```") for line in note.splitlines())
    assert unhashed(note) == (
        f"#flashcards/x\n\n\\```js x::code{mark(1)}\n\n\\```a::b\n?\n\\```c{mark(2)}\n\n"
        f"a::b{mark(3)}\n"
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
