from backend.tests.anki_build import SR1, SR2, basic_deck, mark, marked, unhashed
from kasten_backend.anki_merge import merge


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
