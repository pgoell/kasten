import subprocess
import sys

import pytest

from kasten_backend.anki_html import _MARK, plain


def test_plain_keeps_a_cloze_mark_only_for_a_cloze_note() -> None:
    # Anki shows the marks of a note that is not a cloze type as typed, and a
    # mark kept there would make kasten ask a card Anki never did.
    assert plain("{{c1::Paris}} is the capital") == "==Paris== is the capital"
    assert plain("{{c1::Paris}} is the capital", cloze=True) == "{{c1::Paris}} is the capital"


def test_plain_keeps_a_cloze_hint_for_a_cloze_note() -> None:
    field = "{{c1::Paris::a city}} is in {{c2::<b>France</b>}}"

    assert plain(field) == "==Paris== is in ==France=="
    assert plain(field, cloze=True) == "{{c1::Paris::a city}} is in {{c2::France}}"


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        (r"{{c1::\(x^{2}\)}} is the square", r"==\\(x^{2}\\)== is the square"),
        ("{{c1::}} x", "==== x"),
        (r"{{c1::\(x^{2}\)}} is {{c2::the square}}", r"==\\(x^{2}\\)== is {{c2::the square}}"),
    ],
    ids=["brace", "empty", "mixed"],
)
def test_plain_highlights_a_cloze_mark_kasten_cannot_read(field: str, expected: str) -> None:
    # `MARK` in `card-line.ts` takes no brace and no empty text, and a mark it
    # does not read would leave its `::` to split the line.
    assert plain(field, cloze=True) == expected


@pytest.mark.parametrize(
    ("cloze", "expected"),
    [(True, r"x {{c1::a \!suspended b}} y"), (False, r"x ==a \!suspended b== y")],
    ids=["cloze", "highlight"],
)
def test_plain_escapes_the_parking_token_inside_a_cloze_mark(cloze: bool, expected: str) -> None:
    # A mark skips the parse, and its text would park the line all the same.
    assert plain("x {{c1::a !suspended b}} y", cloze=cloze) == expected


def test_a_cloze_mark_keeps_ruby_with_attributes_as_bare_tags() -> None:
    field = '{{c1::<ruby class="x">漢字<rt class="y">かんじ</rt></ruby>}}'

    assert plain(field, cloze=True) == "{{c1::<ruby>漢字<rt>かんじ</rt></ruby>}}"


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        ("{{c1::a {{c2::b}}}}", "==a b=="),
        ("{{c1::a {{c2::}}}}", "==a=="),
        ("{{c1::a\nb}}", "==a b=="),
    ],
    ids=["nested", "empty", "newline"],
)
def test_i3_a_nested_mark_outside_a_cloze_is_one_highlight(field: str, expected: str) -> None:
    assert plain(field) == expected


@pytest.mark.parametrize(
    ("text", "answer", "hint"),
    [
        ("{{c1::`a::b`}}", "`a::b`", None),
        ("{{c1::`a::b`::h}}", "`a::b`", "h"),
        ("{{c1::a`b}}", "a`b", None),
        ("{{c1::a`b::h}}", "a`b", "h"),
    ],
    ids=["span", "hint", "lone", "lone-hint"],
)
def test_i1_a_code_span_in_a_mark_is_read_whole(text: str, answer: str, hint: str | None) -> None:
    found = _MARK.fullmatch(text)

    assert found is not None
    assert (found[2], found[5]) == (answer, hint)


def test_b1_a_line_of_code_spans_after_an_open_mark_reads_in_linear_time() -> None:
    # A child process, since `re` cannot be stopped from inside: a regex that
    # backtracks doubles its time with every span here and runs for minutes.
    code = "from kasten_backend.anki_html import _MARK; _MARK.search('Use {{c1:: ' + '`x` ' * 30)"

    subprocess.run([sys.executable, "-c", code], check=True, timeout=5)  # noqa: S603


def test_i4_a_schedule_comment_in_a_highlight_is_escaped() -> None:
    field = "{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}"

    assert plain(field) == r"==<!--SR\:c1!2026-01-01,1,250-->=="


def test_b1_a_schedule_comment_beside_an_encoded_colon_is_written_as_main_wrote_it() -> None:
    # The `&#58;` already keeps the comment from reading as a schedule; a
    # backslash before it would show the text `&#58;`.
    field = "{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt; a&#58;&#58;b}}"

    assert plain(field, cloze=True) == "{{c1::<!--SR&#58;c1!2026-01-01,1,250--> a&#58;&#58;b}}"


def test_a13_the_marker_beside_an_encoded_colon_is_written_as_anki_shows_it() -> None:
    # A backslash before the marker's `&#58;` would show the text `&#58;`.
    field = "{{c1::&lt;!--anki:7:0--&gt; a&#58;&#58;b}}"

    assert plain(field, cloze=True) == "{{c1::<!--anki&#58;7&#58;0--> a&#58;&#58;b}}"
