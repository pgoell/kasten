"""A start tag as the tokenizer reads it: names may start with `=`, values not with quotes (#1672).

Both callers of `_START_TAG` find a tag's end through it, `_last` and `_a_fix`.
"""

import pytest
from justhtml import Element, JustHTML

from kasten_backend import html_closer


@pytest.mark.parametrize(
    "tag",
    [
        pytest.param("<b =x>", id="issue-name-after-space"),
        pytest.param('<b a="x"=y>', id="issue-name-after-double-quote"),
        pytest.param("<b a='x'=y>", id="name-after-single-quote"),
        pytest.param("<b/=x>", id="name-after-slash"),
        pytest.param("<b ==x>", id="name-is-equals"),
        pytest.param("<b =>", id="bare-equals-name"),
        pytest.param('<b =x a="y>z">', id="equals-name-then-quoted-gt"),
    ],
)
def test_1672_a_name_starting_with_equals_matches_to_the_closing_gt(tag: str) -> None:
    found = html_closer._START_TAG.match(tag + "after>")
    assert found is not None
    assert found.group() == tag


@pytest.mark.parametrize(
    "cut",
    [
        pytest.param('<b a="x y>z', id="double-quote"),
        pytest.param("<b a='x y>z", id="single-quote"),
        pytest.param('<b a= "x y>z', id="space-before-quote"),
        pytest.param('<b =x a="x y>z', id="after-an-equals-name"),
    ],
)
def test_1672_an_unquoted_value_never_starts_with_a_quote(cut: str) -> None:
    assert html_closer._START_TAG.match(cut) is None


ORDINARY = [
    pytest.param("<b>", id="bare"),
    pytest.param("<br/>", id="self-closing"),
    pytest.param("<b a>", id="name-only"),
    pytest.param("<b a b>", id="two-names"),
    pytest.param("<b a=x>", id="unquoted"),
    pytest.param('<b a=x"y>', id="unquoted-holding-a-quote"),
    pytest.param("<b a=x=y>", id="unquoted-holding-equals"),
    pytest.param('<b a="x>y">', id="double-quoted-gt"),
    pytest.param("<b a='x>y'>", id="single-quoted-gt"),
    pytest.param("<b a = \"x\" c='y' d=z/>", id="spaced-mixed"),
    pytest.param('<b a"b=c>', id="quote-in-name"),
    pytest.param('<b"=x>', id="quote-in-tag-name"),
    pytest.param('<b a="x"y=z>', id="name-right-after-quote"),
    pytest.param("<b a=>", id="empty-value"),
    pytest.param("<b\ta\n=\fx\r>", id="every-space"),
]


@pytest.mark.parametrize("tag", ORDINARY)
def test_1672_an_ordinary_start_tag_matches_as_before(tag: str) -> None:
    # Guards, green on main: the tags main already read right.
    found = html_closer._START_TAG.match(tag + "after>")
    assert found is not None
    assert found.group() == tag


@pytest.mark.parametrize("tag", ORDINARY)
def test_1672_an_end_tag_matches_as_before(tag: str) -> None:
    # Guards, green on main: the end tag keeps the reading #1670 gave it.
    end = "</" + tag[1:]
    found = html_closer._END_TAG.match(end + "after>")
    assert found is not None
    assert found.group() == end


def test_1672_last_stops_at_the_end_of_a_tag_with_an_equals_name() -> None:
    page = "<p>a</p><b =x>"
    root = JustHTML(page, sanitize=False, track_node_locations=True).root
    b = next(n for n in html_closer._nodes(root) if isinstance(n, Element) and n.name == "b")
    assert html_closer._last(page, b) == len(page)


def test_1672_an_a_fix_blanks_an_outer_a_with_an_equals_name() -> None:
    page = "<a =x><svg><desc><a>y"
    at = page.rindex("<a>")
    blank = "<?" + " " * (len("<a =x>") - 3) + ">"
    assert html_closer._a_fix(page, at) == blank + page[len("<a =x>") :]
