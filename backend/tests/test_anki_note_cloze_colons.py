import pytest

from backend.tests.anki_build import BASIC, CARDS, apkg, cloze_note, mark, unhashed
from kasten_backend.anki import read_apkg
from kasten_backend.anki_note import as_note, card_count


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
