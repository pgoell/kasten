"""The one-column rule for the marked blocks of an HTML page (#793 A10, I7).

The rule lives in its own style block, given only to a page that opts in, so
the token file the app shares stays as it is and a page that does not opt in is
served as written. A page cut off mid-write gets what closes it before the link script (#886).
"""

from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from kasten_backend.html_page import LINKS_OUT, PAGE_SCRIPT, serve_page

if TYPE_CHECKING:
    from httpx import AsyncClient

DOCTYPE = b"<!doctype html>"
META = b'<meta name="kasten-theme" content="tokens">'
GRID = b'<section class="k-columns"><div>a</div><div>b</div><div>c</div></section>'
OPTED_IN = (
    DOCTYPE
    + b"<html><head>"
    + META
    + b"<title>report</title></head><body>"
    + GRID
    + b"</body></html>"
)
PLAIN = DOCTYPE + b"<html><head><title>report</title></head><body>" + GRID + b"</body></html>"
JUSTHTML_BUG = "justhtml 3.16.0 parts from the spec here (#1652)"
TOKENS = Path(__file__).parents[2] / "src" / "kasten_backend" / "kasten-theme.css"


async def test_793_a10_an_opted_in_page_gets_the_stacking_rule(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "report.html").write_bytes(OPTED_IN)

    response = await client.get(
        "/api/html/report.html", params={"theme": "dark", "palette": "russet"}
    )

    content = response.content
    assert b"<style data-kasten-stack>" in content
    assert content.index(b"<style data-kasten-stack>") < content.index(b"</head>")
    assert b"@media (width < 640px)" in content
    assert b".k-columns" in content
    # The rule is not in the token file the app shares.
    assert b"k-columns" not in TOKENS.read_bytes()


async def test_793_i7_a_page_that_does_not_opt_in_gets_no_stacking_rule(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "report.html").write_bytes(PLAIN)

    response = await client.get(
        "/api/html/report.html", params={"theme": "dark", "palette": "russet"}
    )

    assert response.content == DOCTYPE + PAGE_SCRIPT + PLAIN[len(DOCTYPE) :] + LINKS_OUT


@pytest.mark.parametrize(
    ("end", "closer"),
    [
        (b"<p>done</p>", b""),
        (b"a < b", b""),
        (b"<!-- c -->", b""),
        (b"<script>if (a<b) x()</script>", b""),
        (b'<p title="a>b">', b""),
        ("<p\u00a0class='a'\u3000id=\x0bb>".encode(), b""),
        ("<p\u00a0class='a".encode(), b">"),
        (b"<p class", b">"),
        (b'<p class="a', b'">'),
        (b"<p class='a", b"'>"),
        (b"<!-- note", b"-->"),
        (b"<!-- note --", b"-->"),
        (b"<!-", b">"),
        (b"</", b">"),
        (b"</p", b">"),
        (b"<script>let a = 1", b"</script>"),
        (b"<script>a()</scri", b"</script>"),
        (b"<script>a()</script", b">"),
        (b'<script src="a', b'"></script>'),
        (b"<STYLE>p {", b"</style>"),
        (b"<textarea>draft", b"</textarea>"),
        (b"<title>a <b>", b"</title>"),
    ],
)
def test_886_a_cut_page_gets_what_closes_it_before_the_link_script(
    end: bytes, closer: bytes
) -> None:
    page = DOCTYPE + b"<p>a</p>" + end

    served, _ = serve_page(page, None, None)

    assert served == DOCTYPE + PAGE_SCRIPT + page[len(DOCTYPE) :] + closer + LINKS_OUT


def test_886_a_cut_opted_in_page_keeps_its_theme_and_closes_before_the_link_script() -> None:
    page = OPTED_IN[: OPTED_IN.index(b"<div>")] + b'<div class="a'

    served, _ = serve_page(page, "dark", "russet")

    assert b'<html data-theme="dark" data-palette="russet">' in served
    assert b"<style data-kasten-stack>" in served
    assert served.endswith(b'<div class="a">' + LINKS_OUT)


@pytest.mark.parametrize(
    ("bom", "encoding"), [(b"\xff\xfe", "utf-16-le"), (b"\xfe\xff", "utf-16-be")]
)
def test_886_an_odd_byte_utf16_page_gets_its_zero_byte_then_the_closer(
    bom: bytes, encoding: str
) -> None:
    page = bom + '<!doctype html><p class="a'.encode(encoding) + b"x"

    served, _ = serve_page(page, None, None)

    scripts = (LINKS_OUT + PAGE_SCRIPT).decode("ascii")
    assert served == page + b"\x00" + ('">' + scripts).encode(encoding)


@pytest.mark.parametrize(
    ("end", "closer"),
    [
        (b"<script><!--a", b"</script>"),
        (b"<script><!-->a", b"</script>"),
        (b"<script><!--<script>a", b"--></script>"),
        (b"<script><!--<script>a</scr", b"--></script>"),
        (b"<script><!--<script>a--", b"--></script>"),
        (b"<script><!--<script>a</script>b", b"</script>"),
        (b"<script><!--<script>a</script>b</script>", b""),
        (b"<script><!--<script>a-->b</script>", b""),
        (b"<svg><![CDATA[a", b"]]></svg>"),
        (b"<svg><![CDATA[a > b", b"]]></svg>"),
        (b"<math><![CDATA[a", b"]]></math>"),
        (b"<svg><script><![CDATA[a", b"]]></svg>"),
        (b"<svg><svg><![CDATA[a", b"]]></svg></svg>"),
        pytest.param(
            b"<svg><![cdata[a > b",
            b"</svg>",
            marks=pytest.mark.xfail(strict=True, reason=JUSTHTML_BUG),
        ),
        (b"<svg><![CDATA[a > b]]></svg>", b""),
        (b"<svg/><![CDATA[a > b", b""),
        (b"<![CDATA[a > b", b""),
        (b"</svg><math><mi>x</mi></math>", b""),
    ],
)
def test_1489_a_cut_double_escape_or_cdata_gets_what_closes_it(end: bytes, closer: bytes) -> None:
    page = DOCTYPE + b"<p>a</p>" + end

    served, _ = serve_page(page, None, None)

    assert served == DOCTYPE + PAGE_SCRIPT + page[len(DOCTYPE) :] + closer + LINKS_OUT


@pytest.mark.parametrize(
    "rest", [b"<plaintext>b</p>", b"<PLAINTEXT/>b", b"<plaintext", b'<plaintext a="b']
)
def test_1489_the_link_script_goes_ahead_of_a_plaintext_element(rest: bytes) -> None:
    page = DOCTYPE + b"<p>a</p>" + rest

    served, _ = serve_page(page, None, None)

    assert served == DOCTYPE + PAGE_SCRIPT + b"<p>a</p>" + LINKS_OUT + rest


@pytest.mark.parametrize(
    "end", [b"<!-- <plaintext> -->", b"<script>'<plaintext>'</script>", b"<svg><plaintext></svg>"]
)
def test_1489_a_plaintext_tag_that_switches_nothing_moves_nothing(end: bytes) -> None:
    page = DOCTYPE + end

    served, _ = serve_page(page, None, None)

    assert served == DOCTYPE + PAGE_SCRIPT + end + LINKS_OUT


def test_1489_an_opted_in_page_keeps_its_theme_ahead_of_a_plaintext_element() -> None:
    page = OPTED_IN[: OPTED_IN.index(b"</body>")] + b"<plaintext>b</head>"

    served, _ = serve_page(page, "dark", "russet")

    assert served.count(b"<style data-kasten-stack>") == 1
    assert served.endswith(GRID + LINKS_OUT + b"<plaintext>b</head>")


@pytest.mark.parametrize(
    ("bom", "encoding"), [(b"\xff\xfe", "utf-16-le"), (b"\xfe\xff", "utf-16-be")]
)
def test_1489_a_utf16_page_gets_both_scripts_ahead_of_a_plaintext_element(
    bom: bytes, encoding: str
) -> None:
    # An astral character and a lone surrogate, so the byte offset cannot be counted in chars.
    lone = b"\x00\xd8" if encoding == "utf-16-le" else b"\xd8\x00"
    head = bom + "<!doctype html><p>\U0001f600</p>".encode(encoding) + lone
    page = head + "<plaintext>b".encode(encoding)

    served, _ = serve_page(page, None, None)

    scripts = (LINKS_OUT + PAGE_SCRIPT).decode("ascii")
    assert served == head + scripts.encode(encoding) + "<plaintext>b".encode(encoding)


SCRIPT = b'<script>s = "<!--";</script>'


@pytest.mark.parametrize(
    ("end", "closer"),
    [
        (b"<svg><foreignObject>" + SCRIPT + b"</foreignObject></svg>", b""),
        (b"<svg><desc>" + SCRIPT + b"</desc></svg>", b""),
        (b"<svg><title>" + SCRIPT + b"</title></svg>", b""),
        (b"<math><mi>" + SCRIPT + b"</mi></math>", b""),
        (b"<math><mtext>" + SCRIPT + b"</mtext></math>", b""),
        (
            b'<math><annotation-xml encoding="TEXT/HTML">' + SCRIPT + b"</annotation-xml>",
            b"</math>",
        ),
        (b"<math><mi><script><!--a", b"</script></math>"),
        (b"<math><mi><mglyph><script><!--a", b"--></math>"),
        (b"<svg><p><script><!--a", b"</script>"),
        (b"<svg><g><div><![CDATA[a", b">"),
        (b"<svg><font color=red><![CDATA[a", b">"),
        (b"<svg><font><![CDATA[a", b"]]></svg>"),
        (b"<svg></p><![CDATA[a", b">"),
        (b"<svg><foreignObject><p><svg><![CDATA[a", b"]]></svg></svg>"),
        (b"<svg><foreignObject><div>x</div></foreignObject><p><![CDATA[a", b">"),
        (b"<svg><svg></svg><![CDATA[a", b"]]></svg>"),
        (b"<svg width=10/><![CDATA[x", b"]]></svg>"),
        (b"<svg b=/><![CDATA[x", b"]]></svg>"),
        (b'<svg width="10"/><![CDATA[x', b">"),
        (b"<svg width=10 /><![CDATA[x", b">"),
        (b"<svg//><![CDATA[x", b">"),
    ],
)
def test_1559_the_closer_reads_svg_and_math_by_the_spec(end: bytes, closer: bytes) -> None:
    page = DOCTYPE + b"<p>a</p>" + end

    served, _ = serve_page(page, None, None)

    assert served == DOCTYPE + PAGE_SCRIPT + page[len(DOCTYPE) :] + closer + LINKS_OUT


def test_1559_a_plaintext_in_foreign_object_takes_the_link_script_ahead_of_it() -> None:
    page = DOCTYPE + b"<svg><foreignObject><plaintext>b</svg>"

    served, _ = serve_page(page, None, None)

    head = DOCTYPE + PAGE_SCRIPT + b"<svg><foreignObject>"
    assert served == head + LINKS_OUT + b"<plaintext>b</svg>"


@pytest.mark.parametrize(
    ("end", "closer"),
    [
        pytest.param(
            b"<svg><foreignObject><div>a</foreignObject></svg><svg><![CDATA[x",
            b"]]></svg></svg>",
            id="unclosed-div-keeps-svg-open",
        ),
        pytest.param(b"<svg><foreignObject><p><![CDATA[x", b"></svg>", id="cdata-in-html"),
        pytest.param(
            b"<svg><foreignObject><div></foreignObject></svg></div><![CDATA[x",
            b"]]></svg>",
            id="div-end-hands-the-point-back",
        ),
        pytest.param(
            b"<svg><foreignObject><p><svg></svg><![CDATA[x", b"></svg>", id="svg-in-html-closed"
        ),
        pytest.param(b"<svg><foreignObject><br><![CDATA[x", b"]]></svg>", id="void-opens-nothing"),
        pytest.param(
            b"<svg><foreignObject><p><svg><g></p><![CDATA[x", b"]]></svg>", id="p-end-breaks-out"
        ),
        pytest.param(
            b"<svg><foreignObject><p><div></div></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="div-closes-p",
        ),
        pytest.param(
            b"<svg><foreignObject><li><li></li></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="li-closes-li",
        ),
        pytest.param(
            b"<svg><foreignObject><li><ul><li></li></ul></foreignObject><![CDATA[x",
            b"></svg>",
            id="ul-hides-the-outer-li",
        ),
        pytest.param(
            b"<svg><foreignObject><h1><h2></h2></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="h2-closes-h1",
        ),
        pytest.param(
            b"<svg><foreignObject><span><div></span></div></foreignObject></svg><svg><![CDATA[x",
            b"]]></svg></svg>",
            id="span-end-stops-at-div",
        ),
        pytest.param(
            b"<svg><foreignObject><li><section><li></li></section></foreignObject></svg>"
            b"<svg><![CDATA[x",
            b"]]></svg></svg>",
            id="section-hides-the-outer-li",
        ),
        pytest.param(
            b"<svg><foreignObject><dd><section><dd></dd></section></foreignObject></svg>"
            b"<svg><![CDATA[x",
            b"]]></svg></svg>",
            id="section-hides-the-outer-dd",
        ),
        pytest.param(
            b"<svg><foreignObject><div><ul></div></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="div-end-closes-through-ul",
        ),
        pytest.param(
            b"<svg><foreignObject><p><button><div></div></button><![CDATA[x",
            b"></svg>",
            id="button-hides-the-p",
        ),
        pytest.param(
            b"<svg><foreignObject><li><ul></li></foreignObject></svg><svg><![CDATA[x",
            b"]]></svg></svg>",
            id="ul-hides-the-li-from-its-end",
        ),
        pytest.param(
            b"<svg><foreignObject><h1></h2><![CDATA[x", b"]]></svg>", id="h2-end-closes-h1"
        ),
    ],
)
def test_1560_the_closer_tracks_html_opened_inside_a_point(end: bytes, closer: bytes) -> None:
    page = DOCTYPE + b"<p>a</p>" + end

    served, _ = serve_page(page, None, None)

    assert served == DOCTYPE + PAGE_SCRIPT + page[len(DOCTYPE) :] + closer + LINKS_OUT


@pytest.mark.parametrize(
    ("end", "closer"),
    [
        pytest.param(
            b"<svg><foreignObject><option><option></option></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="option-pops-option",
        ),
        pytest.param(
            b"<svg><foreignObject><option><optgroup></optgroup></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="optgroup-pops-option",
        ),
        pytest.param(
            b"<svg><foreignObject><optgroup><optgroup></optgroup></foreignObject><![CDATA[x",
            b"></svg>",
            id="optgroup-keeps-optgroup",
        ),
        pytest.param(
            b"<svg><foreignObject><button><button></button></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="button-closes-button",
        ),
        pytest.param(
            b"<svg><foreignObject><button><object><button></button></object></button>"
            b"</foreignObject><![CDATA[x",
            b"]]></svg>",
            id="object-hides-the-outer-button",
        ),
        *(
            pytest.param(
                b"<svg><foreignObject><" + name + b"><![CDATA[x",
                b"]]></svg>",
                id=f"void-{name.decode()}",
                marks=[pytest.mark.xfail(strict=True, reason=JUSTHTML_BUG)]
                if name == b"image"
                else [],
            )
            for name in (b"param", b"keygen", b"basefont", b"bgsound", b"frame", b"image")
        ),
        pytest.param(
            b"<svg><foreignObject><a><a></a></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="a-closes-a",
        ),
        pytest.param(
            b"<svg><foreignObject><nobr><nobr></nobr></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="nobr-closes-nobr",
        ),
        pytest.param(
            b"<svg><foreignObject><a><div><a></a></div></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="a-past-div-leaves-the-div",
        ),
        pytest.param(
            b"<svg><foreignObject><a><b><a></a></foreignObject><![CDATA[x",
            b"></svg>",
            id="a-reopens-b",
        ),
        pytest.param(
            b"<svg><foreignObject><a><span><a></a></span></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="a-closes-span",
        ),
        pytest.param(
            b"<svg><foreignObject><a><span><div><a></a></div></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="a-past-div-closes-the-span-below-it",
        ),
        pytest.param(
            b"<svg><foreignObject><a><div><span><p><a></a></p></div></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="a-past-div-closes-the-span-between-blocks",
        ),
        pytest.param(
            b"<svg><foreignObject><nobr><span><div><nobr></nobr></div></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="nobr-past-div-closes-the-span-below-it",
        ),
        pytest.param(
            b"<svg><foreignObject><a><svg><foreignObject><a></a></foreignObject></svg>"
            b"</foreignObject><![CDATA[x",
            b"]]></svg>",
            id="a-behind-a-point-goes",
            marks=pytest.mark.xfail(strict=True, reason=JUSTHTML_BUG),
        ),
        pytest.param(
            b"<svg><foreignObject><a><object><a></a></object></foreignObject><![CDATA[x",
            b"></svg>",
            id="object-marker-keeps-the-outer-a",
        ),
        pytest.param(
            b"<svg><foreignObject><a><b><i><u><s><div><a></a></div></s></u></i>"
            b"</foreignObject><![CDATA[x",
            b"]]></svg>",
            id="a-past-div-drops-the-fourth-formatting-up",
        ),
        pytest.param(
            b"<svg><foreignObject><a><b><span><span><span><div><a></a></div></foreignObject>"
            b"<![CDATA[x",
            b"]]></svg>",
            id="a-past-div-counts-every-element-up",
        ),
        pytest.param(
            b"<svg><foreignObject><a><i><u><s><div><a></a></div></s></u></i>"
            b"</foreignObject><![CDATA[x",
            b"]]></svg>",
            id="a-past-div-keeps-three-formatting",
        ),
        pytest.param(
            b"<svg><foreignObject><form><div></form></foreignObject></svg><svg><![CDATA[x",
            b"]]></svg></svg>",
            id="form-end-leaves-the-div",
        ),
        pytest.param(
            b"<svg><foreignObject><form><p></form></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="form-end-pops-p",
        ),
        pytest.param(
            b"<svg><foreignObject><form><form></form></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="form-in-form-ignored",
        ),
    ],
)
def test_1575_the_closer_follows_the_in_body_rules_inside_a_point(
    end: bytes, closer: bytes
) -> None:
    page = DOCTYPE + b"<p>a</p>" + end

    served, _ = serve_page(page, None, None)

    assert served == DOCTYPE + PAGE_SCRIPT + page[len(DOCTYPE) :] + closer + LINKS_OUT
