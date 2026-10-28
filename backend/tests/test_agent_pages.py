"""An agent putting a page of HTML into the vault over REST, and replacing it.

The asset upload's rules are `test_agent_files.py`'s and `test_asset_uploads.py`'s.
These cover what a page does differently: it may replace itself, it is checked
for a tag in place of a format's magic, and it is never written over a note or
an asset. The MCP side is `test_agent_pages_mcp.py`.
"""

from typing import TYPE_CHECKING

import pytest

from backend.tests.conftest import descriptions, jj
from kasten_backend import files

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

PAGE = b"<!doctype html><title>Edition</title><p>first</p>"
AGAIN = b"<!doctype html><title>Edition</title><p>second</p>"
PDF = b"%PDF-1.7\n" + b"x" * 64

# A copy and not `HTML_POLICY`, so a test against the constant cannot pass
# while someone loosens it: a page an agent writes is held exactly as before.
POLICY = (
    "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; "
    "default-src 'none'; "
    "script-src 'unsafe-inline' https:; "
    "style-src 'unsafe-inline' https:; "
    "img-src 'self' data: blob: https:; "
    "font-src data: https:; "
    "media-src data: https:; "
    "connect-src 'none'; "
    "form-action 'none'; "
    "base-uri 'none'; "
    "frame-ancestors 'self'"
)


def empty(root: Path) -> bool:
    """Whether a refusal left the vault as it found it, no temp beside the target included."""
    return not any(root.iterdir())


def temps(root: Path) -> list[Path]:
    """Every temp a write left anywhere in the vault."""
    return [path for path in root.rglob("*.tmp") if path.name.startswith(".")]


async def test_an_html_upload_lands(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    response = await client.post(
        "/agent/files/30 Resources/edition.html", content=PAGE, headers=bearer
    )

    assert response.status_code == 201
    assert response.json() == {"path": "30 Resources/edition.html"}
    assert (agent_vault / "30 Resources/edition.html").read_bytes() == PAGE


async def test_an_html_upload_replaces_the_page(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    await client.post("/agent/files/edition.html", content=PAGE, headers=bearer)

    response = await client.post("/agent/files/edition.html", content=AGAIN, headers=bearer)

    assert response.status_code == 201
    assert (agent_vault / "edition.html").read_bytes() == AGAIN
    assert temps(agent_vault) == []


async def test_an_asset_stays_write_once_beside_a_page(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    await client.post("/agent/files/DDIA.pdf", content=PDF, headers=bearer)

    response = await client.post("/agent/files/DDIA.pdf", content=b"%PDF-other", headers=bearer)

    assert response.status_code == 409
    assert (agent_vault / "DDIA.pdf").read_bytes() == PDF


async def test_an_html_upload_refuses_a_path_outside_the_vault(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # Encoded, because httpx folds a literal `../` away before it is ever sent.
    response = await client.post("/agent/files/%2E%2E%2Fescape.html", content=PAGE, headers=bearer)

    assert response.status_code == 400
    assert response.json()["detail"] == "The vault will not take that path"
    assert not (agent_vault.parent / "escape.html").exists()


async def test_an_html_upload_refuses_a_note_path(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "borges.md").write_text("# mine\n", encoding="utf-8")

    response = await client.post("/agent/files/borges.md", content=PAGE, headers=bearer)

    assert response.status_code == 400
    assert response.json()["detail"] == "The vault will not take that path"
    assert (agent_vault / "borges.md").read_text(encoding="utf-8") == "# mine\n"


async def test_an_html_body_never_lands_on_an_asset(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "DDIA.pdf").write_bytes(PDF)

    response = await client.post("/agent/files/DDIA.pdf", content=PAGE, headers=bearer)

    assert response.status_code == 409
    assert (agent_vault / "DDIA.pdf").read_bytes() == PDF


async def test_an_html_upload_over_the_cap_is_refused(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(files, "ASSET_LIMIT_BYTES", 16)

    response = await client.post("/agent/files/edition.html", content=PAGE, headers=bearer)

    assert response.status_code == 413
    assert response.json()["detail"] == "That file is over the 16 byte limit"
    assert empty(agent_vault)


@pytest.mark.parametrize("body", [b"# A note\n\n<p>not a page</p>", PDF, b"", b"   \n"])
async def test_an_html_upload_refuses_a_body_that_is_not_html(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], body: bytes
) -> None:
    response = await client.post("/agent/files/edition.html", content=body, headers=bearer)

    assert response.status_code == 400
    assert response.json()["detail"] == "That file is not what its name says"
    assert empty(agent_vault)


async def test_an_html_upload_takes_a_page_opening_on_a_bom_and_blank_lines(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    body = b"\xef\xbb\xbf\n\n   \t" + PAGE

    response = await client.post("/agent/files/Edition.HTML", content=body, headers=bearer)

    assert response.status_code == 201
    assert (agent_vault / "Edition.HTML").read_bytes() == body


@pytest.mark.parametrize("body", [b"# not a page", PAGE * 4])
async def test_a_refused_replace_leaves_the_page_whole(
    client: AsyncClient,
    agent_vault: Path,
    bearer: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    body: bytes,
) -> None:
    await client.post("/agent/files/edition.html", content=PAGE, headers=bearer)
    monkeypatch.setattr(files, "ASSET_LIMIT_BYTES", len(PAGE) * 2)

    response = await client.post("/agent/files/edition.html", content=body, headers=bearer)

    assert response.status_code in (400, 413)
    assert (agent_vault / "edition.html").read_bytes() == PAGE
    assert temps(agent_vault) == []


async def test_an_html_upload_over_a_folder_is_refused(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "edition.html").mkdir()

    response = await client.post("/agent/files/edition.html", content=PAGE, headers=bearer)

    assert response.status_code == 409
    assert response.json()["detail"] == "Something is already there"
    assert (agent_vault / "edition.html").is_dir()
    assert temps(agent_vault) == []


async def test_a_folder_made_during_the_upload_is_refused(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    # The folder appears after the courtesy check, so the rename is what refuses.
    real = files.temporary_name

    def racing(name: str) -> str:
        (agent_vault / "edition.html").mkdir()
        return real(name)

    monkeypatch.setattr(files, "temporary_name", racing)

    response = await client.post("/agent/files/edition.html", content=PAGE, headers=bearer)

    assert response.status_code == 409
    assert temps(agent_vault) == []


async def test_an_html_link_to_a_note_is_refused(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "borges.md").write_text("# mine\n", encoding="utf-8")
    (agent_vault / "edition.html").symlink_to(agent_vault / "borges.md")

    response = await client.post("/agent/files/edition.html", content=PAGE, headers=bearer)

    assert response.status_code == 400
    assert (agent_vault / "borges.md").read_text(encoding="utf-8") == "# mine\n"


async def test_the_browser_upload_still_refuses_html(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/assets/edition.html", content=PAGE)

    assert response.status_code == 400
    assert not (vault / "edition.html").exists()


async def test_an_agent_page_is_served_under_the_same_policy(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    await client.post("/agent/files/edition.html", content=PAGE, headers=bearer)

    response = await client.get("/api/html/edition.html")

    assert response.status_code == 200
    assert response.headers["content-security-policy"] == POLICY


async def test_a_replaced_page_keeps_its_old_version_in_history(
    client: AsyncClient, versioned_agent_vault: Path, bearer: dict[str, str]
) -> None:
    await client.post("/agent/files/edition.html", content=PAGE, headers=bearer)
    await client.post("/agent/files/edition.html", content=AGAIN, headers=bearer)

    assert descriptions(versioned_agent_vault)[0] == "agent(laptop): edition.html"
    # Two agent writes of one path amend one change, so the first page lives
    # in that change's evolution and not in a change of its own.
    evolution = jj(versioned_agent_vault, "evolog", "-r", "@", "--no-graph", "--git")
    assert f"+{PAGE.decode()}" in evolution
    assert f"-{PAGE.decode()}" in evolution
    assert (versioned_agent_vault / "edition.html").read_bytes() == AGAIN
