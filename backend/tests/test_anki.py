"""What an Anki `.apkg` export turns into, and what it refuses to import.

The fixtures are built here rather than checked in: an export is a zip around an
sqlite file, and a real one carries a hundred columns of scheduling state none of
this reads. The builder below writes only the columns the reader touches, in the
two schemas Anki has written, so a test says which schema it is about instead of
a binary blob saying nothing. The note types are the shapes a real export from
Anki 26.09 holds, templates and all.
"""

import io
import json
import sqlite3
import tempfile
import zipfile
from compression import zstd
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest

from kasten_backend.anki import Card, Deck, Template, as_note, plain, read_apkg

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


def apkg(
    notes: tuple[tuple[int, int, str], ...] = NOTES,
    cards: tuple[tuple[int, int, int, int], ...] = CARDS,
    decks: tuple[tuple[int, str], ...] = DECKS,
    *,
    types: tuple[NoteType, ...] = TYPES,
    schema18: bool = False,
    member: str = "collection.anki2",
) -> bytes:
    """The bytes of an export holding `notes` in `decks`, in one of the two schemas."""
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "collection"
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT)")
            db.execute(
                "CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER)"
            )
            db.executemany("INSERT INTO notes VALUES (?, ?, ?)", notes)
            db.executemany("INSERT INTO cards VALUES (?, ?, ?, ?)", cards)
            if schema18:
                write_schema_18(db, decks, types)
            else:
                write_legacy(db, decks, types)
        db.close()
        blob = path.read_bytes()

    return zipped(member, zstd.compress(blob) if member == "collection.anki21b" else blob)


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
    db.execute("CREATE TABLE col (decks TEXT, models TEXT)")
    db.execute("INSERT INTO col VALUES (?, ?)", (json.dumps(listing), json.dumps(models)))


def write_schema_18(
    db: sqlite3.Connection, decks: tuple[tuple[int, str], ...], types: tuple[NoteType, ...]
) -> None:
    db.execute("CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT)")
    db.executemany("INSERT INTO decks VALUES (?, ?)", decks)
    # `col.models` is an empty string from schema 18, which is what Anki writes.
    db.execute("CREATE TABLE col (decks TEXT, models TEXT)")
    db.execute("INSERT INTO col VALUES ('', '')")
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


def proto(number: int, value: int | str) -> bytes:
    """One protobuf field: a varint for an int, length-delimited for a string."""
    if isinstance(value, int):
        return varint(number << 3) + varint(value)
    data = value.encode()
    return varint(number << 3 | 2) + varint(len(data)) + data


def varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte, value = value & 0x7F, value >> 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def zipped(name: str, blob: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr(name, blob)
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


def test_plain_turns_a_break_into_a_space_and_strips_every_other_tag() -> None:
    # `<b>` leaves no space behind: only the four tags that end a line do.
    assert plain("one<br>two<br/>three</div>four</p><b>five</b>six") == "one two three four fivesix"


def test_plain_unescapes_entities() -> None:
    assert plain("salt&nbsp;&amp;&nbsp;pepper") == "salt & pepper"


def test_plain_drops_an_image_and_a_sound() -> None:
    assert plain('<img src="cat.jpg"> a cat [sound:meow.mp3] purring') == "a cat purring"


def test_plain_turns_a_cloze_into_a_highlight() -> None:
    assert plain("{{c1::Paris}} is the capital") == "==Paris== is the capital"


def test_plain_drops_a_cloze_hint() -> None:
    assert plain("{{c1::Paris::city}} is the capital") == "==Paris== is the capital"


def test_plain_answers_with_one_line() -> None:
    result = plain("first\nsecond  \t third \n")

    assert "\n" not in result
    assert result == "first second third"


def test_plain_drops_script_and_style_blocks() -> None:
    assert plain("<style>.card { color: red }</style>a<SCRIPT>var x = 1;</script>b") == "ab"


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
        ("listen here", "漢字 Chinese characters"),
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
        ("listen here", "漢字 Chinese characters")
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
    assert one_deck(notes, ((11, 1, 100, 0),)) == [("", "火 fire")]


@pytest.mark.parametrize("layout", LAYOUTS)
def test_filters_show_the_field_named_last_and_the_rest_nothing(layout: dict[str, Any]) -> None:
    notes = ((1, FILTERS, "unused\x1fBonjour\x1fhello"),)
    cards = ((11, 1, 100, 0), (12, 1, 100, 1))

    # `F2` has only special fields, an unknown one and a `tts`, which never
    # make a front, so the note gives one card.
    assert one_deck(notes, cards, **layout) == [("Bonjour", "hello")]


@pytest.mark.parametrize("layout", LAYOUTS)
def test_a_cloze_note_gives_one_card_of_its_first_two_fields(layout: dict[str, Any]) -> None:
    notes = ((1, CLOZE, "{{c1::Paris}} is in {{c2::France}}\x1f"),)
    cards = ((11, 1, 200, 1), (12, 1, 100, 0))

    decks = read_apkg(apkg(notes, cards, **layout))

    assert sides(decks) == {"French": [("==Paris== is in ==France==", "")]}
    assert as_note(decks[0]) == "#flashcards/French\n\n==Paris== is in ==France==::\n"


def test_writes_a_deck_as_a_tagged_note() -> None:
    template = Template("Card 1", "{{Front}}", "{{Back}}")
    deck = Deck(
        "Certs/AWS",
        [
            Card(front, back, {}, template, "Basic", cloze=False)
            for front, back in (
                ("Bonjour", "hello"),
                ("", "orphan"),
                ("Paris", "the capital"),
                ("alone", ""),
            )
        ],
        0,
    )

    assert as_note(deck) == "#flashcards/Certs/AWS\n\nBonjour::hello\nParis::the capital\nalone::\n"


def test_parks_a_card_whose_back_adds_nothing() -> None:
    decks = read_apkg(apkg(((1, SOLO, "alone"),), ((11, 1, 100, 0),)))

    assert as_note(decks[0]) == "#flashcards/French\n\nalone::\n"


def test_writes_a_question_holding_the_divider_over_three_lines() -> None:
    # A card line splits at its first `::`, so on one line this question would
    # read back as `What does std`. `frontend/tests/srs.test.ts` and
    # `review.test.ts` read this exact text back.
    decks = read_apkg(apkg(((1, BASIC, "What does std::move do?\x1fcasts to an rvalue"),)))

    assert as_note(decks[0]) == (
        "#flashcards/French\n\nWhat does std::move do?\n?\ncasts to an rvalue\n"
    )


def test_sets_a_question_holding_the_divider_apart_from_its_neighbours() -> None:
    template = Template("Card 1", "{{Front}}", "{{Back}}")
    pairs = (("a", "b"), ("What does std::move do?", "casts std::move"), ("c", "d"))
    deck = Deck("x", [Card(f, b, {}, template, "Basic", cloze=False) for f, b in pairs], 0)

    assert as_note(deck) == (
        "#flashcards/x\n\na::b\n\nWhat does std::move do?\n?\ncasts std::move\n\nc::d\n"
    )


def test_leaves_out_a_question_holding_the_divider_with_no_answer() -> None:
    template = Template("Card 1", "{{Front}}", "{{Back}}")
    pairs = (("What does std::move do?", ""), ("a", "b"))
    deck = Deck("x", [Card(f, b, {}, template, "Basic", cloze=False) for f, b in pairs], 0)

    assert as_note(deck) == "#flashcards/x\n\na::b\n"


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
    assert sides(read_apkg(data)) == {"D": [("q", "secret")]}


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


def test_counts_each_card_that_names_media() -> None:
    notes = ((1, REVERSED, '<img src="cat.jpg"> a cat\x1fle chat'),)
    cards = ((11, 1, 100, 0), (12, 1, 100, 1))

    decks = read_apkg(apkg(notes, cards, ((100, "French"),)))

    assert sides(decks) == {"French": [("a cat", "le chat"), ("le chat", "a cat")]}
    assert decks[0].dropped_media == 2


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
        "dropped_media": 0,
    }
    written = (vault / "03 Flashcards" / "AWS.md").read_text(encoding="utf-8")
    # Stamped like every other note kasten writes, so the tag is under the block.
    assert "\n#flashcards/AWS\n" in written
    assert written.startswith("---\nid: ")
    assert "What is S3?::Simple Storage" in written


async def test_import_says_how_much_media_it_dropped(client: AsyncClient, vault: Path) -> None:
    export = apkg(
        notes=((1, BASIC, '<img src="cat.jpg"> which cat?\x1fthe tabby'),),
        cards=((1, 1, 10, 0),),
        decks=((10, "Cats"),),
    )

    response = await client.post("/api/anki", content=export)

    assert response.json()["dropped_media"] == 1
    assert "cat.jpg" not in (vault / "03 Flashcards" / "Cats.md").read_text(encoding="utf-8")


async def test_import_refuses_a_deck_already_imported(client: AsyncClient, vault: Path) -> None:
    export = apkg(notes=((1, BASIC, "a\x1fb"),), cards=((1, 1, 10, 0),), decks=((10, "AWS"),))
    await client.post("/api/anki", content=export)

    again = await client.post("/api/anki", content=export)

    assert again.status_code == 409
    assert "AWS" in again.json()["detail"]


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
    ],
    ids=["anki21b-not-zstd", "deck-without-name", "flds-blob"],
)
async def test_import_refuses_an_export_it_cannot_read(
    client: AsyncClient, vault: Path, export: bytes
) -> None:
    response = await client.post("/api/anki", content=export)

    assert response.status_code == 400
    assert "unreadable" in response.json()["detail"]
    assert not (vault / "03 Flashcards").exists()
