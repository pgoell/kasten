from typing import Any

import pytest

from backend.tests.anki_build import (
    BASIC,
    COND,
    EXPECTED,
    FILTERS,
    JAPANESE,
    LAYOUTS,
    REVERSED,
    SOLO,
    NoteType,
    apkg,
    one_deck,
    sides,
)
from kasten_backend.anki import read_apkg
from kasten_backend.anki_deck import Card, Template


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
