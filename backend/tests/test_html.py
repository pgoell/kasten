from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

PAGE = b"<!doctype html><title>report</title><p>findings</p>"


async def test_lists_the_html_in_the_vault(client: AsyncClient, vault: Path) -> None:
    (vault / "research").mkdir()
    (vault / "research" / "report.html").write_bytes(PAGE)
    (vault / "research" / "report.md").write_text("# report")
    (vault / ".hidden.html").write_bytes(PAGE)

    response = await client.get("/api/html")

    assert response.status_code == 200
    assert response.json() == ["research/report.html"]


async def test_reads_a_page_with_the_doctype_first(client: AsyncClient, vault: Path) -> None:
    (vault / "report.html").write_bytes(PAGE)

    response = await client.get("/api/html/report.html")

    # The link script goes after the page, so the doctype stays the first thing
    # the parser sees and the page keeps its standards mode.
    assert response.status_code == 200
    assert response.content.startswith(PAGE)
    assert response.headers["content-type"].startswith("text/html")


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
