from typing import TYPE_CHECKING

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from kasten_backend.config import Settings, get_settings
from kasten_backend.main import app

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterator
    from pathlib import Path


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with (
        LifespanManager(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http_client,
    ):
        yield http_client


def _serve_vault(root: Path) -> Iterator[Path]:
    app.dependency_overrides[get_settings] = lambda: Settings(vault_path=root)

    yield root

    app.dependency_overrides.clear()


@pytest.fixture
def vault(tmp_path: Path) -> Iterator[Path]:
    """Point the app at an empty throwaway vault and hand the test its path."""
    root = tmp_path / "vault"
    root.mkdir()
    yield from _serve_vault(root)


@pytest.fixture
def missing_vault(tmp_path: Path) -> Iterator[Path]:
    """Point the app at a vault directory that was never created."""
    yield from _serve_vault(tmp_path / "absent")
