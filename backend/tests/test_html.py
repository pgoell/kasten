from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from kasten_backend.html_page import LINKS_OUT as PAGE_LINKS_OUT
from kasten_backend.html_page import PAGE_SCRIPT, STYLES
from kasten_backend.routes.listing import HTML_POLICY

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
  // A link to another page of the vault would load it with no query and so with
  // no theme, so it keeps the frame's query, which holds only theme and palette.
  else if (link !== null && link.pathname.startsWith("/api/html/") && link.search === "")
    link.search = location.search;
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


async def test_puts_the_script_after_a_doctype_that_follows_an_xml_declaration(
    client: AsyncClient, vault: Path
) -> None:
    # A processing instruction is a comment to a browser, so the doctype is still the
    # first token of the page proper and the page keeps its standards mode.
    prolog = (
        b'<?xml version="1.0" encoding="utf-8"?>\n'
        b'<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" '
        b'"http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">'
    )
    page = prolog + b"\n<html><head><title>x</title></head><body>x</body></html>"
    (vault / "report.html").write_bytes(page)

    response = await client.get("/api/html/report.html")

    assert response.content == prolog + BLOCK + page[len(prolog) :] + LINKS_OUT


async def test_serves_a_doctype_cut_off_before_its_end_as_it_was(
    client: AsyncClient, vault: Path
) -> None:
    # A page read while it is still being written can end inside its doctype.
    (vault / "report.html").write_bytes(b"<!DOCTYPE html")

    response = await client.get("/api/html/report.html")

    assert response.status_code == 200
    assert response.content == BLOCK + b"<!DOCTYPE html" + LINKS_OUT


@pytest.mark.parametrize(
    ("bom", "encoding"),
    [(b"\xff\xfe", "utf-16-le"), (b"\xfe\xff", "utf-16-be")],
    ids=["utf-16 little endian", "utf-16 big endian"],
)
async def test_serves_a_utf16_page_with_its_byte_order_mark_first(
    client: AsyncClient, vault: Path, bom: bytes, encoding: str
) -> None:
    # Nothing goes in front of a UTF-16 page, since that would break its bytes. The
    # scripts go at the end in the page's own byte order, so a browser reads them
    # as text, and the page gets no theme.
    page = bom + "<!doctype html><p>findings</p>".encode(encoding)
    (vault / "report.html").write_bytes(page)

    response = await client.get(
        "/api/html/report.html", params={"theme": "dark", "palette": "poel"}
    )

    assert response.headers["content-type"] == "text/html; charset=utf-8"
    assert response.headers["content-security-policy"] == HTML_POLICY
    text = response.content[2:].decode(encoding, errors="replace")
    # The script's own `setAttribute("data-theme", ...)` is in every page, so the
    # check is for the attribute on `<html>`.
    assert 'data-theme="' not in text
    assert STYLES not in text
    assert response.content == page + (LINKS_OUT + BLOCK).decode("ascii").encode(encoding)
    assert text.endswith((LINKS_OUT + BLOCK).decode("ascii"))


@pytest.mark.parametrize(
    ("bom", "encoding"),
    [(b"\xff\xfe", "utf-16-le"), (b"\xfe\xff", "utf-16-be")],
    ids=["utf-16 little endian", "utf-16 big endian"],
)
async def test_a_utf16_page_cut_mid_unit_still_gets_its_scripts_whole(
    client: AsyncClient, vault: Path, bom: bytes, encoding: str
) -> None:
    # A page read while it is still being written can end mid code unit. The stray
    # byte gets a zero byte after it, so the scripts start on a unit boundary.
    page = bom + "<!doctype html><p>findings</p>".encode(encoding) + b"<"
    (vault / "report.html").write_bytes(page)

    response = await client.get("/api/html/report.html")

    assert response.content == page + b"\x00" + (LINKS_OUT + BLOCK).decode("ascii").encode(encoding)
    text = response.content[2:].decode(encoding, errors="replace")
    assert text.endswith((LINKS_OUT + BLOCK).decode("ascii"))


@pytest.mark.parametrize(
    "inert",
    [b"<template>" + META + b"</template>", b"<noscript>" + META + b"</noscript>"],
    ids=["meta in a template", "meta in a noscript"],
)
async def test_a_meta_in_a_template_or_a_noscript_does_not_opt_a_page_in(
    client: AsyncClient, vault: Path, inert: bytes
) -> None:
    page = DOCTYPE + b"<html><head>" + inert + b"<title>x</title></head><body>x</body></html>"
    (vault / "report.html").write_bytes(page)

    response = await client.get(
        "/api/html/report.html", params={"theme": "dark", "palette": "russet"}
    )

    assert response.content == DOCTYPE + BLOCK + page[len(DOCTYPE) :] + LINKS_OUT


async def test_a_head_end_inside_a_template_is_not_where_the_styles_go(
    client: AsyncClient, vault: Path
) -> None:
    page = (
        DOCTYPE
        + b"<html><head><template></head></template>"
        + META
        + b"<title>x</title></head><body>x</body></html>"
    )
    (vault / "report.html").write_bytes(page)

    response = await client.get(
        "/api/html/report.html", params={"theme": "dark", "palette": "poel"}
    )

    assert response.content.startswith(
        DOCTYPE + b'<html data-theme="dark" data-palette="poel">' + BLOCK
    )
    assert b"<title>x</title><style data-kasten-fonts>" in response.content
    assert b"</style></head><body>x</body>" in response.content


async def test_serves_a_latin1_page_in_the_charset_its_meta_names(
    client: AsyncClient, vault: Path
) -> None:
    page = (
        DOCTYPE
        + b'<html><head><meta charset="iso-8859-1"><title>x</title></head>'
        + b"<body><p>caf\xe9</p></body></html>"
    )
    (vault / "report.html").write_bytes(page)

    response = await client.get("/api/html/report.html")

    assert b"caf\xe9" in response.content
    assert response.headers["content-security-policy"] == HTML_POLICY
    assert response.headers["content-type"] == "text/html; charset=iso-8859-1"


async def test_serves_a_utf8_page_with_no_charset_meta_as_utf8(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "report.html").write_bytes("<!doctype html><p>café</p>".encode())

    response = await client.get("/api/html/report.html")

    assert "café".encode() in response.content
    assert response.headers["content-type"] == "text/html; charset=utf-8"


async def test_puts_the_theme_into_a_latin1_page_and_keeps_its_bytes(
    client: AsyncClient, vault: Path
) -> None:
    page = (
        DOCTYPE
        + b'<html><head><meta charset="iso-8859-1">'
        + META
        + b"<title>x</title></head><body>caf\xe9</body>"
    )
    (vault / "report.html").write_bytes(page)

    response = await client.get(
        "/api/html/report.html", params={"theme": "dark", "palette": "russet"}
    )

    content = response.content
    assert content.index(b"<style data-kasten-theme>") < content.index(b"</head>")
    assert b"caf\xe9" in content
    assert response.headers["content-type"] == "text/html; charset=iso-8859-1"


def test_everything_kasten_puts_into_a_page_is_ascii() -> None:
    # A page may be in any charset, so what kasten adds reads the same in each only if it is ASCII.
    assert STYLES.isascii()
    assert PAGE_LINKS_OUT.isascii()
    assert PAGE_SCRIPT.isascii()


async def test_serves_the_charset_an_http_equiv_meta_names(
    client: AsyncClient, vault: Path
) -> None:
    page = (
        DOCTYPE
        + b'<html><head><meta http-equiv="Content-Type" '
        + b'content="text/html; charset=ISO-8859-1"><title>x</title></head>'
        + b"<body><p>caf\xe9</p></body></html>"
    )
    (vault / "report.html").write_bytes(page)

    response = await client.get("/api/html/report.html")

    assert b"caf\xe9" in response.content
    assert response.headers["content-type"] == "text/html; charset=iso-8859-1"


async def test_a_charset_meta_in_a_comment_a_script_or_a_template_does_not_count(
    client: AsyncClient, vault: Path
) -> None:
    page = (
        DOCTYPE
        + b'<html><head><!-- <meta charset="koi8-r"> -->'
        + b"<script>\"<meta charset='koi8-r'>\"</script>"
        + b'<template><meta charset="koi8-r"></template>'
        + b'<noscript><meta charset="koi8-r"></noscript><meta charset="iso-8859-1">'
        + b"<title>x</title></head><body>caf\xe9</body></html>"
    )
    (vault / "report.html").write_bytes(page)

    response = await client.get("/api/html/report.html")

    assert b"caf\xe9" in response.content
    assert response.headers["content-type"] == "text/html; charset=iso-8859-1"


async def test_a_charset_label_no_browser_knows_is_passed_over(
    client: AsyncClient, vault: Path
) -> None:
    page = (
        DOCTYPE
        + b'<html><head><meta charset="x; y"><meta charset="nonsense">'
        + b'<meta charset="iso-8859-1"><title>x</title></head><body>caf\xe9</body></html>'
    )
    (vault / "report.html").write_bytes(page)

    response = await client.get("/api/html/report.html")

    assert b"caf\xe9" in response.content
    assert response.headers["content-type"] == "text/html; charset=iso-8859-1"


async def test_a_utf16_charset_meta_counts_as_utf8(client: AsyncClient, vault: Path) -> None:
    page = (
        DOCTYPE
        + b'<html><head><meta charset="utf-16"><meta charset="iso-8859-1">'
        + b"<title>x</title></head><body>x</body></html>"
    )
    (vault / "report.html").write_bytes(page)

    response = await client.get("/api/html/report.html")

    assert b'<meta charset="utf-16">' in response.content
    assert response.headers["content-type"] == "text/html; charset=utf-8"


async def test_a_label_only_python_knows_never_reaches_the_header(
    client: AsyncClient, vault: Path
) -> None:
    page = (
        DOCTYPE
        + b'<html><head><meta charset="rot13"><meta charset="utf-7"><meta charset="base64">'
        + b'<meta charset="iso-8859-1"><title>x</title></head><body>caf\xe9</body></html>'
    )
    (vault / "report.html").write_bytes(page)

    response = await client.get("/api/html/report.html")

    assert b"caf\xe9" in response.content
    assert response.headers["content-type"] == "text/html; charset=iso-8859-1"


async def test_a_python_alias_of_utf8_goes_out_as_utf8(client: AsyncClient, vault: Path) -> None:
    (vault / "report.html").write_bytes('<!doctype html><meta charset="u8"><p>café</p>'.encode())

    response = await client.get("/api/html/report.html")

    assert "café".encode() in response.content
    assert response.headers["content-type"] == "text/html; charset=utf-8"


async def test_a_page_may_be_framed_by_kasten_alone(client: AsyncClient, vault: Path) -> None:
    # Checked on the header itself, not against HTML_POLICY, which is what moves
    # when the directive goes missing (#870).
    (vault / "report.html").write_text("<!doctype html><p>findings</p>", encoding="utf-8")

    response = await client.get("/api/html/report.html")

    policy = [d.strip() for d in response.headers["content-security-policy"].split(";")]
    assert "frame-ancestors 'self'" in policy
