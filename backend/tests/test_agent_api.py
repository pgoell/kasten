"""What a token holder may do to the vault, and what the answers say."""

import hashlib
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

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
