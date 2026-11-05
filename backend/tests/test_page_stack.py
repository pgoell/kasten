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
TOKENS = Path(__file__).parents[1] / "src" / "kasten_backend" / "kasten-theme.css"


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
        (b"<svg><![cdata[a > b", b"</svg>"),
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
