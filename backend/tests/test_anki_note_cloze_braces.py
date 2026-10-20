import pytest

from backend.tests.anki_build import cloze_note, mark, unhashed
from kasten_backend.anki_note import as_note, card_count


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
