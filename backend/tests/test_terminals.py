"""The named herdr sessions a terminal pane can attach to.

Read off disk rather than asked of herdr: the sessions live in a volume the
shell container writes and this one mounts read-only, and a directory per
session is the whole of what herdr keeps there. Nothing here runs herdr, and
nothing here can start or stop a session.
"""

from typing import TYPE_CHECKING

import pytest

from kasten_backend.config import Settings, get_settings
from kasten_backend.main import app

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

    from httpx import AsyncClient


@pytest.fixture
def sessions(tmp_path: Path) -> Iterator[Path]:
    """Point the app at a throwaway sessions directory and hand over its path."""
    root = tmp_path / "sessions"
    root.mkdir()
    app.dependency_overrides[get_settings] = lambda: Settings(herdr_sessions_path=root)

    yield root

    app.dependency_overrides.clear()


@pytest.fixture
def missing_sessions(tmp_path: Path) -> Iterator[Path]:
    """Point the app at a sessions directory that is not there."""
    root = tmp_path / "absent"
    app.dependency_overrides[get_settings] = lambda: Settings(herdr_sessions_path=root)

    yield root

    app.dependency_overrides.clear()


async def test_lists_session_names_sorted(client: AsyncClient, sessions: Path) -> None:
    (sessions / "notes").mkdir()
    (sessions / "agent-kasten").mkdir()

    response = await client.get("/api/terminals")

    assert response.status_code == 200
    assert response.json() == ["agent-kasten", "notes"]


async def test_answers_empty_without_the_volume(
    client: AsyncClient, missing_sessions: Path
) -> None:
    """The mount is optional, so a backend without it says there are none.

    Nothing about a notebook stops working because the shell container is not
    up, and the prompt still takes a name typed by hand.
    """
    response = await client.get("/api/terminals")

    assert response.status_code == 200
    assert response.json() == []


async def test_ignores_anything_that_is_not_a_session_directory(
    client: AsyncClient, sessions: Path
) -> None:
    """herdr keeps one directory per session; a stray file names no session."""
    (sessions / "real").mkdir()
    (sessions / "herdr.log").write_text("noise")

    response = await client.get("/api/terminals")

    assert response.json() == ["real"]
