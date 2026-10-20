from backend.tests.anki_build import cloze_note, mark, marked, unhashed
from kasten_backend.anki_merge import merge

COMMENT_FIELD = "{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}"
"""A cloze field whose answer is a schedule comment, as #356's first case has it."""


def rated_old_line() -> str:
    """The note 0.49.2 wrote for `COMMENT_FIELD`, after review rated c1 inside the answer."""
    line = "{{c1::<!--SR:c1!2026-01-01,1,250-->}}"
    rated = "{{c1::<!--SR:c1!2026-10-20,3,250-->}}"
    return f"#flashcards/x\n\n{rated}{marked(1, line)}\n"


def test_i6_a_re_import_rewrites_a_line_main_wrote_with_an_entity_brace() -> None:
    # The line before #333's fix, its hash as the import wrote it then.
    line = "{{c1::a { {{c2::b}}}}"
    schedule = "<!--SR:c2!2026-10-20,3,250-->"
    old = f"#flashcards/x\n\n{line}{marked(1, line)} {schedule}\n"

    merged = merge(old, cloze_note("{{c1::a &#123; {{c2::b}}}}", ""))

    assert merged is not None
    expected = f"#flashcards/x\n\n==a {{ {{{{c2::b}}}}=={mark(1)} {schedule}\n"
    assert unhashed(merged.text) == expected
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 1, 0, 0)


def test_i7_a_re_import_rewrites_a_line_main_wrote_with_an_entity_colon() -> None:
    # The line before #335's fix, its hash as the import wrote it then.
    line = "{{c1::a::b}}"
    schedule = "<!--SR:c1!2026-10-20,3,250-->"
    old = f"#flashcards/x\n\n{line}{marked(1, line)} {schedule}\n"

    merged = merge(old, cloze_note("{{c1::a&#58;&#58;b}}", ""))

    assert merged is not None
    expected = f"#flashcards/x\n\n{{{{c1::a&#58;&#58;b}}}}{mark(1)} {schedule}\n"
    assert unhashed(merged.text) == expected
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 1, 0, 0)


def test_i6_a_re_import_rewrites_a_line_main_wrote_with_a_literal_entity_colon() -> None:
    # The line before #340's fix, its hash as the import wrote it then.
    line = "{{c1::a&#58;b}}"
    schedule = "<!--SR:c1!2026-10-20,3,250-->"
    old = f"#flashcards/x\n\n{line}{marked(1, line)} {schedule}\n"

    merged = merge(old, cloze_note("{{c1::a&amp;#58;b}}", ""))

    assert merged is not None
    expected = f"#flashcards/x\n\n{{{{c1::a\\&#58;b}}}}{mark(1)} {schedule}\n"
    assert unhashed(merged.text) == expected
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 1, 0, 0)


def test_i5_a_re_import_rewrites_a_line_main_wrote_with_a_backslash() -> None:
    # The line before #342's fix, its hash as the import wrote it then.
    line = "{{c1::a\\&#58;&#58;b}}"
    schedule = "<!--SR:c1!2026-10-20,3,250-->"
    old = f"#flashcards/x\n\n{line}{marked(1, line)} {schedule}\n"

    merged = merge(old, cloze_note("{{c1::a\\&#58;&#58;b}}", ""))

    assert merged is not None
    expected = f"#flashcards/x\n\n{{{{c1::a\\\\&#58;&#58;b}}}}{mark(1)} {schedule}\n"
    assert unhashed(merged.text) == expected
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 1, 0, 0)


def test_i3_a_re_import_rewrites_a_line_main_wrote_with_a_mark_in_code() -> None:
    # The line 0.49.x wrote, its hash as the import wrote it then; no cloze to
    # kasten now, but its marker still finds it.
    line = "`{{c1::a&#58;&#58;b}}`"
    schedule = "<!--SR:c1!2026-10-20,3,250-->"
    old = f"#flashcards/x\n\n{line}{marked(1, line)} {schedule}\n"

    merged = merge(old, cloze_note("<code>{{c1::a&#58;&#58;b}}</code>", ""))

    assert merged is not None
    expected = f"#flashcards/x\n\n{{{{c1::`a::b`}}}}{mark(1)} {schedule}\n"
    assert unhashed(merged.text) == expected
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 1, 0, 0)


def test_i5_a_re_import_rewrites_a_line_main_wrote_with_a_comment_in_the_answer() -> None:
    # The line 0.49.2 wrote, its hash as the import wrote it then, and the
    # real schedule after the marker, where a rating puts it.
    line = "{{c1::<!--SR:c1!2026-01-01,1,250-->}}"
    schedule = "<!--SR:c1!2026-10-20,3,250-->"
    old = f"#flashcards/x\n\n{line}{marked(1, line)} {schedule}\n"

    merged = merge(old, cloze_note("{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}", ""))

    assert merged is not None
    expected = f"#flashcards/x\n\n{{{{c1::<!--SR\\:c1!2026-01-01,1,250-->}}}}{mark(1)} {schedule}\n"
    assert unhashed(merged.text) == expected
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 1, 0, 0)


def test_a12_a_re_import_rewrites_a_line_main_wrote_and_review_rated_in_the_answer() -> None:
    merged = merge(rated_old_line(), cloze_note(COMMENT_FIELD, ""))

    assert merged is not None
    assert unhashed(merged.text) == (
        f"#flashcards/x\n\n{{{{c1::<!--SR\\:c1!2026-01-01,1,250-->}}}}{mark(1)}"
        " <!--SR:c1!2026-10-20,3,250-->\n"
    )
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 1, 0, 0)


def test_i8_a_second_re_import_of_the_rated_line_changes_nothing() -> None:
    deck = cloze_note(COMMENT_FIELD, "")
    first = merge(rated_old_line(), deck)
    assert first is not None
    assert first.updated == 1

    again = merge(first.text, deck)

    assert again is not None
    assert again.text == first.text
    assert (again.added, again.updated, again.kept, again.removed) == (0, 0, 1, 0)


def test_i8_a_rated_line_edited_beside_the_comment_is_kept() -> None:
    # More than a schedule changed, so the edit is the user's.
    old = rated_old_line().replace("}}", " mine}}")

    merged = merge(old, cloze_note(COMMENT_FIELD, ""))

    assert merged is not None
    assert merged.text == old
    assert (merged.added, merged.updated, merged.kept, merged.removed) == (0, 0, 1, 0)
