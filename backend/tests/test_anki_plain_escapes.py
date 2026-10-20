import pytest

from kasten_backend.anki_html import plain


def test_plain_escapes_markdown_characters_in_text() -> None:
    field = "2*3, snake_case, `x`, [y], a == b, <b>bold</b>"

    assert plain(field) == r"2\*3, snake\_case, \`x\`, \[y], a \=\= b, **bold**"


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        ("# of elements", r"\# of elements"),
        ("?", r"\?"),
        ("!suspended x", r"\!suspended x"),
        ("#pragma #once", r"\#pragma #once"),
        ("on &lt;!--SR:!2026-08-20,4,270--&gt; here", r"on <!--SR\:!2026-08-20,4,270--> here"),
        ("a<br># b<br>?", "a\n\\# b\n\\?"),
    ],
    ids=["heading", "divider", "token", "tags", "schedule", "per-line"],
)
def test_plain_escapes_a_line_that_would_end_a_card(field: str, expected: str) -> None:
    # Kept as text with a backslash rather than dropped: each of these is a line
    # `srs.ts` ends a `?` card on, or counts as a card of its own.
    assert plain(field) == expected


def test_plain_escapes_the_parking_token_anywhere_in_a_line() -> None:
    # `suspended()` in `card-line.ts` reads the token after any space, and
    # would park the card the answer only mentions it in.
    assert plain("type x !suspended there") == r"type x \!suspended there"


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        ("<code>&amp;#58;</code>", "`&#58;`"),
        ("<pre>&amp;#58;</pre>", "`&#58;`"),
    ],
    ids=["code", "pre"],
)
def test_a1_an_entity_colon_in_code_is_written_as_anki_shows_it(field: str, expected: str) -> None:
    # The editor draws a code span verbatim, so a backslash there would show (#343).
    assert plain(field) == expected


def test_i1_a_backslash_before_markup_the_import_writes_is_doubled() -> None:
    assert plain("a\\<b>x</b>") == "a\\\\**x**"


@pytest.mark.parametrize("field", ["<code>a\\-b</code>", "<pre>a\\-b</pre>"], ids=["code", "pre"])
def test_i2_a_backslash_in_code_stays_one(field: str) -> None:
    assert plain(field) == "`a\\-b`"


def test_i4_an_entity_other_than_the_colon_is_written_as_itself() -> None:
    assert plain("&amp;copy; &amp;amp;") == "&copy; &amp;"


def test_a4_an_entity_colon_split_by_a_tag_stays_text() -> None:
    # Anki shows `a&#58;b`, which a card would show as `a:b` (#348).
    assert plain("a&amp;#<b></b>58;b") == "a\\&#58;b"


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        ("a&amp;#<span>58;</span>b", "a\\&#58;b"),
        ("<code>a&amp;#<b></b>58;b</code>", "`a&#58;b`"),
    ],
    ids=["prose", "code"],
)
def test_i5_an_entity_colon_split_by_a_tag_is_escaped_outside_code(
    field: str, expected: str
) -> None:
    assert plain(field) == expected
