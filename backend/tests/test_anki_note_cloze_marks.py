from typing import Any

import pytest

from backend.tests.anki_build import (
    BASIC,
    CARDS,
    CLOZE,
    LAYOUTS,
    apkg,
    cloze_note,
    mark,
    sides,
    unhashed,
)
from kasten_backend.anki import read_apkg
from kasten_backend.anki_deck import Card, Deck, Template
from kasten_backend.anki_html import plain
from kasten_backend.anki_note import as_note, card_count


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


def test_a1_a_cloze_mark_in_code_moves_the_code_inside_the_mark() -> None:
    # A code span is code to kasten, so a mark inside one is no mark (#346).
    deck = cloze_note("<code>{{c1::a&#58;&#58;b}}</code>", "")

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{{{{c1::`a::b`}}}}{mark(1)}\n"
    assert card_count(deck) == 1


def test_a2_a_backslash_in_a_cloze_mark_in_code_stays_one() -> None:
    deck = cloze_note("<code>{{c1::a\\b}}</code>", "")

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{{{{c1::`a\\b`}}}}{mark(1)}\n"


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
