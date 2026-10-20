"""A list name that is not a note directly in the share folder answers 404, and writes nothing."""

from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import quote

import pytest

if TYPE_CHECKING:
    from httpx import AsyncClient

ESCAPES = ["dotdot", "percent-encoded", "etc-passwd", "secret-absolute", "symlink"]
"""Each way a name can reach past the share folder, spelled the way a URL carries it.

`..` is written with its dots percent-encoded or joined to the slash, since a
literal `../` would be normalised by the client before it reached the route.
"""


def escape(kind: str, root: Path) -> str:
    """The name for one escape, as it goes into the URL."""
    secret = quote(str(root / "02 Projects" / "secret.md"), safe="")
    spelled = {
        "dotdot": "..%2F02%20Projects%2Fsecret",
        "percent-encoded": "%2e%2e%2f02%20Projects%2fsecret",
        "etc-passwd": "%2Fetc%2Fpasswd",
        "secret-absolute": secret,
        "symlink": "Link",
    }
    return spelled[kind]


@pytest.fixture
def shared(agent_vault: Path) -> Path:
    """A share folder with one list, a link out of it, and a note outside it."""
    folder = agent_vault / "05 Shared"
    folder.mkdir()
    (folder / "Einkauf.md").write_text("- [ ] Milch\n", encoding="utf-8")
    (agent_vault / "02 Projects").mkdir()
    (agent_vault / "02 Projects" / "secret.md").write_text("A secret.\n", encoding="utf-8")
    (folder / "Link.md").symlink_to(Path("..", "02 Projects", "secret.md"))
    return agent_vault


@pytest.mark.parametrize("kind", ESCAPES)
async def test_read_refuses_an_escape(kind: str, client: AsyncClient, shared: Path) -> None:
    response = await client.get(f"/share/lists/{escape(kind, shared)}")

    assert response.status_code == 404
    assert response.json() == {"detail": "No such list"}


@pytest.mark.parametrize("kind", ESCAPES)
async def test_add_refuses_an_escape(kind: str, client: AsyncClient, shared: Path) -> None:
    secret = shared / "02 Projects" / "secret.md"
    before = secret.read_bytes()

    response = await client.post(
        f"/share/lists/{escape(kind, shared)}/items", json={"text": "Brot", "sha": None}
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "No such list"}
    assert secret.read_bytes() == before


@pytest.mark.parametrize("kind", ESCAPES)
async def test_tick_refuses_an_escape(kind: str, client: AsyncClient, shared: Path) -> None:
    secret = shared / "02 Projects" / "secret.md"
    before = secret.read_bytes()

    response = await client.post(
        f"/share/lists/{escape(kind, shared)}/tick",
        json={"line": 0, "done": True, "sha": "0" * 64},
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "No such list"}
    assert secret.read_bytes() == before


@pytest.mark.parametrize("kind", ESCAPES)
async def test_clear_refuses_an_escape(kind: str, client: AsyncClient, shared: Path) -> None:
    secret = shared / "02 Projects" / "secret.md"
    before = secret.read_bytes()

    response = await client.post(
        f"/share/lists/{escape(kind, shared)}/clear", json={"sha": "0" * 64}
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "No such list"}
    assert secret.read_bytes() == before


async def test_lists_names_only_the_notes_directly_in_the_folder(
    client: AsyncClient, shared: Path
) -> None:
    # The link is left out with the escapes: its name is no list, and naming it
    # would hand out a note the share folder does not hold.
    (shared / "05 Shared" / "old").mkdir()
    (shared / "05 Shared" / "old" / "Alt.md").write_text("- [ ] Alt\n", encoding="utf-8")

    response = await client.get("/share/lists")

    assert response.status_code == 200
    assert response.json() == ["Einkauf"]


async def test_lists_of_a_missing_folder_is_empty(client: AsyncClient, agent_vault: Path) -> None:
    response = await client.get("/share/lists")

    assert response.json() == []
