"""What a token holder may do to the vault, and what the answers say."""

import hashlib
from typing import TYPE_CHECKING

from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from pathlib import Path

    import pytest
    from httpx import AsyncClient


def sha(text: str) -> str:
    """The digest the routes report, taken over the bytes as they land on disk."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def test_read_returns_content_and_its_digest(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "index.md").write_text("# index\n")

    response = await client.get("/agent/notes/index.md", headers=bearer)

    assert response.status_code == 200
    assert response.json() == {
        "path": "index.md",
        "content": "# index\n",
        "sha": sha("# index\n"),
    }


async def test_read_preserves_crlf(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # `vault.read_note` is `read_text`, which translates every CRLF to an LF. A
    # translated read would hand back a `content` whose digest is not the `sha`
    # beside it, and a round trip would rewrite every line of the note.
    (agent_vault / "windows.md").write_bytes(b"# one\r\n\r\n# two\r\n")

    response = await client.get("/agent/notes/windows.md", headers=bearer)

    assert response.json()["content"] == "# one\r\n\r\n# two\r\n"
    assert response.json()["sha"] == sha("# one\r\n\r\n# two\r\n")


async def test_read_refuses_a_path_out_of_the_vault(
    client: AsyncClient, bearer: dict[str, str]
) -> None:
    # Percent-encoded, because httpx normalises a literal `../../etc/passwd`
    # before it reaches FastAPI and that form would only prove some other route
    # is missing.
    response = await client.get("/agent/notes/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd", headers=bearer)

    assert response.status_code == 404


async def test_list_returns_every_note_sorted(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "projects").mkdir()
    (agent_vault / "projects" / "kasten.md").write_text("# kasten")
    (agent_vault / "index.md").write_text("# index")

    response = await client.get("/agent/notes", headers=bearer)

    assert response.status_code == 200
    assert response.json() == ["index.md", "projects/kasten.md"]


async def test_list_filters_by_folder(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "projects").mkdir()
    (agent_vault / "projects" / "kasten.md").write_text("# kasten")
    (agent_vault / "index.md").write_text("# index")

    response = await client.get("/agent/notes", params={"folder": "projects"}, headers=bearer)

    assert response.json() == ["projects/kasten.md"]


async def test_list_of_a_folder_outside_the_vault_is_empty(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # Absent rather than refused, the way every other escape reads.
    (agent_vault / "index.md").write_text("# index")

    response = await client.get("/agent/notes", params={"folder": "../.."}, headers=bearer)

    assert response.json() == []


async def test_search_finds_a_line(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    (agent_vault / "borges.md").write_text("# borges\n\nThe garden of forking paths.\n")

    response = await client.get("/agent/search", params={"q": "forking"}, headers=bearer)

    assert response.status_code == 200
    assert response.json() == [
        {"path": "borges.md", "line": 3, "text": "The garden of forking paths."}
    ]


async def test_search_honours_the_archive_setting(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    # The folder comes off the setting rather than a literal `98 Archive`, which
    # is one vault's filing convention and not kasten's.
    monkeypatch.setenv("KASTEN_ARCHIVE_PATH", "old")
    get_settings.cache_clear()
    (agent_vault / "old").mkdir()
    (agent_vault / "old" / "borges.md").write_text("The garden of forking paths.\n")

    assert (await client.get("/agent/search", params={"q": "forking"}, headers=bearer)).json() == []

    found = await client.get(
        "/agent/search", params={"q": "forking", "archive": True}, headers=bearer
    )

    assert [hit["path"] for hit in found.json()] == ["old/borges.md"]
