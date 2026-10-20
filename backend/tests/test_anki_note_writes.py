import pytest

from backend.tests.anki_build import (
    BASIC,
    CARDS,
    CLOZE,
    FURIGANA,
    FURIGANA_TYPE,
    JAPANESE,
    MP3,
    REVERSED,
    SOLO,
    TYPES,
    apkg,
    basic_deck,
    mark,
    marked,
    unhashed,
)
from kasten_backend.anki import read_apkg
from kasten_backend.anki_deck import Card, Deck, Template
from kasten_backend.anki_html import plain
from kasten_backend.anki_note import as_note, card_count


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
        f"#flashcards/x\n\nIs a:&#58;b valid?\n?\n\\?\n\\`\\`\\`js{mark(1)}\n"
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

What does std:&#58;size count?
?
\\# of elements
\\!suspended no <!--anki:4:0:11057b16-->
"""
"""The note `frontend/tests/srs-imported.test.ts` reads back, holding five cards."""


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
    cloze, divided = "{{c1::H}} and {{c2::O}}", "What does std:&#58;move do?\n?\ncasts"
    seine = "{{c1::Seine}} river\n?\nin Paris"
    assert as_note(deck) == (
        f"#flashcards/x\n\nParis::capital{marked(1, 'Paris::capital')}\n"
        f"capital::Paris{marked(1, 'capital::Paris', 1)}\n"
        f"{cloze}{marked(2, cloze)}\n\n{divided}{marked(3, divided)}\n\n"
        f"{seine}{marked(4, seine)}\n"
    )


def test_683_i8_a_question_cards_front_writes_each_divider_as_an_entity() -> None:
    # `srs.ts` ends a front at a line it reads as a card of one line, and
    # `colons` shows `:&#58;` as `::`; a back and a code span keep theirs.
    deck = basic_deck(("x::y", "ans"), ("x::y\nwhat?", "a::b"), ("`a::b` c::d", "e"))
    second, third = "x:&#58;y\nwhat?\n?\na::b", "`a::b` c:&#58;d\n?\ne"

    assert as_note(deck) == (
        f"#flashcards/x\n\nx:&#58;y\n?\nans{marked(1, 'x:&#58;y\n?\nans')}\n\n"
        f"{second}{marked(2, second)}\n\n{third}{marked(3, third)}\n"
    )


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
    # read back as `What does std`. `frontend/tests/srs-imported.test.ts` and
    # `review-decks-import.test.ts` read this exact text back.
    decks = read_apkg(apkg(((1, BASIC, "What does std::move do?\x1fcasts to an rvalue"),)))

    assert unhashed(as_note(decks[0])) == (
        f"#flashcards/French\n\nWhat does std:&#58;move do?\n?\ncasts to an rvalue{mark(1)}\n"
    )


def test_sets_a_question_holding_the_divider_apart_from_its_neighbours() -> None:
    deck = basic_deck(("a", "b"), ("What does std::move do?", "casts std::move"), ("c", "d"))

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\na::b{mark(1)}\n\n"
        f"What does std:&#58;move do?\n?\ncasts std::move{mark(2)}\n\nc::d{mark(3)}\n"
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
    # `frontend/tests/review-decks-import.test.ts` reads the first case's text back.
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
    written = front.replace("::", ":&#58;")

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\n{written}\n?\n{back}{mark(1)}\n"


def test_a_front_ending_in_a_colon_reads_back_whole() -> None:
    # `Ratio 1:::2` would split at its first `::` into `Ratio 1` and `:2`.
    # `divide` in `card-line.ts` trims the space the divider sits behind.
    decks = read_apkg(apkg(((1, BASIC, "Ratio 1:\x1f2"),), CARDS[:1], ((100, "x"),)))

    line = unhashed(as_note(decks[0])).splitlines()[-1].removesuffix(mark(1))
    front, back = line.split("::", 1)

    assert line == "Ratio 1: ::2"
    assert (front.strip(), back.strip()) == ("Ratio 1:", "2")


def test_leaves_out_a_question_holding_the_divider_with_no_answer() -> None:
    deck = basic_deck(("What does std::move do?", ""), ("a", "b"))

    assert unhashed(as_note(deck)) == f"#flashcards/x\n\na::b{mark(2)}\n"


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
