import time

from backend.tests.anki_build import basic_deck, mark, unhashed
from kasten_backend.anki_note import as_note


def test_a_side_opening_a_fence_opens_none() -> None:
    # The client finds code with the editor's markdown parser, which reads a
    # line opening with three backticks as a fence, and both readers would
    # skip every card under it.
    deck = basic_deck(("```js x", "code"), ("```a::b", "```c"), ("a", "b"))

    note = as_note(deck)

    assert not any(line.lstrip().startswith("```") for line in note.splitlines())
    assert unhashed(note) == (
        f"#flashcards/x\n\n\\```js x::code{mark(1)}\n\n\\```a:&#58;b\n?\n\\```c{mark(2)}\n\n"
        f"a::b{mark(3)}\n"
    )


def test_674_a1_a_side_opening_with_tildes_opens_no_fence() -> None:
    # The editor's parser reads `~~~` as a fence too, so the card under it
    # would be code and no card.
    deck = basic_deck(("~~~", "b"), ("~~~a::b", "~~~c"), ("a", "b"))

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n\\~~~::b{mark(1)}\n\n\\~~~a:&#58;b\n?\n\\~~~c{mark(2)}\n\na::b{mark(3)}\n"
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


def test_679_i4_a_list_item_or_quote_with_no_fence_stays_unescaped() -> None:
    # A marker with no fence after it, a fence after other text and `-~~~`,
    # which is no list item, open no code block; `- ~~~` beside them does.
    deck = basic_deck(("- a", "b"), ("> b", "c"), ("a ~~~", "d"), ("-~~~", "e"), ("- ~~~", "f"))

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n- a::b{mark(1)}\n> b::c{mark(2)}\na ~~~::d{mark(3)}\n"
        f"-~~~::e{mark(4)}\n- \\~~~::f{mark(5)}\n"
    )
