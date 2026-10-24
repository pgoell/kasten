"""The one-column rule for the marked blocks of an HTML page (#793 A10, I7).

The rule lives in its own style block, given only to a page that opts in, so
the token file the app shares stays as it is and a page that does not opt in is
served as written.
"""

from pathlib import Path
from typing import TYPE_CHECKING

from kasten_backend.html_page import LINKS_OUT, PAGE_SCRIPT

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
