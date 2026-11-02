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
