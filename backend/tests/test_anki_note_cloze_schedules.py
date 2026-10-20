from backend.tests.anki_build import CARDS, CLOZE, apkg, cloze_note, mark, unhashed
from kasten_backend.anki import read_apkg
from kasten_backend.anki_note import as_note


def test_a1_a_schedule_comment_in_a_cloze_answer_is_escaped() -> None:
    # `srs.ts` reads a schedule anywhere on a line, so unescaped this text
    # would be c1's schedule (#351).
    deck = cloze_note("{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}", "")

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n{{{{c1::<!--SR\\:c1!2026-01-01,1,250-->}}}}{mark(1)}\n"
    )


def test_a2_a_schedule_comment_in_a_cloze_answer_in_code_is_escaped() -> None:
    deck = cloze_note("<code>{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}</code>", "")

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n{{{{c1::`<!--SR\\:c1!2026-01-01,1,250-->`}}}}{mark(1)}\n"
    )


def test_i1_the_carried_schedule_follows_a_comment_in_the_answer() -> None:
    notes = ((1, CLOZE, "{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}\x1f"),)
    export = apkg(notes, CARDS[:1], ((100, "x"),), reviews=((11, 2, 4, 2500, 10),))

    deck = read_apkg(export, carry=True)[0]

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n{{{{c1::<!--SR\\:c1!2026-01-01,1,250-->}}}}{mark(1)}"
        " <!--SR:c1!2026-01-11,4,250-->\n"
    )


def test_i2_a_schedule_comment_in_a_cloze_hint_is_escaped() -> None:
    deck = cloze_note("{{c1::a::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}", "")

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n{{{{c1::a::<!--SR\\:c1!2026-01-01,1,250-->}}}}{mark(1)}\n"
    )


def test_i3_a_plain_schedule_comment_in_a_cloze_answer_is_escaped() -> None:
    deck = cloze_note("{{c1::&lt;!--SR:!2026-01-01,1,250--&gt;}}", "")

    assert unhashed(as_note(deck)) == (
        f"#flashcards/x\n\n{{{{c1::<!--SR\\:!2026-01-01,1,250-->}}}}{mark(1)}\n"
    )
