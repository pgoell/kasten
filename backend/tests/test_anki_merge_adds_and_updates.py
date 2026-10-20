from backend.tests.anki_build import SR1, SR2, SR3, basic_deck, mark, marked, unhashed
from kasten_backend.anki_deck import Card, Deck, Template
from kasten_backend.anki_merge import _replaced, _Span, merge
from kasten_backend.anki_note import as_note

CLOZED = "<!--SR:c1!2026-10-24,4,250--> <!--SR:c2!2026-10-25,5,250-->"

ANSWERED_NOTE = f"""---
id: 1
modified: 2026-10-01T00:00:00+00:00
---
#flashcards/x

a::b{marked(1, "a::b")} !suspended {SR1}
c::d{marked(2, "c::d")} {SR2}
{{{{c1::H}}}} and {{{{c2::O}}}}{marked(3, "{{c1::H}} and {{c2::O}}")} {CLOZED}

What is a:&#58;b?
?
e{marked(4, "What is a:&#58;b?\n?\ne")}
!suspended {SR3}

What is c:&#58;d?
?
f{marked(5, "What is c:&#58;d?\n?\nf")}
{SR1}

What is e:&#58;f?
?
g{marked(6, "What is e:&#58;f?\n?\ng")}
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


def test_a_re_import_adds_the_cards_that_are_new() -> None:
    old = as_note(basic_deck(("a", "b")))

    merged = merge(old, basic_deck(("a", "b"), ("c", "d"), ("What is a::b?", "e")))

    assert merged is not None
    assert merged.text == (
        f"#flashcards/x\n\na::b{marked(1, 'a::b')}\nc::d{marked(2, 'c::d')}\n\n"
        f"What is a:&#58;b?\n?\ne{marked(3, 'What is a:&#58;b?\n?\ne')}\n"
    )
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (2, 0, 1, 0)


def test_a_re_import_updates_the_text_of_cards_anki_changed() -> None:
    old = as_note(basic_deck(("a", "b"), ("What is a::b?", "e"), ("c", "d")))

    merged = merge(old, basic_deck(("a", "B"), ("What is a::b?", "e\nf"), ("c", "d")))

    assert merged is not None
    assert unhashed(merged.text) == (
        f"#flashcards/x\n\na::B{mark(1)}\n\nWhat is a:&#58;b?\n?\ne\nf{mark(2)}\n\nc::d{mark(3)}\n"
    )
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 2, 1, 0)


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
