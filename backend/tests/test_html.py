from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from httpx import AsyncClient

DOCTYPE = b"<!doctype html>"
PAGE = DOCTYPE + b"<title>report</title><p>findings</p>"
SCRIPT = (Path(__file__).parents[1] / "src" / "kasten_backend" / "page_script.js").read_bytes()
BLOCK = b"\n<script>\n" + SCRIPT + b"\n</script>\n"
META = b'<meta name="kasten-theme" content="tokens">'
OPTED_IN = DOCTYPE + b"<html><head>" + META + b"<title>report</title></head><body>findings</body>"
WITH_HEAD = DOCTYPE + b"<html><head><title>report</title></head><body><p>findings</p></body></html>"
BOM = b"\xef\xbb\xbf"
FRONTEND_THEME = Path(__file__).parents[2] / "frontend" / "src" / "styles" / "kasten-theme.css"
# The link script as `html_page` appends it, written out so a test can say what
# the answer ends with. A change to the link script is a change here too.
LINKS_OUT = b"""
<script>
document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (link !== null && link.host !== location.host) link.target = "_blank";
}, true);
</script>
"""


async def test_lists_the_html_in_the_vault(client: AsyncClient, vault: Path) -> None:
    (vault / "research").mkdir()
    (vault / "research" / "report.html").write_bytes(PAGE)
    (vault / "research" / "report.md").write_text("# report")
    (vault / ".hidden.html").write_bytes(PAGE)

    response = await client.get("/api/html")

    assert response.status_code == 200
    assert response.json() == ["research/report.html"]


async def test_lists_and_reads_a_page_whose_suffix_is_upper_case(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "REPORT.HTML").write_bytes(PAGE)

    assert (await client.get("/api/html")).json() == ["REPORT.HTML"]
    response = await client.get("/api/html/REPORT.HTML")
    assert response.status_code == 200
    assert response.content.startswith(DOCTYPE)


async def test_reads_a_page_with_the_doctype_first(client: AsyncClient, vault: Path) -> None:
    (vault / "report.html").write_bytes(PAGE)

    response = await client.get("/api/html/report.html")

    # The page script goes right after the doctype, so the doctype stays the
    # first thing the parser sees and the page keeps its standards mode.
    assert response.status_code == 200
    assert response.content.startswith(DOCTYPE + BLOCK + b"<title>")
    assert response.headers["content-type"].startswith("text/html")


async def test_starts_a_page_with_no_body_tag_with_the_kasten_script(
    client: AsyncClient, vault: Path
) -> None:
    # PAGE has no `<body>`, and the script still goes first, ahead of the page's
    # own elements, so it runs before any page code (#785).
    (vault / "report.html").write_bytes(PAGE)

    response = await client.get("/api/html/report.html")

    assert response.content.startswith(DOCTYPE + BLOCK + b"<title>report</title>")


async def test_starts_a_page_with_a_body_with_the_kasten_script(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "report.html").write_bytes(b"<!doctype html><body><p>findings</p></body>")

    response = await client.get("/api/html/report.html")

    assert response.content.startswith(DOCTYPE + BLOCK + b"<body>")


async def test_holds_a_page_in_a_sandbox_of_its_own(client: AsyncClient, vault: Path) -> None:
    (vault / "report.html").write_bytes(PAGE)

    response = await client.get("/api/html/report.html")

    policy = response.headers["content-security-policy"]
    assert "sandbox allow-scripts" in policy
    assert "allow-same-origin" not in policy
    assert "connect-src 'none'" in policy


async def test_reports_a_page_that_is_not_there(client: AsyncClient, vault: Path) -> None:
    response = await client.get("/api/html/missing.html")

    assert response.status_code == 404


async def test_refuses_a_path_that_is_not_a_page(client: AsyncClient, vault: Path) -> None:
    # The route reads `.html` and nothing else, so it is no second way to a note
    # or to a file outside the vault.
    (vault / "note.md").write_text("# note")

    assert (await client.get("/api/html/note.md")).status_code == 404
    assert (await client.get("/api/html/../etc/passwd.html")).status_code == 404


async def test_refuses_a_directory_named_like_a_page(client: AsyncClient, vault: Path) -> None:
    (vault / "site.html").mkdir()

    response = await client.get("/api/html/site.html")

    assert response.status_code == 404


async def test_puts_the_theme_into_a_page_that_opts_in(client: AsyncClient, vault: Path) -> None:
    (vault / "report.html").write_bytes(OPTED_IN)

    response = await client.get(
        "/api/html/report.html", params={"theme": "dark", "palette": "russet"}
    )

    content = response.content
    assert content.startswith(DOCTYPE + b'<html data-theme="dark" data-palette="russet">' + BLOCK)
    # The html element is set ahead of the script, so the page's own `<html>` only adds to it.
    head_end = content.index(b"</head>")
    fonts_at = content.index(b"<style data-kasten-fonts>")
    theme_at = content.index(b"<style data-kasten-theme>")
    assert fonts_at < theme_at < head_end
    assert content[fonts_at:head_end].endswith(b"</style>")
    assert content[fonts_at:theme_at].count(b"@font-face") == 4
    theme = content[theme_at:head_end]
    assert b"--k-bg: #141414" in theme
    assert b"@layer" not in theme


async def test_puts_the_styles_after_the_meta_of_a_page_with_no_head_tag(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "report.html").write_bytes(DOCTYPE + META + b"<p>findings</p>")

    response = await client.get(
        "/api/html/report.html", params={"theme": "light", "palette": "poel"}
    )

    assert response.content.startswith(
        DOCTYPE
        + b'<html data-theme="light" data-palette="poel">'
        + BLOCK
        + META
        + b"<style data-kasten-fonts>"
    )
    assert b"</style><style data-kasten-theme>" in response.content
    assert b"--k-bg: #f6f6f4" in response.content


@pytest.mark.parametrize(
    ("page", "at"),
    [
        (WITH_HEAD, len(DOCTYPE)),
        (PAGE, len(DOCTYPE)),
        (DOCTYPE + b"\xff\xfe caf\xe9", len(DOCTYPE)),
    ],
    ids=["doctype and a head", "no head tag", "not utf-8"],
)
async def test_serves_a_page_without_the_meta_as_it_was(
    client: AsyncClient, vault: Path, page: bytes, at: int
) -> None:
    (vault / "report.html").write_bytes(page)

    response = await client.get(
        "/api/html/report.html", params={"theme": "dark", "palette": "poel"}
    )

    assert response.content == page[:at] + BLOCK + page[at:] + LINKS_OUT
    assert response.content.replace(BLOCK, b"", 1) == page + LINKS_OUT


async def test_a_meta_in_a_comment_or_a_script_does_not_opt_a_page_in(
    client: AsyncClient, vault: Path
) -> None:
    page = DOCTYPE + b"<!-- " + META + b" --><script>var note = '" + META + b"';</script><p>x</p>"
    (vault / "report.html").write_bytes(page)

    response = await client.get(
        "/api/html/report.html", params={"theme": "dark", "palette": "russet"}
    )

    assert response.content == DOCTYPE + BLOCK + page[len(DOCTYPE) :] + LINKS_OUT


@pytest.mark.parametrize(
    "query",
    [{"theme": "sepia", "palette": "russet"}, {"theme": "dark", "palette": "x"}, {}],
    ids=["unknown theme", "unknown palette", "neither"],
)
async def test_an_unknown_theme_or_palette_injects_nothing(
    client: AsyncClient, vault: Path, query: dict[str, str]
) -> None:
    (vault / "report.html").write_bytes(OPTED_IN)

    response = await client.get("/api/html/report.html", params=query)

    assert response.content == DOCTYPE + BLOCK + OPTED_IN[len(DOCTYPE) :] + LINKS_OUT


async def test_puts_the_script_at_byte_zero_of_a_page_with_no_doctype(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "report.html").write_bytes(b"<p>findings</p>")

    response = await client.get("/api/html/report.html")

    assert response.content.startswith(BLOCK + b"<p>findings</p>")


async def test_keeps_a_byte_order_mark_first_with_the_script_after_the_doctype(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "report.html").write_bytes(BOM + PAGE)

    response = await client.get("/api/html/report.html")

    assert response.content.startswith(BOM + DOCTYPE + BLOCK)


async def test_serves_the_theme_stylesheet_the_frontend_reads(client: AsyncClient) -> None:
    response = await client.get("/api/kasten-theme.css")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/css")
    assert response.content == FRONTEND_THEME.read_bytes()
