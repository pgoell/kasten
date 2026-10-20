"""The share host reaches the lists only, and the event filter keeps to the folder."""

from typing import TYPE_CHECKING

import pytest

from kasten_backend import share
from kasten_backend.config import Settings, get_settings

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

    from httpx import AsyncClient

SHARE_HOST = "liste.example"

NOT_SHARE = [
    "/api/health",
    "/api/files",
    "/api/events",
    "/agent/notes",
    "/.well-known/oauth-authorization-server",
    "/docs",
    "/openapi.json",
]


@pytest.fixture
def shared(agent_vault: Path) -> Path:
    """A share folder holding one list, and a note outside it."""
    (agent_vault / "05 Shared").mkdir()
    (agent_vault / "05 Shared" / "Einkauf.md").write_text("- [ ] Milch\n", encoding="utf-8")
    (agent_vault / "02 Projects").mkdir()
    (agent_vault / "02 Projects" / "secret.md").write_text("A secret.\n", encoding="utf-8")
    return agent_vault


@pytest.fixture
def share_host(shared: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    """Serve the app as the share host, read from the environment the way production reads it."""
    monkeypatch.setenv("KASTEN_SHARE_HOST", SHARE_HOST)
    get_settings.cache_clear()

    yield SHARE_HOST

    get_settings.cache_clear()


@pytest.mark.parametrize("path", NOT_SHARE)
async def test_share_host_answers_not_here_outside_the_share_routes(
    path: str, client: AsyncClient, share_host: str
) -> None:
    response = await client.get(path, headers={"Host": share_host})

    assert response.status_code == 404
    assert response.json() == {"detail": "Not here"}


async def test_share_host_answers_the_lists(client: AsyncClient, share_host: str) -> None:
    response = await client.get("/share/lists", headers={"Host": share_host})

    assert response.status_code == 200
    assert response.json() == ["Einkauf"]


async def test_another_host_answers_the_api_as_before(client: AsyncClient, share_host: str) -> None:
    response = await client.get("/api/health", headers={"Host": "notebook.example"})

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_event_filter_passes_a_note_in_the_share_folder() -> None:
    settings = Settings(share_folder="05 Shared")

    assert share.inside(settings, "05 Shared/Einkauf.md")


def test_event_filter_refuses_a_note_outside_the_share_folder() -> None:
    settings = Settings(share_folder="05 Shared")

    assert not share.inside(settings, "02 Projects/secret.md")


def test_event_filter_refuses_a_note_deeper_than_the_share_folder() -> None:
    settings = Settings(share_folder="05 Shared")

    assert not share.inside(settings, "05 Shared/old/Alt.md")
