import pytest

from backend.tests.anki_build import SR1, SR2, basic_deck, mark, marked, unhashed
from kasten_backend.anki_merge import merge

JOINED = "q2\n?\na2\nb2"
"""An imported `?` card's lines, which the tests below set right against the user's."""


def test_684_a1_a_question_card_joined_under_a_users_question_card_is_never_updated() -> None:
    # With the blank line between deleted, `srs.ts` runs `a1`'s back on over
    # this card, so the schedule under it is the user's card's.
    old = f"#flashcards/x\n\nq1\n?\na1\n{JOINED}{marked(1, JOINED)}\n{SR1}\n"

    merged = merge(old, basic_deck(("q2", "a2\nB2")))

    assert merged is not None
    assert (merged.text, merged.kept, merged.updated) == (old, 1, 0)


def test_684_i1_a_question_card_with_the_users_card_glued_under_it_is_never_updated() -> None:
    # `srs.ts` runs this card's back on over the user's `q3`, so the schedule
    # under `a3` is the one card's they make together.
    old = f"#flashcards/x\n\n{JOINED}{marked(1, JOINED)}\nq3\n?\na3\n{SR1}\n"

    merged = merge(old, basic_deck(("q2", "a2\nB2")))

    assert merged is not None
    assert (merged.text, merged.kept, merged.updated) == (old, 1, 0)


@pytest.mark.parametrize(
    ("between", "gap"),
    [("", ""), ("# Mine", "\n"), ("#mine", "\n"), (SR2, "\n"), ("\nSome prose", "\n")],
    ids=["blank", "heading", "tags", "schedule", "prose"],
)
def test_684_i2_a_question_card_apart_from_a_users_question_card_is_updated(
    between: str, gap: str
) -> None:
    # Each of these ends the user's back, so the card is its own and keeps its schedule.
    head = f"#flashcards/x\n\nq1\n?\na1\n{between}\n"
    old = f"{head}{JOINED}{marked(1, JOINED)}\n{SR1}\n"

    merged = merge(old, basic_deck(("q2", "a2\nB2")))

    assert merged is not None
    assert (merged.updated, unhashed(merged.text)) == (
        1,
        f"{head}{gap}q2\n?\na2\nB2{mark(1)}\n{SR1}\n",
    )


def test_684_i3_a_card_added_after_a_joined_question_card_starts_apart() -> None:
    old = f"#flashcards/x\n\nq1\n?\na1\n{JOINED}{marked(1, JOINED)}\n{SR1}\n"

    merged = merge(old, basic_deck(("q2", "a2\nB2"), ("q3", "a3")))

    assert merged is not None
    assert merged.text == f"{old}\nq3::a3{marked(2, 'q3::a3')}\n"


FENCED = "q1\n?\n```c\n#include\n```"
"""A user's `?` card whose answer holds a closed fence with a line of tags in it."""


def test_684_a_card_under_a_fence_in_a_users_question_card_is_never_updated() -> None:
    # `srs.ts` reads a tag line inside a closed fence as ending no card (#675),
    # so `a::b` and the schedule under it are `q1`'s answer.
    old = f"#flashcards/x\n\n{FENCED}\na::b{marked(1, 'a::b')}\n{SR1}\n"

    merged = merge(old, basic_deck(("a", "b\nc")))

    assert merged is not None
    assert (merged.text, merged.kept, merged.updated) == (old, 1, 0)


def test_684_a_question_card_under_a_fence_in_a_users_question_card_is_never_updated() -> None:
    old = f"#flashcards/x\n\n{FENCED}\n{JOINED}{marked(1, JOINED)}\n{SR1}\n"

    merged = merge(old, basic_deck(("q2", "a2\nB2")))

    assert merged is not None
    assert (merged.text, merged.kept, merged.updated) == (old, 1, 0)


def test_683_i8_a_re_import_rewrites_a_front_written_with_a_bare_divider() -> None:
    # Written before #683, the marker's hash still finds the card, so it reads
    # as one Anki changed and carries its schedule.
    old = f"#flashcards/x\n\nx::y\n?\nans{marked(1, 'x::y\n?\nans')}\n{SR1}\n"

    merged = merge(old, basic_deck(("x::y", "ans")))

    assert merged is not None
    assert (merged.text, merged.updated, merged.kept) == (
        f"#flashcards/x\n\nx:&#58;y\n?\nans{marked(1, 'x:&#58;y\n?\nans')}\n{SR1}\n",
        1,
        0,
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
